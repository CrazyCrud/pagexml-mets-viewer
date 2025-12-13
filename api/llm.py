"""
LLM API Blueprint

Provides endpoints for AI-powered transcription using local LLM (Ollama).
"""

from __future__ import annotations

from pathlib import Path
from flask import Blueprint, request, jsonify, abort
from PIL import Image
import base64
import io
import logging

from core.ollama_client import OllamaClient
from core.page import parse_pcgts, collect_lines, page_coords

logger = logging.getLogger(__name__)

bp_llm = Blueprint("llm_api", __name__)

WORKSPACES_ROOT = Path("data/workspaces").resolve()

# Global Ollama client (lazy initialization)
_ollama_client: OllamaClient | None = None


def get_ollama_client() -> OllamaClient:
    """Get or create Ollama client singleton."""
    global _ollama_client
    if _ollama_client is None:
        # Read config from environment or use defaults
        import os
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        model = os.getenv("OLLAMA_MODEL", "llama3.2-vision")
        _ollama_client = OllamaClient(base_url=base_url, model=model)
    return _ollama_client


@bp_llm.get("/llm/status")
def llm_status():
    """
    Check if LLM service (Ollama) is available.

    GET /api/llm/status

    Returns:
        {
            "available": bool,
            "models": [str],
            "base_url": str,
            "current_model": str
        }
    """
    client = get_ollama_client()
    available = client.is_available()

    return jsonify({
        "available": available,
        "models": client.list_models() if available else [],
        "base_url": client.base_url,
        "current_model": client.model
    })


@bp_llm.post("/llm/transcribe")
def llm_transcribe():
    """
    Transcribe or correct a text line using LLM.

    POST /api/llm/transcribe
    JSON payload:
        {
            "workspace_id": str,
            "path": str,              # PAGE-XML path
            "line_id": str,           # TextLine ID
            "existing_text": str,     # Optional: existing transcription to correct
            "language": str           # Optional: language (default: "German")
        }

    Returns:
        {
            "ok": bool,
            "transcription": str,
            "mode": "transcribe" | "correct"
        }
    """
    client = get_ollama_client()

    if not client.is_available():
        abort(503, "LLM service (Ollama) is not available. Please start Ollama first.")

    payload = request.get_json(silent=True) or {}
    ws_id = (payload.get("workspace_id") or "").strip()
    rel = (payload.get("path") or "").strip()
    line_id = (payload.get("line_id") or "").strip()
    existing_text = (payload.get("existing_text") or "").strip()
    language = (payload.get("language") or "German").strip()

    if not ws_id or not rel or not line_id:
        abort(400, "workspace_id, path, and line_id are required")

    # Resolve workspace and PAGE-XML
    base = (WORKSPACES_ROOT / ws_id).resolve()
    if not base.is_dir():
        abort(404, f"Workspace not found: {base}")

    candidates = [
        (base / "normalized" / rel).resolve(),
        (base / "pages" / rel).resolve(),
        (base / rel).resolve(),
    ]
    page_xml = next((p for p in candidates if p.is_file()), None)
    if not page_xml:
        abort(404, f"PAGE-XML not found: {rel}")

    # Parse PAGE-XML to find the line
    pcgts = parse_pcgts(str(page_xml))
    coords = page_coords(pcgts)
    lines = collect_lines(pcgts, coords, page_xml)

    target_line = next((ln for ln in lines if ln.get("id") == line_id), None)
    if not target_line:
        abort(404, f"Line not found: {line_id}")

    # Get image for the line
    # We need to resolve the image path and crop the line region
    try:
        image_path, line_image_base64 = _extract_line_image(
            base, page_xml, pcgts, target_line
        )
    except Exception as e:
        logger.error(f"Failed to extract line image: {e}")
        abort(500, f"Failed to extract line image: {str(e)}")

    # Call Ollama to transcribe/correct
    mode = "correct" if existing_text else "transcribe"
    transcription = client.transcribe_line(
        image_base64=line_image_base64,
        existing_text=existing_text if existing_text else None,
        language=language
    )

    if transcription is None:
        abort(500, "LLM transcription failed. Check Ollama logs.")

    return jsonify({
        "ok": True,
        "transcription": transcription,
        "mode": mode
    })


def _extract_line_image(workspace_base: Path, page_xml_path: Path, pcgts, line_data: dict) -> tuple[str, str]:
    """
    Extract and crop the line region from the page image.

    Args:
        workspace_base: Workspace root directory
        page_xml_path: Path to PAGE-XML file
        pcgts: Parsed PAGE-XML object
        line_data: Line dictionary with 'points' or 'baseline'

    Returns:
        Tuple of (image_path, base64_encoded_cropped_image)
    """
    from core.resolve import resolve_image_for_page

    # Resolve the image
    ws_images = list((workspace_base / "images").glob("*"))
    img_path, width, height = resolve_image_for_page(
        pcgts,
        page_xml_path,
        uploaded_images=ws_images
    )

    # Open image
    img = Image.open(img_path)

    # Get line bounding box
    points = line_data.get("points", [])
    if not points:
        # Fallback: use baseline if no polygon
        points = line_data.get("baseline", [])

    if not points or len(points) < 2:
        raise ValueError("Line has no valid coordinates")

    # Calculate bounding box
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    # Add padding (10% on each side)
    padding_x = (max_x - min_x) * 0.1
    padding_y = (max_y - min_y) * 0.2  # More vertical padding

    crop_box = (
        max(0, int(min_x - padding_x)),
        max(0, int(min_y - padding_y)),
        min(img.width, int(max_x + padding_x)),
        min(img.height, int(max_y + padding_y))
    )

    # Crop the line
    cropped = img.crop(crop_box)

    # Convert to base64
    buffer = io.BytesIO()
    cropped.save(buffer, format="PNG")
    img_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

    return str(img_path), img_base64
