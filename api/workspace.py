from __future__ import annotations

import io
import json
import shutil
import zipfile
from pathlib import Path
from typing import Dict, List

from flask import Blueprint, jsonify, abort, send_file

from core.db import list_workspaces, record_workspace, remove_workspace
from api.upload import _ws_paths, _load_state, _missing_images_ext_agnostic, _missing_pagexml

bp_workspace = Blueprint("workspace_api", __name__)

ROOT = Path("data/workspaces").resolve()


def _safe_id(ws_id: str) -> str:
    ws_id = (ws_id or "").strip()
    # basic traversal guard: only accept basename
    if not ws_id or Path(ws_id).name != ws_id:
        abort(400, description="invalid workspace id")
    return ws_id


def _sync_dirs_into_db():
    """
    Ensure existing workspace folders are present in the DB (best-effort).
    """
    if not ROOT.exists():
        return
    for d in ROOT.iterdir():
        if d.is_dir():
            state_path = d / "state.json"
            state = None
            if state_path.is_file():
                try:
                    state = json.loads(state_path.read_text(encoding="utf-8"))
                except Exception:
                    state = None
            record_workspace(
                d.name,
                page_count=len(state.get("pages", [])) if state else None,
                has_mets=bool(state.get("mets")) if state else None
            )


@bp_workspace.get("/workspaces")
def list_ws():
    _sync_dirs_into_db()
    rows = list_workspaces()
    return jsonify({"workspaces": rows})


@bp_workspace.get("/workspaces/<ws_id>")
def load_workspace(ws_id: str):
    ws_id = _safe_id(ws_id)
    base = (ROOT / ws_id).resolve()
    if not base.is_dir():
        abort(404, description="workspace not found")
    paths = _ws_paths(ws_id)

    state = _load_state(paths)
    missing_images = _missing_images_ext_agnostic(paths)
    missing_pagexml = _missing_pagexml(paths)

    record_workspace(ws_id, page_count=len(state.get("pages", [])), has_mets=bool(state.get("mets")))

    return jsonify({
        "workspace_id": ws_id,
        "state": state,
        "pages": state.get("pages", []),
        "missing_images": missing_images,
        "missing_pagexml": missing_pagexml,
        "file_grps": state.get("file_grps", {}),
    })


@bp_workspace.delete("/workspaces/<ws_id>")
def delete_workspace(ws_id: str):
    ws_id = _safe_id(ws_id)
    base = (ROOT / ws_id).resolve()
    if ROOT not in base.parents and base != ROOT:
        abort(403, description="invalid workspace base")

    if base.exists():
        shutil.rmtree(base, ignore_errors=True)
    remove_workspace(ws_id)
    return jsonify({"deleted": ws_id})


@bp_workspace.get("/workspaces/<ws_id>/download")
def download_workspace(ws_id: str):
    ws_id = _safe_id(ws_id)
    base = (ROOT / ws_id).resolve()
    if not base.is_dir():
        abort(404, description="workspace not found")
    paths = _ws_paths(ws_id)

    # Prefer normalized PAGE-XML if present, else raw pages
    pages_dir = paths["norm"] if paths["norm"].exists() and any(paths["norm"].glob("*.xml")) else paths["pages"]
    files: List[Path] = sorted(pages_dir.glob("*.xml"))
    if not files:
        abort(404, description="no PAGE-XML files to download")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, arcname=f.name)
    buf.seek(0)

    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{ws_id}_pagexml.zip"
    )
