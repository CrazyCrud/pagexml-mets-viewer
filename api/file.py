from pathlib import Path
from flask import Blueprint, request, send_file, abort

bp_file = Blueprint("file", __name__, url_prefix="/api")

WORKSPACES = Path("data/workspaces").resolve()


def _safe_join_ws(ws_id: str, rel: str) -> Path:
    base = (WORKSPACES / ws_id).resolve()
    p = (base / rel.lstrip("/\\")).resolve()
    if base not in p.parents and p != base:
        abort(403)
    return p


@bp_file.get("/file")
def serve_file():
    ws_id = (request.args.get("workspace_id") or "").strip()
    rel = (request.args.get("path") or "").strip()
    if not ws_id or not rel:
        abort(400, "workspace_id and path are required")
    p = _safe_join_ws(ws_id, rel)
    if not p.is_file():
        abort(404)
    return send_file(str(p), conditional=True)
