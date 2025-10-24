from __future__ import annotations
from typing import Union
from pathlib import Path
from typing import Dict, Callable, List, Optional, Tuple
import re
from ocrd_models.ocrd_page_generateds import parse as parse_pagexml
from ocrd_models.ocrd_page import PcGtsType, OcrdPage

from .resolve import resolve_image_for_page

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


def collect_lines(pcgts: PcGtsType, page_coords: Dict) -> List[Dict]:
    """Collect all lines (with baseline if present) as frontend-ready dicts."""
    return _collect_lines(pcgts, page_coords)


def _parse_pcgts(page_xml_path) -> PcGtsType:
    p = Path(page_xml_path)
    if not p.is_file():
        raise FileNotFoundError(f"PAGE-XML not found: {p}")

    try:
        pcgts = parse_pagexml(str(p))
    except Exception as e:
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

        out.append({
            "id": rid,
            "type": rtype,
            "points": pts_t,
            "conf": conf,
        })

    return out


def _collect_lines(pcgts, page_coords) -> List[Dict]:
    H = page_coords.get("transform")
    out: List[Dict] = []

    get_Page: Optional[Callable[[], OcrdPage]] = getattr(pcgts, "get_Page", None)
    if callable(get_Page):
        page = get_Page()
    else:
        # Some versions of OCR-D expose Page as an attribute
        page = getattr(pcgts, "Page", None)

    # iterate by region to keep context
    for reg in (page.get_TextRegion() or []):
        region_id = getattr(reg, "id", None) or ""
        for line in (reg.get_TextLine() or []):
            lid = getattr(line, "id", None) or ""

            # polygon
            lcoords = getattr(line, "get_Coords", lambda: None)()
            lpts: List[Tuple[float, float]] = []
            if lcoords:
                try:
                    lpts = _parse_points_str(lcoords.points)
                except Exception:
                    lpts = []
            lpts_t = _apply_homography(lpts, H)

            # baseline
            bl = getattr(line, "get_Baseline", lambda: None)()
            blpts: List[Tuple[float, float]] = []
            if bl and getattr(bl, "points", None):
                try:
                    blpts = _parse_points_str(bl.points)
                except Exception:
                    blpts = []
            blpts_t = _apply_homography(blpts, H)

            # text + conf (first TextEquiv)
            text = ""
            conf = None
            try:
                te = line.get_TextEquiv()
                if te:
                    text = te[0].Unicode or ""
                    c = te[0].conf
                    conf = float(c) if c is not None else None
            except Exception:
                pass  # TODO

            out.append({
                "id": lid,
                "region_id": region_id,
                "points": lpts_t,
                "baseline": blpts_t,
                "text": text,
                "conf": conf,
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
