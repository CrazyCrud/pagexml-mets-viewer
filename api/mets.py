from __future__ import annotations
from pathlib import Path
from typing import Dict
from flask import Blueprint, request, jsonify, abort
from ocrd_models import OcrdMets

bp_mets = Blueprint("api_mets", __name__)

WORKSPACES = Path("data/workspaces").resolve()


def _safe_ws_path(ws_id: str, rel: str) -> Path:
    base = (WORKSPACES / ws_id).resolve()
    p = (base / rel.lstrip("/\\")).resolve()
    if base not in p.parents and p != base:
        abort(403)
    return p


@bp_mets.get("/mets")
def get_mets():
    """
    GET /api/mets?workspace_id=<id>&path=<rel/to/workspace>
    Returns fileGrps + per-page image/pagexml mapping.
    """
    ws_id = (request.args.get("workspace_id") or "").strip()
    rel = (request.args.get("path") or "").strip()
    if not ws_id or not rel:
        abort(400, "workspace_id and path are required")

    mets_path = _safe_ws_path(ws_id, rel)
    if not mets_path.is_file():
        abort(404, f"METS not found: {mets_path}")

    try:
        mets = OcrdMets(filename=str(mets_path))
    except Exception as e:
        abort(400, f"failed to parse METS: {e}")

    file_grps = sorted({f.fileGrp for f in mets.find_files()})

    def _is_img_grp(g: str) -> bool:
        return g.startswith("OCR-D-IMG")

    images_by_page: Dict[str, Dict] = {}
    pagexml_by_page: Dict[str, Dict] = {}

    for f in mets.find_files():
        href = f.url  # href relative to mets base
        fileGrp = f.fileGrp
        mimetype = f.mimetype or ""
        page_id = f.pageId or ""

        if mimetype.startswith("image/") and page_id:
            rec = {"fileGrp": fileGrp, "href": href, "mimetype": mimetype}
            if page_id not in images_by_page or (
                    _is_img_grp(fileGrp) and not _is_img_grp(images_by_page[page_id]["fileGrp"])):
                images_by_page[page_id] = rec
        if mimetype == "application/vnd.prima.page+xml" and page_id:
            pagexml_by_page[page_id] = {"fileGrp": fileGrp, "href": href, "mimetype": mimetype}

    page_ids = sorted(set(images_by_page) | set(pagexml_by_page))
    pages = [{
        "page_id": pid,
        "image": images_by_page.get(pid),
        "pagexml": pagexml_by_page.get(pid),
    } for pid in page_ids]

    return jsonify({
        "mets_path": str(mets_path),
        "base_dir": str(mets_path.parent),
        "file_grps": file_grps,
        "pages": pages,
    })
