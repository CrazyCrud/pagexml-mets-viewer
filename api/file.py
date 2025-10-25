from __future__ import annotations
from pathlib import Path
from flask import Blueprint, request, send_file, abort

WORKSPACES_ROOT = Path("data/workspaces").resolve()

bp_file = Blueprint("file", __name__)


def _safe_under(base: Path, rel: str) -> Path:
    rel = rel.lstrip("/\\")
    p = (base / rel).resolve()
    base = base.resolve()
    if base not in p.parents and p != base:
        abort(403, description="path traversal blocked")
    return p


@bp_file.get("/file")
def serve_file():
    ws_id = (request.args.get("workspace_id") or "").strip()
    rel = (request.args.get("path") or "").strip()
    if not ws_id or not rel:
        abort(400, description="missing workspace_id or path")

    base = (WORKSPACES_ROOT / ws_id).resolve()
    if not base.is_dir():
        abort(404, description=f"workspace not found: {base}")

    p = _safe_under(base, rel)
    if not p.is_file():
        abort(404, description=f"file not found: {p}")
    return send_file(str(p), conditional=True)
