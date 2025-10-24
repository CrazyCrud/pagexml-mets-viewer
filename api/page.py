from __future__ import annotations
from pathlib import Path
from typing import Optional

from flask import Blueprint, request, jsonify, send_file, abort

from core.resolve import resolve_image_for_page
from core.page import parse_pcgts, page_coords, collect_regions, collect_lines

bp_page = Blueprint("page_api", __name__, url_prefix="/api/page")


def _req_path(arg: str) -> Path:
    val = request.args.get(arg, "").strip()
    if not val:
        abort(400, f"Missing query parameter '{arg}'")
    return Path(val)


@bp_page.route("", methods=["GET"])
def get_page():
    """
    GET /api/page?xml=/abs/path/to/page.xml[&image_override=/abs/path/to/img]
    Returns:
    {
      "image": {"path": "...", "width": W, "height": H},
      "page":  {"id": "..."},
      "regions": [{ id, type, points, bbox, conf? }, ...],
      "lines":   [{ id, region_id?, baseline?, points, bbox }, ...]
    }
    """
    page_xml = _req_path("xml")
    image_override: Optional[Path] = Path(request.args["image_override"]).resolve() \
        if "image_override" in request.args and request.args["image_override"].strip() else None

    # Parse + resolve
    pcgts = parse_pcgts(page_xml)
    img_path, width, height = resolve_image_for_page(pcgts, page_xml, image_override)

    # Coords + geometry
    coords = page_coords(pcgts)
    regions = collect_regions(pcgts, coords)
    lines = collect_lines(pcgts, coords)

    page_id = getattr(pcgts.get_Page(), "pcGtsId", None) or getattr(pcgts.get_Page(), "id", None)

    return jsonify({
        "image": {"path": str(img_path), "width": width, "height": height},
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
