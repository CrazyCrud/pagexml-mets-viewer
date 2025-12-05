from __future__ import annotations
from flask import Blueprint, request, jsonify, abort
from pathlib import Path
from lxml import etree
from typing import Dict, List, Optional
import uuid
import random
import json
import re

from werkzeug.utils import secure_filename
from ocrd_models.ocrd_page_generateds import parse as parse_pagexml
from ocrd_models.ocrd_page import PcGtsType
from core.db import record_workspace, get_workspace

bp_import = Blueprint("import", __name__)

# Root where workspaces live
ROOT = Path("data/workspaces").resolve()
ROOT.mkdir(parents=True, exist_ok=True)

NS = {
    "mets": "http://www.loc.gov/METS/",
    "xlink": "http://www.w3.org/1999/xlink",
}

IMG_EXTS = (".tif", ".tiff", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".jp2")
OCRD_PREFIX = re.compile(r'^(OCR-D-[A-Z0-9-]+[_-])', re.IGNORECASE)


def _ws_paths(ws_id: Optional[str] = None) -> Dict[str, Path]:
    """Return a dict of standard paths for a workspace (creating dirs if needed)."""
    if not ws_id:
        ws_id = str(uuid.uuid4())
    base = ROOT / ws_id
    paths = {
        "id": ws_id,
        "base": base,
        "orig": base / "original",
        "pages": base / "pages",
        "images": base / "images",
        "norm": base / "normalized",
        "state": base / "state.json",
    }
    for k in ("orig", "pages", "images", "norm"):
        paths[k].mkdir(parents=True, exist_ok=True)
    return paths


ADJECTIVES = [
    "brisk", "calm", "vivid", "quiet", "bold", "sunny", "gentle", "lively", "bright", "nimble",
    "steady", "true", "kind", "swift", "solid", "fresh", "clear", "warm", "neat", "sharp"
]
NOUNS = [
    "harbor", "meadow", "quill", "beacon", "canvas", "compass", "echo", "lantern", "maple", "oasis",
    "parchment", "peak", "reef", "ridge", "river", "spruce", "stride", "vista", "willow", "workbench"
]


def _friendly_label(ws_id: str) -> str:
    """Generate a readable passphrase-like label for a workspace."""
    adj = random.choice(ADJECTIVES)
    noun = random.choice(NOUNS)
    suffix = ws_id[:4]
    return f"{adj.title()} {noun.title()} ({suffix})"


def _load_state(p: Dict[str, Path]) -> Dict:
    """Load a simple state.json with minimal metadata."""
    defaults = {
        "workspace_id": p["id"],
        "label": None,
        "pages": [],
        "images": [],
        "mets": None,
        "required_images": [],
        "required_pagexml": [],
        "file_grps": {},
    }
    if p["state"].is_file():
        try:
            raw = json.loads(p["state"].read_text(encoding="utf-8"))
            state = {**defaults, **(raw if isinstance(raw, dict) else {})}
            if not state.get("label"):
                existing = get_workspace(p["id"]) if get_workspace else None
                state["label"] = existing["label"] if existing and existing.get("label") else _friendly_label(p["id"])
            _save_state(p, state)
            return state
        except Exception:
            pass
    existing = get_workspace(p["id"]) if get_workspace else None
    default_label = existing["label"] if existing and existing.get("label") else _friendly_label(p["id"])
    state = {**defaults, "label": default_label}
    _save_state(p, state)
    return state


def _save_state(p: Dict[str, Path], state: Dict):
    try:
        p["state"].write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _image_mime_ok(filename: str) -> bool:
    return filename.lower().endswith(IMG_EXTS)


def _lower_stem(name: str) -> str:
    return Path(name).stem.lower()


def _strip_ocrd_prefix(stem: str) -> str:
    return OCRD_PREFIX.sub('', stem)


def _serialize_pcgts(pcgts: PcGtsType) -> str:
    """Robust serializer across ocrd_models versions."""
    # Try common APIs
    for candidate in (
            lambda: pcgts.to_xml(),  # may return bytes or str
            lambda: pcgts.toXml(),  # older API
    ):
        try:
            out = candidate()
            if isinstance(out, bytes):
                return out.decode("utf-8")
            if isinstance(out, str):
                return out
        except Exception:
            continue
    try:
        elt = pcgts.toEtree() if hasattr(pcgts, "toEtree") else None
        if elt is not None:
            return etree.tostring(elt, encoding="unicode")
    except Exception:
        pass
    return str(pcgts)


def _missing_images_in_page(page_file: Path) -> List[str]:
    """Read a PAGE-XML and return a list of image basenames it references (usually 1)."""
    pcgts: PcGtsType = parse_pagexml(str(page_file))
    page = pcgts.get_Page()
    img = page.get_imageFilename()
    if not img:
        return []
    return [Path(img).name]


def _collect_required_from_pages(p: Dict[str, Path], state: Dict) -> List[str]:
    """Union of required image basenames from state + currently present PAGE files."""
    need = set(state.get("required_images", []))
    for px in p["pages"].glob("*.xml"):
        try:
            need.update(_missing_images_in_page(px))
        except Exception:
            continue
    return sorted(need)


def _missing_images_ext_agnostic(p: Dict[str, Path]) -> list[str]:
    """
    Compare required images with uploaded images by STEM only.
    Returns a user-friendly list of missing basenames (keep original extension as hint).
    """
    required = [Path(n).name for n in _collect_required_from_pages(p, _load_state(p))]
    need_stems = {_lower_stem(n) for n in required}
    have_stems = {_lower_stem(q.name) for q in p["images"].glob("*") if q.is_file()}
    missing_stems = sorted(need_stems - have_stems)

    stem_hint = {}
    for n in required:
        s = _lower_stem(n)
        stem_hint.setdefault(s, n)
    return [stem_hint.get(s, f"{s}.*") for s in missing_stems]


def _missing_pagexml(p: Dict[str, Path]) -> list[str]:
    """Compare required PAGE-XML basenames with those uploaded to pages/."""
    state = _load_state(p)
    required = {Path(n).name for n in state.get("required_pagexml", [])}
    have = {q.name for q in p["pages"].glob("*.xml")}
    return sorted(required - have)


def _touch_db(p: Dict[str, Path], state: Optional[Dict] = None):
    """
    Persist workspace metadata into the lightweight SQLite DB.
    """
    state = state or _load_state(p)
    record_workspace(
        p["id"],
        label=state.get("label"),
        page_count=len(state.get("pages", [])),
        has_mets=bool(state.get("mets"))
    )


def _extract_from_mets_rich(mets_path: Path) -> dict:
    """
    Parse METS and return fileGrp summary + ordered file lists (if structMap present).
    """
    mets_path = Path(mets_path)
    tree = etree.parse(str(mets_path))
    root = tree.getroot()

    filegrps = {}
    for fg in root.xpath(".//mets:fileSec/mets:fileGrp", namespaces=NS):
        use = (fg.get("USE") or "").strip()
        if not use:
            continue
        files = []
        for f in fg.xpath("./mets:file", namespaces=NS):
            fid = f.get("ID") or ""
            mt = f.get("MIMETYPE") or ""
            fl = f.xpath("./mets:FLocat", namespaces=NS)
            href = fl[0].get(f"{{{NS['xlink']}}}href") if fl else ""
            files.append({"id": fid, "href": href, "mimetype": mt})
        filegrps[use] = files

    img_grps = [g for g, fs in filegrps.items() if any((f["mimetype"] or "").startswith("image/") for f in fs)]
    page_grps = [g for g, fs in filegrps.items() if any(f["mimetype"] == "application/vnd.prima.page+xml" for f in fs)]

    chosen_page = next((g for g in page_grps if "GT-PAGE" in g), (page_grps[0] if page_grps else None))
    chosen_img = img_grps[0] if img_grps else None

    f_by_id = {f["id"]: f for fs in filegrps.values() for f in fs}

    ordered_img_ids, ordered_page_ids = [], []
    divs = root.xpath(".//mets:structMap[@TYPE='PHYSICAL']//mets:div[@TYPE='page']", namespaces=NS)
    if divs:
        for d in divs:
            fptr_ids = [el.get("FILEID") for el in d.xpath("./mets:fptr", namespaces=NS)]
            img_id = next(
                (fid for fid in fptr_ids if fid in f_by_id and (f_by_id[fid]["mimetype"] or "").startswith("image/")),
                None)
            pag_id = next((fid for fid in fptr_ids if
                           fid in f_by_id and f_by_id[fid]["mimetype"] == "application/vnd.prima.page+xml"), None)
            if img_id: ordered_img_ids.append(img_id)
            if pag_id: ordered_page_ids.append(pag_id)

    if chosen_img:
        image_files = [f_by_id[i] for i in ordered_img_ids if i in f_by_id] if ordered_img_ids else list(
            filegrps.get(chosen_img, []))
    else:
        image_files = []

    if chosen_page:
        pagexml_files = [f_by_id[i] for i in ordered_page_ids if i in f_by_id] if ordered_page_ids else list(
            filegrps.get(chosen_page, []))
    else:
        pagexml_files = []

    return {
        "file_grps": {
            "images": img_grps,
            "pagexml": page_grps,
            "chosen": {"image": chosen_img, "pagexml": chosen_page},
        },
        "image_files": image_files,
        "pagexml_files": pagexml_files,
    }


@bp_import.post("/upload-pages")
def upload_pages():
    """Upload multiple PAGE-XML files. Returns {workspace_id, pages, missing_images}."""
    ws_id = (request.args.get("workspace_id") or "").strip()
    p = _ws_paths(ws_id)
    state = _load_state(p)

    files = request.files.getlist("files[]")
    if not files:
        return jsonify(error="No files[] provided"), 400

    stored = []
    for f in files:
        raw = Path(f.filename).name
        name = secure_filename(raw)
        if not name.lower().endswith(".xml"):
            continue
        dst = (p["pages"] / name).resolve()
        dst.parent.mkdir(parents=True, exist_ok=True)
        f.save(dst.as_posix())
        stored.append(name)

    # Update state
    state["pages"] = sorted(set(state["pages"]).union(stored))

    # Track required images from newly uploaded PAGE files
    req = set(state.get("required_images", []))
    for name in stored:
        try:
            req.update(_missing_images_in_page(p["pages"] / name))
        except Exception:
            pass
    state["required_images"] = sorted(req)
    _save_state(p, state)
    _touch_db(p, state)

    missing = _missing_images_ext_agnostic(p)
    return jsonify(workspace_id=p["id"], label=state.get("label"), pages=state["pages"], missing_images=missing)


@bp_import.post("/upload-mets")
def upload_mets():
    """
    Upload a METS file. Store under original/mets.xml and extract referenced PAGE/XML + image basenames.
    Returns ordered page basenames and missing files.
    """
    file = request.files.get("file")
    if not file:
        return jsonify(error="No 'file' provided"), 400

    ws_id = (request.args.get("workspace_id") or "").strip()
    p = _ws_paths(ws_id)
    state = _load_state(p)

    dst = (p["orig"] / "mets.xml").resolve()
    file.save(dst.as_posix())
    state["mets"] = "original/mets.xml"

    info = _extract_from_mets_rich(dst)

    page_basenames = [Path(x["href"]).name for x in info["pagexml_files"] if x.get("href")]
    image_basenames = [Path(x["href"]).name for x in info["image_files"] if x.get("href")]

    state["required_pagexml"] = sorted(set(state.get("required_pagexml", [])).union(page_basenames))
    state["required_images"] = sorted(set(state.get("required_images", [])).union(image_basenames))
    state["file_grps"] = info.get("file_grps", {})
    _save_state(p, state)
    _touch_db(p, state)

    missing_images = _missing_images_ext_agnostic(p)
    missing_pagexml = _missing_pagexml(p)

    return jsonify(
        workspace_id=p["id"],
        label=state.get("label"),
        pages=page_basenames,
        missing_images=missing_images,
        missing_pagexml=missing_pagexml,
        file_grps=info.get("file_grps", {})
    )


@bp_import.post("/upload-images")
def upload_images():
    """Upload multiple images. Returns {added, still_missing}."""
    ws_id = (request.args.get("workspace_id") or "").strip()
    if not ws_id:
        return jsonify(error="workspace_id is required"), 400
    p = _ws_paths(ws_id)
    state = _load_state(p)

    files = request.files.getlist("files[]")
    if not files:
        return jsonify(error="No files[] provided"), 400

    added = []
    for f in files:
        raw = Path(f.filename).name
        name = secure_filename(raw)
        if not _image_mime_ok(name):
            continue
        dst = (p["images"] / name).resolve()
        dst.parent.mkdir(parents=True, exist_ok=True)
        f.save(dst.as_posix())
        added.append(name)

    state["images"] = sorted(set(state["images"]).union(added))
    _save_state(p, state)
    _touch_db(p, state)

    still_missing = _missing_images_ext_agnostic(p)
    return jsonify(workspace_id=p["id"], label=state.get("label"), added=added, still_missing=still_missing)


@bp_import.post("/commit-import")
def commit_import():
    """
    Normalize references and write final PAGE-XML into normalized folder.
    For each PAGE-XML:
      - If Page/@imageFilename exists, rewrite to "images/<basename>".
      - If missing or extension mismatch, resolve by STEM against uploaded images and set accordingly.
    """
    ws_id = request.args.get("workspace_id")
    if not ws_id:
        return jsonify(error="workspace_id is required"), 400
    p = _ws_paths(ws_id)

    normalized = []

    # Prefer the high-level to_xml helper if available
    try:
        from ocrd_models.ocrd_page import to_xml as page_to_xml
    except Exception:
        page_to_xml = None

    # Fallback constants for direct export
    PAGE_NS = "http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15"
    XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
    SCHEMA_LOC = f"{PAGE_NS} {PAGE_NS}/pagecontent.xsd"
    namespacedef = f'xmlns:pc="{PAGE_NS}" xmlns:xsi="{XSI_NS}" xsi:schemaLocation="{SCHEMA_LOC}"'

    for src in p["pages"].glob("*.xml"):
        try:
            pcgts = parse_pagexml(str(src))  # from ocrd_models.ocrd_page_generateds
            page = pcgts.get_Page()

            # Rewrite imageFilename to a clean, workspace-relative path
            img = page.get_imageFilename()
            if img:
                basename = Path(img).name
                page.set_imageFilename(f"images/{basename}")

            dst = (p["norm"] / src.name)

            if page_to_xml:
                # Proper namespaces and XML declaration
                xml_bytes = page_to_xml(pcgts, pretty_print=True)  # returns bytes
                dst.write_bytes(xml_bytes)
            else:
                # Fallback: export with explicit namespacedef and correct root element name
                # NOTE: name_ must be 'PcGts' (not 'PcGtsType')
                with open(dst, "wb") as fh:
                    pcgts.export(
                        fh, 0,
                        name_="PcGts",
                        namespacedef_=namespacedef,
                        pretty_print=True,
                    )

            normalized.append(dst.name)
        except Exception as e:
            # print(f"normalize failed for {src}: {e}")
            continue

    _touch_db(p, _load_state(p))
    return jsonify(ok=True, normalized=normalized)


@bp_import.get("/mets/select")
def mets_select():
    """
    Recompute required PAGE/XML and images using user-selected fileGrps.
    Query:
      workspace_id=... (required)
      pagexml_grp=...  (optional; defaults to METS-chosen)
      image_grp=...    (optional; defaults to METS-chosen)
    Response:
      {
        workspace_id,
        pages: [...],                 # required PAGE basenames (ordered if possible)
        missing_images: [...],        # by stem (ext-agnostic)
        missing_pagexml: [...],
        file_grps: { images:[...], pagexml:[...], chosen:{image, pagexml} }
      }
    """
    ws_id = (request.args.get("workspace_id") or "").strip()
    if not ws_id:
        return jsonify(error="workspace_id is required"), 400

    p = _ws_paths(ws_id)
    mets = (p["orig"] / "mets.xml")
    if not mets.is_file():
        return jsonify(error="No METS in this workspace."), 404

    # Parse summary (to get available groups + defaults)
    info = _extract_from_mets_rich(mets)

    # Selected (fallback to defaults from METS)
    chosen_page = (request.args.get("pagexml_grp") or "").strip() or info["file_grps"]["chosen"]["pagexml"]
    chosen_img = (request.args.get("image_grp") or "").strip() or info["file_grps"]["chosen"]["image"]

    # Re-parse METS here to build fileGrp map + structMap order
    tree = etree.parse(str(mets))
    root = tree.getroot()

    # Build fileGrp -> files
    filegrps = {}
    for fg in root.xpath(".//mets:fileSec/mets:fileGrp", namespaces=NS):
        use = (fg.get("USE") or "").strip()
        if not use:
            continue
        files = []
        for f in fg.xpath("./mets:file", namespaces=NS):
            fid = f.get("ID") or ""
            mt = (f.get("MIMETYPE") or "").strip()
            fl = f.xpath("./mets:FLocat", namespaces=NS)
            href = fl[0].get(f"{{{NS['xlink']}}}href") if fl else ""
            files.append({"id": fid, "href": href, "mimetype": mt})
        filegrps[use] = files

    f_by_id = {f["id"]: f for fs in filegrps.values() for f in fs}

    # Build page order (suffix list) from PHYSICAL structMap if present
    def _suffix_from(fid: str, href: str) -> str:
        # prefer numeric/last segment after '_' from ID, else from href stem
        if fid:
            part = fid.rsplit("_", 1)[-1] if "_" in fid else fid
        else:
            stem = Path(href).stem
            part = stem.rsplit("_", 1)[-1] if "_" in stem else stem
        return part

    pages_ordered_suffix = []
    divs = root.xpath(".//mets:structMap[@TYPE='PHYSICAL']//mets:div[@TYPE='page']", namespaces=NS)
    if divs:
        for d in divs:
            label = (d.get("ORDERLABEL") or "").strip()
            if label:
                pages_ordered_suffix.append(label)
            else:
                did = d.get("ID") or ""
                pages_ordered_suffix.append(did.rsplit("_", 1)[-1] if "_" in did else did)

    # Index one group's files by derived page suffix
    def _index_by_suffix(files):
        out = {}
        for f in files:
            out[_suffix_from(f.get("id", ""), f.get("href", ""))] = f
        return out

    # Choose files from the selected groups; preserve structMap order when available
    if chosen_img and chosen_img in filegrps:
        if pages_ordered_suffix:
            idx = _index_by_suffix(filegrps[chosen_img])
            image_files = [idx[s] for s in pages_ordered_suffix if s in idx]
            # append leftovers (not referenced in structMap) at the end
            seen = {id(f) for f in image_files}
            image_files += [f for f in filegrps[chosen_img] if id(f) not in seen]
        else:
            image_files = list(filegrps[chosen_img])
    else:
        image_files = []

    if chosen_page and chosen_page in filegrps:
        if pages_ordered_suffix:
            idx = _index_by_suffix(filegrps[chosen_page])
            pagexml_files = [idx[s] for s in pages_ordered_suffix if s in idx]
            seen = {id(f) for f in pagexml_files}
            pagexml_files += [f for f in filegrps[chosen_page] if id(f) not in seen]
        else:
            pagexml_files = list(filegrps[chosen_page])
    else:
        pagexml_files = []

    # Basenames to require
    page_basenames = [Path(x["href"]).name for x in pagexml_files if x.get("href")]
    image_basenames = [Path(x["href"]).name for x in image_files if x.get("href")]

    # replace (NOT union) so switching groups updates names
    state = _load_state(p)
    state["required_pagexml"] = page_basenames
    state["required_images"] = image_basenames
    state["file_grps"] = {
        "images": info["file_grps"]["images"],
        "pagexml": info["file_grps"]["pagexml"],
        "chosen": {"image": chosen_img, "pagexml": chosen_page},
    }
    _save_state(p, state)
    _touch_db(p, state)

    missing_images = _missing_images_ext_agnostic(p)
    missing_pagexml = _missing_pagexml(p)

    return jsonify(
        workspace_id=p["id"],
        pages=page_basenames,
        missing_images=missing_images,
        missing_pagexml=missing_pagexml,
        file_grps=state["file_grps"]
    )
