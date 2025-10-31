from __future__ import annotations
from pathlib import Path
from typing import Dict, List
from lxml import etree
import re

NS = {
    "mets": "http://www.loc.gov/METS/",
    "xlink": "http://www.w3.org/1999/xlink"
}

_numtail = re.compile(r".*?(\d+)$", re.ASCII)


def _mtype(s: str | None) -> str:
    return (s or "").strip().lower()


def _page_suffix_from_id_or_href(fid: str, href: str) -> str:
    """
    Extract page suffix (e.g., '0001') from a file ID like 'OCR-D-IMG_0001'
    or from href stem like 'OCR-D-SEG_0001.xml' -> '0001'.
    """
    if fid:
        if "_" in fid:
            suf = fid.rsplit("_", 1)[-1]
            if suf:
                return suf
        # fallback to numbers at the end
        m = _numtail.match(fid)
        if m:
            return m.group(1)
    if href:
        stem = Path(href).stem
        if "_" in stem:
            suf = stem.rsplit("_", 1)[-1]
            if suf:
                return suf
        m = _numtail.match(stem)
        if m:
            return m.group(1)
    # last resort: return the stem itself
    return Path(href).stem or fid


def _natural_sort(vals: List[str]) -> List[str]:
    def key(v: str):
        m = _numtail.match(v)
        return (int(m.group(1)) if m else float("inf"), v)

    return sorted(vals, key=key)


def parse_mets_summary(mets_path: str) -> Dict:
    """Return fileGrp lists and per-page candidates from METS (robust to common edge cases)."""
    p = Path(mets_path)
    tree = etree.parse(str(p))
    root = tree.getroot()

    # Collect fileGrps: files (ID, href, mimetype)
    filegrps: Dict[str, List[Dict]] = {}
    for fg in root.xpath(".//mets:fileSec/mets:fileGrp", namespaces=NS):
        use = (fg.get("USE") or "").strip()
        if not use:
            continue
        files: List[Dict] = []
        for f in fg.xpath("./mets:file", namespaces=NS):
            fid = f.get("ID") or ""
            mimetype = _mtype(f.get("MIMETYPE"))
            fl = f.xpath("./mets:FLocat", namespaces=NS)
            href = fl[0].get(f"{{{NS['xlink']}}}href") if fl else ""
            files.append({"id": fid, "mimetype": mimetype, "href": href})
        filegrps[use] = files

    # Group lists by type
    img_grps = [g for g, fs in filegrps.items() if any(
        (f["mimetype"].startswith("image/")) or Path(f["href"]).suffix.lower() in (".tif", ".tiff", ".jpg", ".jpeg",
                                                                                   ".png", ".jp2", ".bmp", ".gif",
                                                                                   ".webp") for f in fs)]
    page_grps = [g for g, fs in filegrps.items() if any(
        f["mimetype"] == "application/vnd.prima.page+xml" or Path(f["href"]).suffix.lower() == ".xml" for f in fs)]

    # Page order from structMap
    pages_ordered: List[str] = []
    divs = root.xpath(".//mets:structMap[@TYPE='PHYSICAL']//mets:div[@TYPE='page']", namespaces=NS)
    if divs:
        for d in divs:
            label = (d.get("ORDERLABEL") or "").strip()
            if label:
                pages_ordered.append(label)
            else:
                did = d.get("ID") or ""
                m = _numtail.match(did)
                pages_ordered.append(m.group(1) if m else (did.rsplit("_", 1)[-1] if "_" in did else did))
    else:
        candidates = []
        for g in img_grps:
            for f in filegrps[g]:
                candidates.append(_page_suffix_from_id_or_href(f.get("id", ""), f.get("href", "")))
        pages_ordered = _natural_sort(list(set(candidates)))

    def index_by_suffix(files: List[Dict]) -> Dict[str, Dict]:
        out = {}
        for f in files:
            suf = _page_suffix_from_id_or_href(f.get("id", ""), f.get("href", ""))
            out[suf] = f
        return out

    # Choose default groups: prefer GT-PAGE for PAGE XML, then any SEG, else first
    chosen_img_grp = img_grps[0] if img_grps else None

    chosen_page_grp = None
    for g in page_grps:
        if "gt-page" in g.lower():
            chosen_page_grp = g;
            break
    if not chosen_page_grp:
        for g in page_grps:
            if g.upper().startswith("OCR-D-SEG"):
                chosen_page_grp = g;
                break
    if not chosen_page_grp and page_grps:
        chosen_page_grp = page_grps[0]

    img_idx = index_by_suffix(filegrps.get(chosen_img_grp, [])) if chosen_img_grp else {}
    page_idx = index_by_suffix(filegrps.get(chosen_page_grp, [])) if chosen_page_grp else {}

    pages: List[Dict] = []
    for suf in pages_ordered:
        img = img_idx.get(suf)
        pag = page_idx.get(suf)
        pages.append({
            "page_id": suf,
            "image": img,  # may be None
            "pagexml": pag  # may be None
        })

    return {
        "img_grps": img_grps,
        "pagexml_grps": page_grps,
        "chosen": {"image": chosen_img_grp, "pagexml": chosen_page_grp},
        "pages": pages
    }
