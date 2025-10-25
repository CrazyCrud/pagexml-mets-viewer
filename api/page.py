from __future__ import annotations
from pathlib import Path
from typing import Optional, Tuple, Dict, List

from flask import Blueprint, request, jsonify, send_file, abort

from core.resolve import resolve_image_for_page
from core.page import parse_pcgts, page_coords, collect_regions, collect_lines

WORKSPACES_ROOT = Path("data/workspaces").resolve()

bp_page = Blueprint("page_api", __name__)

IMG_EXTS = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp")


def _resolve_page_path() -> Path:
    """
    Resolve the PAGE-XML path from query params.

    Supports either:
      - ?xml=/abs/path/to/page.xml
      - ?workspace_id=<UUID>&path=<relative-or-filename.xml>
        (tries <workspace>/normalized/<path> then <workspace>/pages/<path>,
         and finally <workspace>/<path> for convenience)
    """
    xml_abs = (request.args.get("xml") or "").strip()
    if xml_abs:
        p = Path(xml_abs).expanduser().resolve()
        if not p.is_file():
            abort(404, f"PAGE-XML not found: {p}")
        return p

    ws_id = (request.args.get("workspace_id") or "").strip()
    rel = (request.args.get("path") or "").strip()
    if not ws_id or not rel:
        abort(400, "Provide either 'xml' or both 'workspace_id' and 'path'")

    base = (WORKSPACES_ROOT / ws_id).resolve()
    if not base.is_dir():
        abort(404, f"Workspace not found: {base}")

    cand_norm = (base / "normalized" / rel).resolve()
    cand_pages = (base / "pages" / rel).resolve()
    cand_any = (base / rel).resolve()

    if cand_norm.is_file():
        return cand_norm
    if cand_pages.is_file():
        return cand_pages
    if cand_any.is_file():
        return cand_any

    abort(404, f"PAGE-XML not found in workspace: {rel}")


def _workspace_root_for(page_xml_path: Path) -> Path:
    """
    Return the workspace root best effort, assuming XML is under
    .../<WS>/normalized/ or .../<WS>/pages/. Otherwise use parent.
    """
    parent_dir = page_xml_path.parent.name.lower()
    if parent_dir in ("pages", "normalized"):
        return page_xml_path.parent.parent.resolve()
    # fallback: best effort
    return page_xml_path.parent.resolve()


def _list_workspace_images(ws_base: Path) -> List[Path]:
    """
    List image files under <workspace>/images (non-recursive).
    """
    images_dir = (ws_base / "images").resolve()
    if not images_dir.exists() or not images_dir.is_dir():
        return []
    out: List[Path] = []
    for p in images_dir.iterdir():
        if p.is_file() and p.suffix.lower() in IMG_EXTS:
            out.append(p.resolve())
    out.sort()
    return out


def _resolve_image_for_workspace(pcgts, page_xml_path: Path, uploaded_images: Optional[List[Path]] = None) -> Tuple[
    str, int, int, Dict]:
    """
    Try standard resolver first; if it fails, probe common workspace locations:
      - <workspace>/images/<basename from PAGE/@imageFilename>
      - <workspace>/pages/<basename>
      - <workspace>/images/<stem>.<ext> for common extensions
    Return (path, width, height, extra_meta).
    """
    # Standard resolver (with known images if provided)
    try:
        img_path, w, h = resolve_image_for_page(
            pcgts,
            page_xml_path,
            uploaded_images=uploaded_images
        )
        return img_path, w, h, {}
    except Exception:
        pass

    # Workspace-aware fallbacks
    page = getattr(pcgts, "get_Page", None)
    page = page() if callable(page) else getattr(pcgts, "Page", None)
    hinted = ""
    if page is not None:
        for attr in ("get_imageFilename", "imageFilename"):
            if hasattr(page, attr):
                try:
                    val = getattr(page, attr) if not attr.startswith("get_") else getattr(page, attr)()
                    if isinstance(val, str) and val.strip():
                        hinted = val.strip()
                        break
                except Exception:
                    pass

    basename = Path(hinted).name if hinted else ""

    ws_base = _workspace_root_for(page_xml_path)
    ws_images = (ws_base / "images").resolve()
    ws_pages = (ws_base / "pages").resolve()

    candidates: List[Path] = []
    if basename:
        candidates.append((ws_images / basename).resolve())
        candidates.append((ws_pages / basename).resolve())

    # Stem-based fallback
    stem = page_xml_path.stem
    for ext in IMG_EXTS:
        candidates.append((ws_images / f"{stem}{ext}").resolve())

    # Deduplicate and deterministic order
    seen = set()
    uniq_candidates = []
    for c in candidates:
        key = str(c).lower()
        if key not in seen:
            seen.add(key)
            uniq_candidates.append(c)
    uniq_candidates.sort()

    from PIL import Image
    tried = []
    for cand in uniq_candidates:
        tried.append(str(cand))
        try:
            if cand.is_file():
                with Image.open(cand) as im:
                    return str(cand), im.width, im.height, {"fallback": True, "used": str(cand)}
        except Exception:
            continue

    raise FileNotFoundError(
        "Could not resolve page image. "
        f"PAGE imageFilename='{hinted or '(empty)'}'. Tried:\n- " + "\n- ".join(tried or ["(no candidates)"])
    )


@bp_page.get("/page")
def get_page():
    """
    GET /api/page?xml=/abs/page.xml
    or
    GET /api/page?workspace_id=UUID&path=OCR-D-SEG_0001.xml
    """
    # Determine mode early (absolute vs workspace)
    xml_arg = (request.args.get("xml") or "").strip()
    ws_id = (request.args.get("workspace_id") or "").strip()

    page_xml = _resolve_page_path()
    pcgts = parse_pcgts(str(page_xml))

    # Optional image_override (absolute only)
    image_override = request.args.get("image_override", "").strip()
    if image_override:
        ip = Path(image_override)
        if ip.is_file():
            from PIL import Image
            with Image.open(ip) as im:
                width, height = im.width, im.height
            img_path, extra = str(ip.resolve()), {}
        else:
            abort(404, f"image_override not found: {ip}")
    else:
        # If workspace mode, provide uploaded_images for stronger resolver behavior
        uploaded_images = None
        ws_base = None
        if ws_id:
            ws_base = (WORKSPACES_ROOT / ws_id).resolve()
            if not ws_base.is_dir():
                abort(404, f"Workspace not found: {ws_base}")
            uploaded_images = _list_workspace_images(ws_base)

        # Try resolver, then workspace-aware fallback
        try:
            img_path, width, height = resolve_image_for_page(
                pcgts,
                page_xml,
                uploaded_images=uploaded_images
            )
            extra = {}
        except Exception:
            img_path, width, height, extra = _resolve_image_for_workspace(
                pcgts,
                page_xml,
                uploaded_images=uploaded_images
            )

    # Build image URL:
    # - absolute-XML mode: use the alternate streamer /api/page/image?xml=...
    # - workspace mode: use the workspace file server /api/file?workspace_id=...&path=...
    if xml_arg:
        # No workspace context; stream via /api/page/image
        # Do not include image_override here; caller can pass it if they want to override
        image_url = f"/api/page/image?xml={page_xml}"
    else:
        # Workspace mode
        ws_base = (WORKSPACES_ROOT / ws_id).resolve()
        # Try to compute path relative to workspace
        try:
            rel_for_api = str(Path(img_path).resolve().relative_to(ws_base.resolve()))
        except Exception:
            # Fallback: assume it lives in images/
            rel_for_api = f"images/{Path(img_path).name}"
        image_url = f"/api/file?workspace_id={ws_id}&path={rel_for_api}"

    coords = page_coords(pcgts)
    regions = collect_regions(pcgts, coords)
    lines = collect_lines(pcgts, coords)

    # Page ID extraction
    p = getattr(pcgts, "get_Page", None)
    p = p() if callable(p) else getattr(pcgts, "Page", None)
    page_id = None
    for attr in ("pcGtsId", "id", "get_id"):
        if p is None:
            break
        if hasattr(p, attr):
            try:
                val = getattr(p, attr) if not attr.startswith("get_") else getattr(p, attr)()
                if isinstance(val, str) and val.strip():
                    page_id = val.strip()
                    break
            except Exception:
                continue
    if not page_id:
        page_id = page_xml.stem

    return jsonify({
        "image": {
            "path": str(Path(img_path).resolve()),
            "width": int(width),
            "height": int(height),
            "url": image_url,
            **({"fallback": True} if extra.get("fallback") else {})
        },
        "page": {"id": page_id},
        "regions": regions,
        "lines": lines,
    })


@bp_page.route("/image", methods=["GET"])
def get_page_image():
    """
    GET modes:
      /api/page/image?xml=/abs/page.xml
      or
      /api/page/image?workspace_id=<id>&path=<name.xml>
      [&image_override=/abs/img]
    Streams the resolved page image file.
    """
    image_override = (request.args.get("image_override") or "").strip()
    override = Path(image_override).resolve() if image_override else None

    xml_abs = (request.args.get("xml") or "").strip()
    if xml_abs:
        page_xml = Path(xml_abs).resolve()
        if not page_xml.is_file():
            abort(404, f"PAGE-XML not found: {page_xml}")
    else:
        ws_id = (request.args.get("workspace_id") or "").strip()
        rel = (request.args.get("path") or "").strip()
        if not ws_id or not rel:
            abort(400, "Provide either 'xml' or both 'workspace_id' and 'path'")
        base = (WORKSPACES_ROOT / ws_id).resolve()
        if not base.is_dir():
            abort(404, f"Workspace not found: {base}")
        p_norm = (base / "normalized" / rel).resolve()
        p_pages = (base / "pages" / rel).resolve()
        page_xml = p_norm if p_norm.is_file() else p_pages
        if not page_xml.is_file():
            abort(404, f"PAGE-XML not found: {page_xml}")

    pcgts = parse_pcgts(str(page_xml))

    # Override wins
    if override and override.is_file():
        return send_file(str(override), conditional=True)

    # If workspace exist, pass known images for better matching
    uploaded_images = None
    if not xml_abs:
        ws_id = (request.args.get("workspace_id") or "").strip()
        base = (WORKSPACES_ROOT / ws_id).resolve()
        uploaded_images = _list_workspace_images(base)

    try:
        img_path, _, _ = resolve_image_for_page(
            pcgts,
            page_xml,
            uploaded_images=uploaded_images
        )
    except Exception:
        img_path, _, _, _ = _resolve_image_for_workspace(
            pcgts,
            page_xml,
            uploaded_images=uploaded_images
        )

    if not Path(img_path).exists():
        abort(404, f"Image not found: {img_path}")

    return send_file(str(Path(img_path).resolve()), conditional=True)
