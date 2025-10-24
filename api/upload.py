from __future__ import annotations
from flask import Blueprint, request, jsonify
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import uuid
import json

# OCR-D models to parse PAGE-XML and optionally METS
from ocrd_models.ocrd_page_generateds import parse as parse_pagexml
from ocrd_models.ocrd_page import PcGtsType

try:
    from ocrd_models import OcrdMets  # optional only needed for METS upload

    HAVE_METS = True
except Exception:
    HAVE_METS = False

bp_import = Blueprint("import", __name__)

# Root where ephemeral workspaces live
ROOT = Path("data/workspaces").resolve()
ROOT.mkdir(parents=True, exist_ok=True)


def _ws_paths(ws_id: Optional[str] = None) -> Dict[str, Path]:
    """
    Return a dict of standard paths for a workspace (creating dirs if needed).
    """
    if not ws_id:
        ws_id = str(uuid.uuid4())
    base = ROOT / ws_id
    paths = {
        "id": ws_id,
        "base": base,
        "orig": base / "original",  # original uploads (METS etc)
        "pages": base / "pages",  # uploaded PAGE-XMLs
        "images": base / "images",  # uploaded images
        "norm": base / "normalized",  # normalized PAGE-XMLs with fixed paths
        "state": base / "state.json",  # book-keeping
    }
    for k in ("orig", "pages", "images", "norm"):
        paths[k].mkdir(parents=True, exist_ok=True)
    return paths


def _load_state(p: Dict[str, Path]) -> Dict:
    """
    Load (or create) a simple state.json with minimal metadata.
    """
    if p["state"].is_file():
        try:
            return json.loads(p["state"].read_text(encoding="utf-8"))
        except Exception:
            pass
    state = {
        "workspace_id": p["id"],
        "pages": [],  # list of uploaded PAGE-XML filenames (in pages/)
        "images": [],  # list of uploaded image filenames (in images/)
        "mets": None,  # uploaded mets path (in original/)
        "required_images": [],  # basenames referenced by PAGE/METS (union)
    }
    _save_state(p, state)
    return state


def _save_state(p: Dict[str, Path], state: Dict):
    try:
        p["state"].write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _image_mime_ok(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith((".tif", ".tiff", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"))


def _missing_images_in_page(page_file: Path) -> List[str]:
    """
    Read a PAGE-XML and return a list of image basenames it references (usually 1).
    """
    pcgts: PcGtsType = parse_pagexml(str(page_file))
    page = pcgts.get_Page()
    img = page.get_imageFilename()
    if not img:
        return []
    return [Path(img).name]


def _scan_missing_from_pages(p: Dict[str, Path], state: Dict) -> List[str]:
    """
    Go through all uploaded PAGE-XMLs (pages/), collect basenames, and return
    those that are still missing in images/.
    """
    need = set(state.get("required_images", []))
    # Always include references from PAGE files currently present:
    for px in p["pages"].glob("*.xml"):
        try:
            need.update(_missing_images_in_page(px))
        except Exception:
            continue
    existing = {f.name for f in p["images"].iterdir() if f.is_file() and _image_mime_ok(f.name)}
    return sorted([n for n in need if n not in existing])


def _extract_from_mets(mets_path: Path) -> Tuple[List[str], List[str]]:
    """
    Return (page_xml_hrefs, image_hrefs) from METS if OCR-D models are available.
    If not, returns ([], []).
    """
    if not HAVE_METS:
        return [], []
    mets = OcrdMets(filename=str(mets_path))
    page_hrefs: List[str] = []
    image_hrefs: List[str] = []
    for f in mets.find_files():
        mt = (f.mimetype or "").lower()
        href = f.local_filename or f.url or f.ID
        if not href:
            continue
        if "application/vnd.prima.page+xml" in mt or href.lower().endswith(".xml"):
            page_hrefs.append(href)
        elif mt.startswith("image/") or _image_mime_ok(href):
            image_hrefs.append(href)
    return page_hrefs, image_hrefs


@bp_import.post("/api/upload-pages")
def upload_pages():
    """
    Upload multiple PAGE-XML files into a new or existing workspace.
    Returns {workspace_id, pages, missing_images}.
    """
    ws_id = request.args.get("workspace_id")
    p = _ws_paths(ws_id)
    state = _load_state(p)

    files = request.files.getlist("files[]")
    if not files:
        return jsonify(error="No files[] provided"), 400

    stored = []
    for f in files:
        name = Path(f.filename).name
        if not name.lower().endswith(".xml"):
            # ignore silently or return 400 – choose to ignore for convenience
            continue
        dst = (p["pages"] / name).resolve()
        dst.parent.mkdir(parents=True, exist_ok=True)
        f.save(dst.as_posix())
        stored.append(name)

    # Update state
    state["pages"] = sorted(set(state["pages"]).union(stored))

    # Collect required images from freshly uploaded PAGE files
    req = set(state.get("required_images", []))
    for name in stored:
        try:
            req.update(_missing_images_in_page(p["pages"] / name))
        except Exception:
            pass
    state["required_images"] = sorted(req)

    # Compute currently missing images
    missing = _scan_missing_from_pages(p, state)

    _save_state(p, state)
    return jsonify(workspace_id=p["id"], pages=state["pages"], missing_images=missing)


@bp_import.post("/api/upload-mets")
def upload_mets():
    """
    Upload a single METS file. We store it under original/mets.xml
    and extract referenced PAGE-XML + image hrefs (basenames).
    Returns {workspace_id, pages (basenames), missing_images (basenames)}.
    """
    file = request.files.get("file")
    if not file:
        return jsonify(error="No 'file' provided"), 400

    ws_id = request.args.get("workspace_id")
    p = _ws_paths(ws_id)
    state = _load_state(p)

    dst = (p["orig"] / "mets.xml").resolve()
    file.save(dst.as_posix())
    state["mets"] = "original/mets.xml"

    # Extract references (best effort)
    page_hrefs, image_hrefs = _extract_from_mets(dst)
    page_basenames = sorted({Path(h).name for h in page_hrefs})
    image_basenames = sorted({Path(h).name for h in image_hrefs})

    state["required_images"] = sorted(set(state.get("required_images", [])).union(image_basenames))
    # Do not need to auto-import PAGE-XML files from METS; user uploads them via /api/upload-pages
    _save_state(p, state)

    missing = _scan_missing_from_pages(p, state)
    return jsonify(workspace_id=p["id"], pages=page_basenames, missing_images=missing)


@bp_import.post("/api/upload-images")
def upload_images():
    """
    Upload multiple images for an existing workspace.
    Returns {added, still_missing}.
    """
    ws_id = request.args.get("workspace_id")
    if not ws_id:
        return jsonify(error="workspace_id is required"), 400
    p = _ws_paths(ws_id)
    state = _load_state(p)

    files = request.files.getlist("files[]")
    if not files:
        return jsonify(error="No files[] provided"), 400

    added = []
    for f in files:
        name = Path(f.filename).name
        if not _image_mime_ok(name):
            # ignore non-image file
            continue
        dst = (p["images"] / name).resolve()
        dst.parent.mkdir(parents=True, exist_ok=True)
        f.save(dst.as_posix())
        added.append(name)

    # Update state
    state["images"] = sorted(set(state["images"]).union(added))

    still_missing = _scan_missing_from_pages(p, state)
    _save_state(p, state)
    return jsonify(added=added, still_missing=still_missing)


@bp_import.post("/api/commit-import")
def commit_import():
    """
    Normalize references and write final PAGE-XML into normalized/.

    For each PAGE-XML:
      - Rewrite Page/@imageFilename to "images/<basename>" (relative within workspace).
    """
    ws_id = request.args.get("workspace_id")
    if not ws_id:
        return jsonify(error="workspace_id is required"), 400
    p = _ws_paths(ws_id)
    state = _load_state(p)

    normalized = []
    for src in p["pages"].glob("*.xml"):
        try:
            pcgts: PcGtsType = parse_pagexml(str(src))
            page = pcgts.get_Page()
            img = page.get_imageFilename()
            if img:
                basename = Path(img).name
                # Set a clean relative path anchored at workspace root:
                page.set_imageFilename(f"images/{basename}")
            dst = (p["norm"] / src.name)
            dst.write_text(pcgts.to_xml("utf-8").decode("utf-8"), encoding="utf-8")
            normalized.append(dst.name)
        except Exception as e:
            # continue best effort
            continue

    return jsonify(ok=True, normalized=normalized)
