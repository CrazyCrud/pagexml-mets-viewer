from __future__ import annotations
from pathlib import Path
from typing import Optional, Callable, Tuple, Any
from ocrd_models.ocrd_page import OcrdPage
from PIL import Image


def resolve_image_for_page(pcgts: Any,
                           page_xml_path: Path | str,
                           image_override: Optional[Path | str] = None) -> Tuple[str, int, int]:
    page_xml_path = Path(page_xml_path).resolve()
    base_dir = page_xml_path.parent

    # Access PAGE element and attributes defensively
    get_Page: Optional[Callable[[], OcrdPage]] = getattr(pcgts, "get_Page", None)
    if callable(get_Page):
        page = get_Page()
    else:
        # Some versions of OCR-D expose Page as an attribute
        page = getattr(pcgts, "Page", None)

    if page is None:
        raise ValueError("Could not access PAGE object from PcGts")

    # Try reading filename from PAGE (@imageFilename)
    page_image_fn = None
    for attr in ("get_imageFilename", "imageFilename"):
        if hasattr(page, attr):
            val = getattr(page, attr) if isinstance(attr, str) and not attr.startswith("get_") else getattr(page,
                                                                                                            attr)()
            # If attr == "imageFilename", val is likely a string; if getter, call it
            page_image_fn = val if isinstance(val, str) and val.strip() else page_image_fn

    # Resolve possible paths in order
    candidates: list[Path] = []

    if page_image_fn:
        p = Path(page_image_fn)
        if p.is_absolute():
            candidates.append(p)
        else:
            # relative to PAGE-XML file location
            candidates.append((base_dir / p))

    if image_override:
        candidates.append(Path(image_override))

    # Get the first working candidate path
    image_path: Optional[Path] = None
    for cand in candidates:
        if cand and cand.exists():
            image_path = cand.resolve()
            break

    if image_path is None:
        tried = ", ".join(str(c.resolve() if isinstance(c, Path) else c) for c in candidates if c)
        raise FileNotFoundError(
            f"Could not resolve page image. Tried: {tried or '(no candidates)'}"
        )

    # Try to get width and height from PAGE attributes
    width = height = None
    for getter, var in (("get_imageWidth", "width"), ("get_imageHeight", "height")):
        if hasattr(page, getter):
            try:
                val = getattr(page, getter)()
                if isinstance(val, (int, float)) and val > 0:
                    if var == "width":
                        width = int(val)
                    else:
                        height = int(val)
            except Exception:
                pass  # TODO

    # If missing, read via PIL
    if width is None or height is None:
        with Image.open(image_path) as im:
            w, h = im.size
        width = w if width is None else width
        height = h if height is None else height

    return str(image_path), int(width), int(height)
