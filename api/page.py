from __future__ import annotations
from pathlib import Path
from typing import Optional, Tuple, Dict, List
from lxml import etree
from flask import Blueprint, request, jsonify, send_file, abort
from collections import Counter
from core.resolve import resolve_image_for_page
from core.page import (
    parse_pcgts,
    page_coords,
    collect_regions,
    collect_lines,
    _inject_page_namespace,
    PAGE_NS_FALLBACK,
)
from ocrd_models.ocrd_page import TextEquivType, TextRegionType, TableRegionType, TextLineType, CoordsType, BaselineType, RolesType, TableCellRoleType
from core.db import record_workspace


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
    # Standard resolver
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

    # Stembased fallback
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
    # Determine mode early
    xml_arg = (request.args.get("xml") or "").strip()
    ws_id = (request.args.get("workspace_id") or "").strip()

    page_xml = _resolve_page_path()
    pcgts = parse_pcgts(str(page_xml))

    # Optional image_override (absolute)
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
    # absolute-XML mode: use the alternate streamer /api/page/image?xml=...
    # workspace mode: use the workspace file server /api/file?workspace_id=...&path=...
    if xml_arg:
        # No workspace context, so stream via /api/page/image
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
    lines = collect_lines(pcgts, coords, page_xml)

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

    region_types = Counter([r.get("type", "Unknown") for r in regions])
    stats = {
        "regions_total": len(regions),
        "regions_by_type": dict(region_types),
        "lines_total": len(lines),
    }

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
        "stats": stats
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


def _serialize_pcgts(pcgts) -> str:
    """Serialize PcGtsType to a unicode string, tolerant across versions."""
    try:
        elt = pcgts.toEtree() if hasattr(pcgts, "toEtree") else None
    except Exception:
        elt = None
    if elt is not None:
        _ensure_page_namespace_on_root(elt)
        return etree.tostring(elt, encoding="unicode")

    for candidate in (
            lambda: pcgts.to_xml(),
            lambda: pcgts.toXml(),
    ):
        try:
            out = candidate()
            if isinstance(out, bytes):
                out = out.decode("utf-8")
            if isinstance(out, str):
                return _inject_page_namespace(out)
        except Exception:
            continue
    return _inject_page_namespace(str(pcgts))


def _ensure_page_namespace_on_root(elt):
    nsmap = elt.nsmap or {}
    has_page_ns = any(v and "primaresearch.org/PAGE/gts/pagecontent" in v for v in nsmap.values())
    if has_page_ns:
        return
    elt.set("{http://www.w3.org/2000/xmlns/}pc", PAGE_NS_FALLBACK)


def _apply_line_texts(pcgts, updates: Dict[str, str]) -> int:
    """
    Update TextLine TextEquiv/Unicode for matching ids.
    Returns number of lines touched.
    """
    updated = 0
    get_Page = getattr(pcgts, "get_Page", None)
    page = get_Page() if callable(get_Page) else getattr(pcgts, "Page", None)
    if page is None:
        return updated

    regions = getattr(page, "get_TextRegion", lambda: [])() or []
    for reg in regions:
        lines = getattr(reg, "get_TextLine", lambda: [])() or []
        if not lines:
            lines = getattr(reg, "TextLine", []) or []
        for ln in lines:
            try:
                lid = ln.get_id()
            except Exception:
                lid = getattr(ln, "id", "") or ""
            if lid not in updates:
                continue
            text_val = updates.get(lid, "")
            if _set_line_text(ln, text_val):
                updated += 1
    return updated


def _set_line_text(line_obj, value: str) -> bool:
    """
    Set TextEquiv/Unicode for a TextLine. Returns True if changed/added.
    """
    current = None
    try:
        te_list = getattr(line_obj, "get_TextEquiv", lambda: [])() or []
    except Exception:
        te_list = []

    if te_list:
        te = te_list[0]
        try:
            current = te.get_Unicode() if hasattr(te, "get_Unicode") else getattr(te, "Unicode", None)
        except Exception:
            current = None
        try:
            if hasattr(te, "set_Unicode") and callable(te.set_Unicode):
                te.set_Unicode(value)
            elif hasattr(te, "Unicode"):
                te.Unicode = value
        except Exception:
            return False
        return (current or "") != value

    try:
        te = TextEquivType(Unicode=value)
        if hasattr(line_obj, "add_TextEquiv") and callable(line_obj.add_TextEquiv):
            line_obj.add_TextEquiv(te)
        elif hasattr(line_obj, "TextEquiv"):
            line_obj.TextEquiv = [te]
        else:
            return False
    except Exception:
        return False
    return True


@bp_page.post("/page/transcription")
def save_transcription():
    """
    Persist user-provided TextLine text back into the PAGE-XML file.
    Accepts JSON: {workspace_id, path, lines:[{id, text}]}
    """
    payload = request.get_json(silent=True) or {}
    ws_id = (payload.get("workspace_id") or "").strip()
    rel = (payload.get("path") or "").strip()
    lines = payload.get("lines") or []

    if not ws_id or not rel:
        abort(400, "workspace_id and path are required")

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

    updates: Dict[str, str] = {}
    for ln in lines:
        lid = str(ln.get("id", "")).strip()
        if not lid:
            continue
        updates[lid] = str(ln.get("text", "") or "")

    pcgts = parse_pcgts(str(page_xml))
    touched = _apply_line_texts(pcgts, updates)

    # Write back
    xml_out = _serialize_pcgts(pcgts)
    page_xml.write_text(xml_out, encoding="utf-8")

    record_workspace(ws_id)

    return jsonify({"ok": True, "updated": touched, "path": str(page_xml)})


def _points_to_str(points: List[List[float]]) -> str:
    return " ".join(f"{float(x)},{float(y)}" for x, y in points)


def _ensure_region(page_obj, region_id: str, region_type: str, points: List[List[float]]):
    coords = CoordsType(points=_points_to_str(points))
    rt_lower = region_type.lower()
    if rt_lower == "tableregion":
        reg = TableRegionType(id=region_id, Coords=coords)
        try:
            page_obj.add_TableRegion(reg)
        except Exception:
            if hasattr(page_obj, "TableRegion") and isinstance(page_obj.TableRegion, list):
                page_obj.TableRegion.append(reg)
            else:
                raise
    else:
        reg = TextRegionType(id=region_id, type_=region_type, Coords=coords)
        try:
            page_obj.add_TextRegion(reg)
        except Exception:
            # Some versions expose TextRegion attribute directly
            if hasattr(page_obj, "TextRegion") and isinstance(page_obj.TextRegion, list):
                page_obj.TextRegion.append(reg)
            else:
                raise
    return reg


def _iter_all_regions(page_obj):
    # Prefer get_AllRegions if available
    if hasattr(page_obj, "get_AllRegions") and callable(page_obj.get_AllRegions):
        regs = page_obj.get_AllRegions() or []
        for r in regs:
            yield r
        return
    # Fallback: TextRegion + TableRegion lists
    for r in getattr(page_obj, "get_TextRegion", lambda: [])() or getattr(page_obj, "TextRegion", []) or []:
        yield r
    for r in getattr(page_obj, "get_TableRegion", lambda: [])() or getattr(page_obj, "TableRegion", []) or []:
        yield r


def _existing_region_ids(page_obj) -> set:
    ids = set()
    for r in _iter_all_regions(page_obj):
        rid = getattr(r, "id", "") or ""
        if rid:
            ids.add(rid)
    return ids


def _find_region(page_obj, region_id: str):
    for r in _iter_all_regions(page_obj):
        if getattr(r, "id", "") == region_id:
            return r
    return None


def _generate_id(prefix: str, existing: set) -> str:
    i = 1
    while True:
        cand = f"{prefix}{i}"
        if cand not in existing:
            return cand
        i += 1


@bp_page.post("/page/region")
def add_or_update_region():
    """
    Add or update a region polygon.
    JSON: {workspace_id, path, region:{id?, type, points:[[x,y],...], rowIndex?, colIndex?}}
    """
    payload = request.get_json(silent=True) or {}
    ws_id = (payload.get("workspace_id") or "").strip()
    rel = (payload.get("path") or "").strip()
    region = payload.get("region") or {}
    r_type = (region.get("type") or "TextRegion").strip()
    r_points = region.get("points") or []
    r_id = (region.get("id") or "").strip()
    r_row_index = region.get("rowIndex")
    r_col_index = region.get("colIndex")

    if not ws_id or not rel:
        abort(400, "workspace_id and path are required")
    if not isinstance(r_points, list) or len(r_points) < 3:
        abort(400, "points must be an array of at least 3 coordinate pairs")

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

    pcgts = parse_pcgts(str(page_xml))
    page_obj = pcgts.get_Page()
    if page_obj is None:
        abort(400, "PAGE object missing in XML")

    existing_ids = _existing_region_ids(page_obj)
    if r_id:
        reg = _find_region(page_obj, r_id)
        if not reg:
            abort(404, f"Region not found: {r_id}")
        try:
            reg.set_type(r_type)
        except Exception:
            try:
                reg.type_ = r_type
            except Exception:
                pass
        try:
            reg.set_Coords(CoordsType(points=_points_to_str(r_points)))
        except Exception:
            reg.Coords = CoordsType(points=_points_to_str(r_points))
    else:
        r_id = _generate_id("r", existing_ids)
        reg = _ensure_region(page_obj, r_id, r_type, r_points)

    # Update or create Roles/TableCellRole with rowIndex and columnIndex
    if r_row_index is not None or r_col_index is not None:
        try:
            # Get or create Roles
            roles = getattr(reg, "get_Roles", lambda: None)()
            if not roles:
                roles = RolesType()
                try:
                    reg.set_Roles(roles)
                except Exception:
                    reg.Roles = roles

            # Get or create TableCellRole
            table_cell_role = getattr(roles, "get_TableCellRole", lambda: None)()
            if not table_cell_role:
                table_cell_role = TableCellRoleType()
                try:
                    roles.set_TableCellRole(table_cell_role)
                except Exception:
                    roles.TableCellRole = table_cell_role

            # Set rowIndex and columnIndex
            if r_row_index is not None:
                try:
                    table_cell_role.set_rowIndex(int(r_row_index))
                except Exception:
                    table_cell_role.rowIndex = int(r_row_index)

            if r_col_index is not None:
                try:
                    table_cell_role.set_columnIndex(int(r_col_index))
                except Exception:
                    table_cell_role.columnIndex = int(r_col_index)
        except Exception as e:
            print(f"Warning: Failed to set table cell roles: {e}")

    xml_out = _serialize_pcgts(pcgts)
    page_xml.write_text(xml_out, encoding="utf-8")
    record_workspace(ws_id)

    response_region = {"id": r_id, "type": r_type, "points": r_points}
    if r_row_index is not None:
        response_region["rowIndex"] = r_row_index
    if r_col_index is not None:
        response_region["colIndex"] = r_col_index

    return jsonify({"ok": True, "region": response_region})


@bp_page.post("/page/line")
def add_or_update_line():
    """
    Add or update a TextLine polygon/baseline/text.
    JSON: {workspace_id, path, line:{id?, region_id, points, baseline, text}}
    """
    payload = request.get_json(silent=True) or {}
    ws_id = (payload.get("workspace_id") or "").strip()
    rel = (payload.get("path") or "").strip()
    line = payload.get("line") or {}
    l_id = (line.get("id") or "").strip()
    region_id = (line.get("region_id") or "").strip()
    l_points = line.get("points") or []
    l_baseline = line.get("baseline") or []
    l_text = line.get("text") or ""

    if not ws_id or not rel or not region_id:
        abort(400, "workspace_id, path, and region_id are required")
    if not l_points and not l_baseline:
        abort(400, "Provide points and/or baseline for the line")

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

    pcgts = parse_pcgts(str(page_xml))
    page_obj = pcgts.get_Page()
    if page_obj is None:
        abort(400, "PAGE object missing in XML")

    region_obj = _find_region(page_obj, region_id)
    if not region_obj:
        abort(404, f"Region not found: {region_id}")

    # Collect ALL line IDs from ALL regions on the page to ensure global uniqueness
    all_regions = list(_iter_all_regions(page_obj))
    existing_ids = set()
    for r in all_regions:
        region_lines = getattr(r, "get_TextLine", lambda: [])() or getattr(r, "TextLine", []) or []
        for ln in region_lines:
            lid = getattr(ln, "id", "")
            if lid:
                existing_ids.add(lid)

    lines = getattr(region_obj, "get_TextLine", lambda: [])() or getattr(region_obj, "TextLine", []) or []

    target_line = None
    if l_id:
        target_line = next((ln for ln in lines if getattr(ln, "id", "") == l_id), None)
        if not target_line:
            abort(404, f"Line not found: {l_id}")
    else:
        l_id = _generate_id("l", existing_ids)
        target_line = TextLineType(id=l_id)
        try:
            region_obj.add_TextLine(target_line)
        except Exception:
            if hasattr(region_obj, "TextLine") and isinstance(region_obj.TextLine, list):
                region_obj.TextLine.append(target_line)
            else:
                raise

    if l_points:
        target_line.set_Coords(CoordsType(points=_points_to_str(l_points)))
    if l_baseline:
        target_line.set_Baseline(BaselineType(points=_points_to_str(l_baseline)))

    if l_text is not None:
        te = TextEquivType(Unicode=str(l_text))
        try:
            target_line.set_TextEquiv([te])
        except Exception:
            target_line.TextEquiv = [te]

    xml_out = _serialize_pcgts(pcgts)
    page_xml.write_text(xml_out, encoding="utf-8")
    record_workspace(ws_id)

    return jsonify({"ok": True, "line": {"id": l_id, "region_id": region_id, "points": l_points, "baseline": l_baseline, "text": l_text}})


@bp_page.post("/page/region/delete")
def delete_region():
    payload = request.get_json(silent=True) or {}
    ws_id = (payload.get("workspace_id") or "").strip()
    rel = (payload.get("path") or "").strip()
    rid = (payload.get("region_id") or "").strip()
    if not ws_id or not rel or not rid:
        abort(400, "workspace_id, path, and region_id are required")

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

    pcgts = parse_pcgts(str(page_xml))
    page_obj = pcgts.get_Page()
    reg = _find_region(page_obj, rid)
    if not reg:
        abort(404, f"Region not found: {rid}")

    removed = False
    try:
        if hasattr(page_obj, "remove_TextRegion"):
            page_obj.remove_TextRegion(reg)
            removed = True
    except Exception:
        pass
    if not removed:
        for attr in ("TextRegion", "TableRegion"):
            lst = getattr(page_obj, attr, None)
            if isinstance(lst, list) and reg in lst:
                lst.remove(reg)
                removed = True
                break
    if not removed:
        abort(400, "Failed to remove region")

    xml_out = _serialize_pcgts(pcgts)
    page_xml.write_text(xml_out, encoding="utf-8")
    record_workspace(ws_id)
    return jsonify({"ok": True, "region_id": rid})


@bp_page.post("/page/line/delete")
def delete_line():
    payload = request.get_json(silent=True) or {}
    ws_id = (payload.get("workspace_id") or "").strip()
    rel = (payload.get("path") or "").strip()
    lid = (payload.get("line_id") or "").strip()
    if not ws_id or not rel or not lid:
        abort(400, "workspace_id, path, and line_id are required")

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

    pcgts = parse_pcgts(str(page_xml))
    page_obj = pcgts.get_Page()
    found = False
    regions = list(_iter_all_regions(page_obj))
    for reg in regions:
        lines = getattr(reg, "get_TextLine", lambda: [])() or getattr(reg, "TextLine", []) or []
        for ln in list(lines):
            if getattr(ln, "id", "") == lid:
                try:
                    reg.remove_TextLine(ln)
                except Exception:
                    if hasattr(reg, "TextLine") and isinstance(reg.TextLine, list):
                        try:
                            reg.TextLine.remove(ln)
                        except Exception:
                            pass
                found = True
                break
        if found:
            break
    if not found:
        abort(404, f"Line not found: {lid}")

    xml_out = _serialize_pcgts(pcgts)
    page_xml.write_text(xml_out, encoding="utf-8")
    record_workspace(ws_id)
    return jsonify({"ok": True, "line_id": lid})
