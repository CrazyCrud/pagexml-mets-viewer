from __future__ import annotations
from typing import Union
from pathlib import Path
from typing import Any, Dict, Callable, List, Optional, Tuple
import re
from lxml import etree
from ocrd_models.ocrd_page_generateds import parse as parse_pagexml
from ocrd_models.ocrd_page import PcGtsType, OcrdPage

from .resolve import resolve_image_for_page

PAGE_NS_FALLBACK = "http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15"

"""
Returns
{
  "page_id": "P_0001",
  "image": {"path": "/abs/image.tif", "width": 2480, "height": 3508},
  "regions": [
    {"id": "r1", "type": "TextRegion", "points": [[x,y], ...], "conf": 0.93}
  ],
  "lines": [
    {"id":"l1","region":"r1","points":[[x,y],...],"baseline":[[x,y],...],"conf": 0.87}
  ]
}
"""


def load_page(page_xml_path: str, image_override: Optional[str] = None) -> Dict:
    page_xml = Path(page_xml_path)

    pcgts: PcGtsType = _parse_pcgts(page_xml)
    page = pcgts.get_Page()
    page_id = page.get_id() or page_xml.stem

    # Build a page-coords dict
    page_coords = _page_coords(pcgts)

    # Resolve image path and size
    img_path, width, height = resolve_image_for_page(pcgts, page_xml, image_override)

    # Collect geometry
    regions = _collect_regions(pcgts, page_coords)
    lines = _collect_lines(pcgts, page_coords)

    dto = {
        "page_id": page_id,
        "image": {"path": str(img_path), "width": width, "height": height},
        "regions": regions,
        "lines": lines,
    }

    return dto


def quick_meta(page_xml_path: str) -> Dict:
    pass


def parse_pcgts(page_xml_path: Union[str, Path]) -> PcGtsType:
    """Parse a PAGE-XML file into PcGtsType."""
    return _parse_pcgts(page_xml_path)


def page_coords(pcgts: PcGtsType) -> Dict:
    """Extract page-level coordinate transform + metadata."""
    return _page_coords(pcgts)


def collect_regions(pcgts: PcGtsType, page_coords: Dict) -> List[Dict]:
    """Collect all regions as frontend-ready dicts (points transformed)."""
    return _collect_regions(pcgts, page_coords)


def collect_lines(pcgts: Any, page_coords: Dict[str, Any], xml_path: Optional[str | Path] = None) -> List[Dict]:
    """
    Collect TextLine polygons and baselines.
    Strategy:
      1) Try OCR-D generateds: Page -> TextRegion -> TextLine
      2) If none found, fallback to lxml XPath on xml_path (if provided)
    Applies homography/transform from page_coords["transform"] if present.
    """
    H = (page_coords or {}).get("transform")

    def _parse_points_str(s: Optional[str]) -> List[Tuple[float, float]]:
        if not s:
            return []
        out: List[Tuple[float, float]] = []
        for pair in s.strip().split():
            if "," in pair:
                x, y = pair.split(",", 1)
            elif ";" in pair:
                x, y = pair.split(";", 1)
            else:
                parts = pair.split()
                if len(parts) >= 2:
                    x, y = parts[0], parts[1]
                else:
                    continue
            try:
                out.append((float(x), float(y)))
            except Exception:
                continue
        return out

    def _apply(pts: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        if not pts or H is None:
            return pts
        if callable(H):
            try:
                return H(pts)
            except Exception:
                return pts
        for attr in ("project", "map", "apply", "__call__"):
            fn = getattr(H, attr, None)
            if callable(fn):
                try:
                    return fn(pts)
                except Exception:
                    break
        return pts

    def _first_text_from_obj(line) -> Optional[str]:
        try:
            te_list = line.get_TextEquiv() or []
            if te_list:
                te = te_list[0]
                if hasattr(te, "get_Unicode") and callable(te.get_Unicode):
                    return te.get_Unicode()
                if hasattr(te, "Unicode"):
                    return te.Unicode
        except Exception:
            pass
        return None

    def _conf_of_obj(obj) -> Optional[float]:
        try:
            if hasattr(obj, "get_conf") and callable(obj.get_conf):
                c = obj.get_conf()
                if c is not None:
                    return float(c)
        except Exception:
            pass
        try:
            te_list = getattr(obj, "get_TextEquiv", lambda: [])() or []
            if te_list:
                te = te_list[0]
                if hasattr(te, "get_conf") and callable(te.get_conf):
                    c = te.get_conf()
                    if c is not None:
                        return float(c)
        except Exception:
            pass
        return None

    out: List[Dict] = []

    # -------- 1) OCR-D generateds path --------
    get_Page = getattr(pcgts, "get_Page", None)
    page = get_Page() if callable(get_Page) else getattr(pcgts, "Page", None)

    if page is not None:
        regions = getattr(page, "get_TextRegion", lambda: [])() or []
        for reg in regions:
            try:
                region_id = reg.get_id()
            except Exception:
                region_id = getattr(reg, "id", "") or ""

            lines = getattr(reg, "get_TextLine", lambda: [])() or []
            if not lines:
                # rare: some versions expose attribute list
                lines = getattr(reg, "TextLine", []) or []

            for ln in lines:
                try:
                    lid = ln.get_id()
                except Exception:
                    lid = getattr(ln, "id", "") or ""

                # Coords
                poly_raw: List[Tuple[float, float]] = []
                try:
                    lc = ln.get_Coords()
                    if lc:
                        pts_attr = lc.get_points() if hasattr(lc, "get_points") else getattr(lc, "points", None)
                        poly_raw = _parse_points_str(pts_attr)
                except Exception:
                    pass
                poly = _apply(poly_raw)

                # Baseline
                base_raw: List[Tuple[float, float]] = []
                try:
                    bl = ln.get_Baseline()
                    if bl:
                        bpts_attr = bl.get_points() if hasattr(bl, "get_points") else getattr(bl, "points", None)
                        base_raw = _parse_points_str(bpts_attr)
                except Exception:
                    pass
                base = _apply(base_raw)

                if not poly and not base:
                    continue

                out.append({
                    "id": lid,
                    "region_id": region_id,
                    "points": poly,
                    "baseline": base,
                    "text": _first_text_from_obj(ln),
                    "conf": _conf_of_obj(ln),
                })

    if out:
        return out

    # -------- 2) Fallback: lxml XPath scan --------
    if not xml_path:
        return out  # cannot fallback without path

    p = Path(xml_path)
    if not p.is_file():
        return out

    try:
        tree = etree.parse(str(p))
        root = tree.getroot()
        # find a PAGE namespace from nsmap dynamically
        page_ns = None
        for k, v in (root.nsmap or {}).items():
            if v and "primaresearch.org/PAGE/gts/pagecontent" in v:
                page_ns = v
                break
        ns = {"pc": page_ns} if page_ns else {}
        # Regions + lines
        # If namespace is missing for any reason, use local-name() fallback
        if ns:
            regions_xpath = root.xpath(".//pc:TextRegion", namespaces=ns)
        else:
            regions_xpath = root.xpath(".//*[local-name()='TextRegion']")
        for reg in regions_xpath:
            region_id = reg.get("id", "") or ""
            if ns:
                lines_xpath = reg.xpath("./pc:TextLine", namespaces=ns)
            else:
                lines_xpath = reg.xpath("./*[local-name()='TextLine']")
            for ln in lines_xpath:
                lid = ln.get("id", "") or ""

                # Coords
                if ns:
                    c = ln.xpath("./pc:Coords/@points", namespaces=ns)
                else:
                    c = ln.xpath("./*[local-name()='Coords']/@points")
                poly = _apply(_parse_points_str(c[0] if c else None))

                # Baseline
                if ns:
                    b = ln.xpath("./pc:Baseline/@points", namespaces=ns)
                else:
                    b = ln.xpath("./*[local-name()='Baseline']/@points")
                base = _apply(_parse_points_str(b[0] if b else None))

                if not poly and not base:
                    continue

                # Text (first TextEquiv/Unicode)
                if ns:
                    t = ln.xpath("./pc:TextEquiv/pc:Unicode/text()", namespaces=ns)
                else:
                    t = ln.xpath("./*[local-name()='TextEquiv']/*[local-name()='Unicode']/text()")
                text = t[0] if t else None

                out.append({
                    "id": lid,
                    "region_id": region_id,
                    "points": poly,
                    "baseline": base,
                    "text": text,
                    "conf": None,  # XPath fallback: skip conf unless you want to query @conf
                })
    except Exception:
        pass

    return out


def _parse_pcgts(page_xml_path) -> PcGtsType:
    p = Path(page_xml_path)
    if not p.is_file():
        raise FileNotFoundError(f"PAGE-XML not found: {p}")

    try:
        pcgts = parse_pagexml(str(p))
    except Exception as e:
        # Some tools/files drop xmlns:pc on root; repair and retry once
        try:
            txt = p.read_text(encoding="utf-8")
        except Exception:
            txt = ""
        if txt and "xmlns:pc" not in txt:
            fixed = _inject_page_namespace(txt)
            if fixed != txt:
                p.write_text(fixed, encoding="utf-8")
                try:
                    pcgts = parse_pagexml(str(p))
                except Exception as e2:
                    raise ValueError(f"Failed to parse PAGE-XML '{p}': {e2}") from e2
            else:
                raise ValueError(f"Failed to parse PAGE-XML '{p}': {e}") from e
        else:
            raise ValueError(f"Failed to parse PAGE-XML '{p}': {e}") from e

    if not isinstance(pcgts, PcGtsType):
        raise ValueError(f"Parsed object is not PcGtsType (got {type(pcgts)!r}) for '{p}'")

    return pcgts


def _collect_regions(pcgts, page_coords) -> List[Dict]:
    H = page_coords.get("transform")
    out: List[Dict] = []

    get_Page: Optional[Callable[[], OcrdPage]] = getattr(pcgts, "get_Page", None)
    if callable(get_Page):
        page = get_Page()
    else:
        # Some versions of OCR-D expose Page as an attribute
        page = getattr(pcgts, "Page", None)

    # get all regions of any type
    try:
        regions = page.get_AllRegions()  # includes TextRegion, TableRegion, etc.
    except Exception:
        regions = page.get_TextRegion() or []

    for reg in regions or []:
        # type name like "TextRegionType" -> "TextRegion"
        rtype = reg.__class__.__name__.removesuffix("Type")
        rid = getattr(reg, "id", None) or ""

        coords = getattr(reg, "get_Coords", lambda: None)()
        pts: List[Tuple[float, float]] = []
        if coords:
            try:
                pts = _parse_points_str(coords.points)
            except Exception:
                pts = []

        pts_t = _apply_homography(pts, H)

        # confidence (PAGE has it on Coords sometimes)
        conf = None
        try:
            conf = float(coords.get_conf()) if coords and coords.get_conf() is not None else None
        except Exception:
            conf = None

        # Extract rowIndex and columnIndex from Roles/TableCellRole
        row_index = None
        col_index = None
        try:
            roles = getattr(reg, "get_Roles", lambda: None)()
            if roles:
                table_cell_role = getattr(roles, "get_TableCellRole", lambda: None)()
                if table_cell_role:
                    row_val = getattr(table_cell_role, "get_rowIndex", lambda: None)()
                    col_val = getattr(table_cell_role, "get_columnIndex", lambda: None)()
                    if row_val is not None:
                        row_index = int(row_val)
                    if col_val is not None:
                        col_index = int(col_val)
        except Exception:
            pass

        region_dict = {
            "id": rid,
            "type": rtype,
            "points": pts_t,
            "conf": conf,
        }
        if row_index is not None:
            region_dict["rowIndex"] = row_index
        if col_index is not None:
            region_dict["colIndex"] = col_index

        out.append(region_dict)

    return out


def _collect_lines(pcgts: Any, page_coords: Dict[str, Any]) -> List[Dict]:
    H = (page_coords or {}).get("transform")
    out: List[Dict] = []

    def _parse_points_str(s: Optional[str]) -> List[Tuple[float, float]]:
        if not s:
            return []
        pts: List[Tuple[float, float]] = []
        for pair in s.strip().split():
            if "," in pair:
                x, y = pair.split(",", 1)
            elif ";" in pair:  # tolerate semicolons
                x, y = pair.split(";", 1)
            else:
                parts = pair.split()
                if len(parts) >= 2:
                    x, y = parts[0], parts[1]
                else:
                    continue
            try:
                pts.append((float(x), float(y)))
            except Exception:
                continue
        return pts

    def _apply(pts: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        if not pts or H is None:
            return pts
        if callable(H):
            try:
                return H(pts)
            except Exception:
                return pts
        for attr in ("project", "map", "apply", "__call__"):
            fn = getattr(H, attr, None)
            if callable(fn):
                try:
                    return fn(pts)
                except Exception:
                    break
        return pts

    def _first_text(line) -> Optional[str]:
        try:
            te_list = line.get_TextEquiv() or []
            if te_list:
                te = te_list[0]
                if hasattr(te, "get_Unicode") and callable(te.get_Unicode):
                    return te.get_Unicode()
                if hasattr(te, "Unicode"):
                    return te.Unicode
        except Exception:
            pass
        return None

    def _conf_of(obj) -> Optional[float]:
        try:
            if hasattr(obj, "get_conf") and callable(obj.get_conf):
                c = obj.get_conf()
                if c is not None:
                    return float(c)
        except Exception:
            pass
        try:
            te_list = getattr(obj, "get_TextEquiv", lambda: [])() or []
            if te_list:
                te = te_list[0]
                if hasattr(te, "get_conf") and callable(te.get_conf):
                    c = te.get_conf()
                    if c is not None:
                        return float(c)
        except Exception:
            pass
        return None

    # --- traverse PAGE ---
    get_Page: Optional = getattr(pcgts, "get_Page", None)
    page = get_Page() if callable(get_Page) else getattr(pcgts, "Page", None)
    if page is None:
        return out

    # Be generous about where TextLines live: region.get_TextLine() is the norm
    regions = getattr(page, "get_TextRegion", lambda: [])() or []
    for reg in regions:
        print("Iterate region")
        try:
            region_id = reg.get_id()
        except Exception:
            region_id = getattr(reg, "id", "") or ""

        # Some versions: get_TextLine() may be None/[]; keep defensive
        lines = getattr(reg, "get_TextLine", lambda: [])() or []
        print(lines)
        # Fallbacks seen in the wild (rare, but harmless to check):
        if not lines:
            lines = getattr(reg, "TextLine", []) or lines
            lines = list(lines) if lines else []

        for ln in lines:
            try:
                lid = ln.get_id()
            except Exception:
                lid = getattr(ln, "id", "") or ""

            # Coords polygon
            poly_raw: List[Tuple[float, float]] = []
            try:
                lc = ln.get_Coords()
                if lc:
                    pts_attr = lc.get_points() if hasattr(lc, "get_points") else getattr(lc, "points", None)
                    poly_raw = _parse_points_str(pts_attr)
            except Exception:
                pass
            poly = _apply(poly_raw)

            # Baseline polyline
            base_raw: List[Tuple[float, float]] = []
            try:
                bl = ln.get_Baseline()
                if bl:
                    bpts_attr = bl.get_points() if hasattr(bl, "get_points") else getattr(bl, "points", None)
                    base_raw = _parse_points_str(bpts_attr)
            except Exception:
                pass
            base = _apply(base_raw)

            # keep the line even if only baseline or only polygon is present
            if not poly and not base:
                # extremely defensive: skip truly empty geometry
                continue

            out.append({
                "id": lid,
                "region_id": region_id,
                "points": poly,
                "baseline": base,
                "text": _first_text(ln),
                "conf": _conf_of(ln),
            })

    return out


def _page_coords(pcgts) -> Dict:
    coords = {
        "transform": [[1.0, 0.0, 0.0],
                      [0.0, 1.0, 0.0],
                      [0.0, 0.0, 1.0]],
        "features": "",
        "imageSize": (None, None),
    }

    get_Page: Optional[Callable[[], OcrdPage]] = getattr(pcgts, "get_Page", None)
    if callable(get_Page):
        page = get_Page()
    else:
        # Some versions of OCR-D expose Page as an attribute
        page = getattr(pcgts, "Page", None)

    # Image size
    try:
        width = int(page.get_imageWidth() or 0) or None
        height = int(page.get_imageHeight() or 0) or None
        coords["imageSize"] = (width, height)
    except Exception:
        pass

    # Try parsing from Page/@custom (`coords=[[...],[...],[...]]`)
    custom = None
    try:
        custom = page.get_custom()
    except Exception:
        custom = None

    if custom:
        # Find `coords` and extract all numbers
        m = re.search(r"coords\s*=\s*\[.*?\]", custom, flags=re.IGNORECASE | re.DOTALL)
        if m:
            nums = re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", m.group(0))
            if len(nums) >= 9:
                try:
                    vals = list(map(float, nums[:9]))
                    coords["transform"] = [
                        vals[0:3],
                        vals[3:6],
                        vals[6:9],
                    ]
                except Exception:
                    pass  # TODO

    return coords


def _parse_points_str(points: str) -> List[Tuple[float, float]]:
    """
    Parse PAGE Coords/@points string: 'x,y x,y …' → [(x,y), ...]
    Robust to extra spaces.
    """
    pts: List[Tuple[float, float]] = []
    if not points:
        return pts
    for token in points.strip().split():
        if ',' not in token:
            # tolerate 'x;y' or accidental whitespaces
            token = token.replace(';', ',')
        try:
            x_s, y_s = token.split(',', 1)
            x = float(x_s)
            y = float(y_s)
            pts.append((x, y))
        except Exception:
            continue
    return pts


def _apply_homography(pts: List[Tuple[float, float]], H: List[List[float]]) -> List[Tuple[float, float]]:
    """
    Apply 3x3 homography to a list of (x,y). If H is identity, this is ~free.
    """
    if not pts:
        return pts
    if not H or len(H) != 3 or any(len(row) != 3 for row in H):
        return pts
    # quick check for identity
    if H == [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]:
        return pts

    res: List[Tuple[float, float]] = []
    h00, h01, h02 = H[0]
    h10, h11, h12 = H[1]
    h20, h21, h22 = H[2]
    for x, y in pts:
        w = h20 * x + h21 * y + h22
        if w == 0:
            # degenerate; just skip transform
            res.append((x, y))
            continue
        xn = (h00 * x + h01 * y + h02) / w
        yn = (h10 * x + h11 * y + h12) / w
        res.append((xn, yn))
    return res


def _inject_page_namespace(xml_text: str) -> str:
    """
    If the PAGE namespace declaration is missing on the root, inject a default one.
    This keeps corrupted files (missing xmlns:pc) parseable after a save.
    """
    if not xml_text or "xmlns:pc" in xml_text:
        return xml_text
    pattern = r"<pc:(PcGtsType|PcGts)\b"
    if re.search(pattern, xml_text):
        return re.sub(pattern,
                      lambda m: f'<pc:{m.group(1)} xmlns:pc=\"{PAGE_NS_FALLBACK}\"',
                      xml_text,
                      count=1)
    # fallback: inject default namespace on <PcGts> if no prefix
    pattern2 = r"<PcGts\b"
    if re.search(pattern2, xml_text) and "xmlns=" not in xml_text:
        return re.sub(pattern2,
                      lambda _: f'<PcGts xmlns=\"{PAGE_NS_FALLBACK}\"',
                      xml_text,
                      count=1)
    return xml_text
