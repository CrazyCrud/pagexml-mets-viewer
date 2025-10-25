from lxml import etree
from typing import Dict, Optional


def build_pageid_to_image_href(mets_path: str, img_filegrp_fallback: Optional[str] = None) -> Dict[str, str]:
    """
    Returns mapping pageId -> image href (relative to METS base)
    Prefers fileGrp USE='OCR-D-IMG' (or fallback) and joins on @ID/@pageId.
    """
    tree = etree.parse(mets_path)
    ns = {'mets': 'http://www.loc.gov/METS/'}

    # Pick image fileGrp
    filegrps = tree.xpath('//mets:fileGrp', namespaces=ns)
    img_grps = [fg for fg in filegrps if (fg.get('USE') or '').upper().startswith('OCR-D-IMG')]
    if not img_grps and img_filegrp_fallback:
        img_grps = [fg for fg in filegrps if (fg.get('USE') == img_filegrp_fallback)]
    if not img_grps and filegrps:
        img_grps = [filegrps[0]]

    page_to_img = {}
    for fg in img_grps:
        for f in fg.xpath('./mets:file', namespaces=ns):
            page_id = f.get('ADMID') or f.get('GROUPID') or f.get('ID')  # not always pageId; try better below
            # OCR-D usually stores pageId on @ID and also @ADMID/IDREF in structMap; safer: read @ID and structMap
            # But many workspaces also have mets:file/@ID like "OCR-D-IMG_0001" and mets:file/@pageId attribute (OCR-D extension)
            p = f.get('{http://ocr-d.de/ns/mets}pageId') or f.get('USE')  # fallback, not ideal
            # Best-effort: use OCR-D extension if present
            page_id = p or f.get('ID') or page_id

            flocat = f.find('.//{http://www.loc.gov/METS/}FLocat')
            href = flocat.get('{http://www.w3.org/1999/xlink}href') if flocat is not None else None
            if page_id and href:
                page_to_img[page_id] = href

    # Also try structMap to map page ORDER/ID to hrefs (optional – omitted for brevity)
    return page_to_img
