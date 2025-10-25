from __future__ import annotations
from pathlib import Path
from typing import Optional

from flask import Blueprint, request, jsonify, send_file, abort

from core.resolve import resolve_image_for_page
from core.page import parse_pcgts, page_coords, collect_regions, collect_lines

# must match upload.py
WORKSPACES_ROOT = Path("data/workspaces").resolve()

bp_page = Blueprint("page_api", __name__)


def _req_path(arg: str) -> Path:
    val = request.args.get(arg, "").strip()
    if not val:
        abort(400, f"Missing query parameter '{arg}'")
    return Path(val)


def _req(arg: str) -> str:
    v = (request.args.get(arg) or "").strip()
    if not v:
        abort(400, f"Missing query parameter '{arg}'")
    return v


def _resolve_page_path() -> Path:
    """
    Support either:
      - xml=/abs/path/to/page.xml
      - workspace_id=... & path=relative_or_name.xml
        (we try normalized/ first, then pages/)
    """
    xml_abs = (request.args.get("xml") or "").strip()
    if xml_abs:
        p = Path(xml_abs)
        if not p.is_file():
            abort(404, f"PAGE-XML not found: {p}")
        return p

    # workspace mode
    ws_id = (request.args.get("workspace_id") or "").strip()
    rel = (request.args.get("path") or "").strip()
    if not ws_id or not rel:
        abort(400, "Provide either 'xml' or both 'workspace_id' and 'path'")

    base = (WORKSPACES_ROOT / ws_id).resolve()
    if not base.is_dir():
        abort(404, f"Workspace not found: {base}")

    # try normalized/ first (after commit), then pages/ (fresh upload)
    cand_norm = (base / "normalized" / rel).resolve()
    if cand_norm.is_file():
        return cand_norm

    cand_pages = (base / "pages" / rel).resolve()
    if cand_pages.is_file():
        return cand_pages

    # also allow caller to have passed a full relative path under workspace
    cand_any = (base / rel).resolve()
    if cand_any.is_file():
        return cand_any

    abort(404, f"PAGE-XML not found in workspace: {rel}")


def _resolve_image_for_workspace(pcgts, page_xml_path: Path) -> Tuple[str, int, int, Dict]:
    """
    Try the standard resolver first. If it fails (common before commit),
    fallback to workspace/images/<basename>.
    """
    # attempt normal resolution (works if Page/@imageFilename is usable)
    try:
        img_path, w, h = resolve_image_for_page(pcgts, page_xml_path)
        return img_path, w, h, {}
    except Exception as e:
        # fallback for unnormalized inputs
        page = pcgts.get_Page()
        img = page.get_imageFilename() or ""
        basename = Path(img).name if img else ""
        ws_base = page_xml_path.parents[2] if page_xml_path.parts[-2] in ("pages",
                                                                          "normalized") else page_xml_path.parent
        # prefer workspace/images/<basename>
        if basename:
            candidate = (ws_base / "images" / basename).resolve()
            if candidate.is_file():
                # size unknown here – let frontend load it as-is; or try Pillow:
                try:
                    from PIL import Image
                    with Image.open(candidate) as im:
                        w, h = im.width, im.height
                except Exception:
                    w = h = None
                return str(candidate), w, h, {"fallback": True, "reason": "used workspace/images/<basename>"}
        raise


@bp_page.get("/page")
def get_page():
    """
    GET modes:
      /api/page?page?xml=/abs/page.xml
      /api/page?page?workspace_id=UUID&path=OCR-D-SEG_0001.xml
    """
    page_xml = _resolve_page_path()
    pcgts = parse_pcgts(str(page_xml))

    # image
    try:
        img_path, width, height = resolve_image_for_page(pcgts, page_xml)
        extra = {}
    except Exception:
        img_path, width, height, extra = _resolve_image_for_workspace(pcgts, page_xml)

    # geometry
    coords = page_coords(pcgts)
    regions = collect_regions(pcgts, coords)
    lines = collect_lines(pcgts, coords)

    page_id = getattr(pcgts.get_Page(), "pcGtsId", None) or getattr(pcgts.get_Page(), "id", None) or page_xml.stem

    return jsonify({
        "image": {"path": str(img_path), "width": width, "height": height, **extra},
        "page": {"id": page_id},
        "regions": regions,
        "lines": lines,
    })


@bp_page.route("/image", methods=["GET"])
def get_page_image():
    """
    GET /api/page/image?xml=/abs/path/to/page.xml[&image_override=/abs/path/to/img]
    Streams the resolved page image file (original size).
    """
    page_xml = _req_path("xml")
    image_override: Optional[Path] = Path(request.args["image_override"]).resolve() \
        if "image_override" in request.args and request.args["image_override"].strip() else None

    pcgts = parse_pcgts(page_xml)
    img_path, _, _ = resolve_image_for_page(pcgts, page_xml, image_override)

    if not Path(img_path).exists():
        abort(404, f"Image not found: {img_path}")
    # Let Flask infer MIME (PNG/JPEG/TIFF)
    return send_file(str(img_path), conditional=True)
