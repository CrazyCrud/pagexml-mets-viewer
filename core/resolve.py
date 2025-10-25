from __future__ import annotations
import difflib
import os
import re
from pathlib import Path
from typing import Optional, Callable, Tuple, Any, Iterable, List
from ocrd_models.ocrd_page import OcrdPage
from PIL import Image

IMAGE_EXTS = {".tif", ".tiff", ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".jp2"}

# OCR-D-style prefixes
OCRD_PREFIX = re.compile(r'^(OCR-D-[A-Z0-9-]+[_-])', re.IGNORECASE)


def _basename(p: Path | str) -> str:
    return Path(p).name


def _stem(p: Path | str) -> str:
    return Path(p).stem


def _strip_ocrd_prefix(stem: str) -> str:
    return OCRD_PREFIX.sub("", stem)


def _is_image(p: Path) -> bool:
    return p.is_file() and p.suffix.lower() in IMAGE_EXTS


def _gather_images_from_dirs(dirs: Iterable[Path]) -> List[Path]:
    out: List[Path] = []
    seen = set()
    for d in dirs:
        if not d or not d.exists() or not d.is_dir():
            continue
        for child in d.iterdir():
            if child.is_file() and _is_image(child):
                key = str(child.resolve()).lower()
                if key not in seen:
                    seen.add(key)
                    out.append(child.resolve())
    # Prefer deterministic order
    out.sort()
    return out


def _detect_workspace_root(page_xml_dir: Path) -> Optional[Path]:
    """
    Try to detect a workspace root by looking for known folders
    like 'images', 'pages', 'normalized' near the PAGE-XML.
    """
    candidates = [page_xml_dir, page_xml_dir.parent, page_xml_dir.parent.parent]
    for c in candidates:
        if not c or not c.exists():
            continue
        kids = {k.name.lower() for k in c.iterdir() if k.is_dir()}
        if {"images"} & kids or {"pages"} & kids or {"normalized"} & kids:
            return c
    return None


def _prefer_images_dir(paths: List[Path]) -> Path:
    """
    If multiple candidates, prefer those under a folder named 'images'
    somewhere in their path; otherwise pick the first (sorted) path.
    """
    in_images = [p for p in paths if "images" in {part.lower() for part in p.parts}]
    return (in_images or paths)[0]


def _match_by_exact_basename(target_basename: str | None, candidates: List[Path]) -> Optional[Path]:
    if not target_basename:
        return None
    tb = target_basename.lower()
    # If target is a full path, normalize to its basename
    tb = os.path.basename(tb)
    # Case-insensitive basename match
    hits = [p for p in candidates if p.name.lower() == tb]
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    return _prefer_images_dir(hits)


def _match_by_stem_heuristics(page_xml_path: Path, candidates: List[Path]) -> Optional[Path]:
    """
    Heuristics for cases like PAGE 'OCR-D-SEG_1701_001.xml' vs image '1701_001.jpg'.
    1) strip OCR-D prefix from the PAGE-XML stem
    2) exact stem match
    3) endswith stem match
    4) fuzzy match on stems (cutoff 0.9)
    """
    page_stem = _stem(page_xml_path)
    cand_stem = _strip_ocrd_prefix(page_stem) or page_stem

    # Build stem to paths map
    stems_map: dict[str, List[Path]] = {}
    for p in candidates:
        s = _stem(p).lower()
        stems_map.setdefault(s, []).append(p)

    exact = stems_map.get(cand_stem.lower(), [])
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return _prefer_images_dir(exact)

    tail = [p for s, lst in stems_map.items() if s.endswith(cand_stem.lower()) for p in lst]
    if len(tail) == 1:
        return tail[0]
    if len(tail) > 1:
        return _prefer_images_dir(tail)

    choices = list(stems_map.keys())
    best = difflib.get_close_matches(cand_stem.lower(), choices, n=3, cutoff=0.9)
    if best:
        opts = stems_map[best[0]]
        if len(opts) == 1:
            return opts[0]
        return _prefer_images_dir(opts)

    return None


def _collect_candidate_images(page_xml_path: Path, uploaded_images: Optional[Iterable[Path | str]]) -> List[Path]:
    """
    If uploaded_images is provided, use that list.
    Otherwise, scan likely locations:
      - <PAGE_DIR>/images
      - <PAGE_DIR>
      - <PAGE_DIR>/../images
      - <WORKSPACE_ROOT>/images   (if detectable)
      - <WORKSPACE_ROOT>/normalized/images (sometimes used)
    """
    if uploaded_images:
        paths = [Path(p).resolve() for p in uploaded_images]
        return [p for p in paths if _is_image(p)]

    page_dir = page_xml_path.parent
    workspace_root = _detect_workspace_root(page_dir)

    dirs = [
        page_dir / "images",
        page_dir,
        page_dir.parent / "images",
    ]

    if workspace_root:
        dirs.extend([
            workspace_root / "images",
            workspace_root / "normalized" / "images",
        ])

    return _gather_images_from_dirs(dirs)


def resolve_image_for_page(
        pcgts: Any,
        page_xml_path: Path | str,
        image_override: Optional[Path | str] = None,
        uploaded_images: Optional[Iterable[Path | str]] = None,
) -> Tuple[str, int, int]:
    """
    Resolve the image file for a given PAGE-XML. Returns (path, width, height).

    Resolution order:
      1) image_override (if provided)
      2) Page@imageFilename (absolute OR relative to PAGE-XML location)
      3) Heuristics based on PAGE-XML filename vs image files found near the PAGE

    Width/height are taken from PAGE getters if available; otherwise read via PIL.
    """
    page_xml_path = Path(page_xml_path).resolve()
    base_dir = page_xml_path.parent

    # 0) override
    if image_override:
        image_path = Path(image_override).resolve()
        if not image_path.exists():
            raise FileNotFoundError(f"image_override does not exist: {image_path}")
        width, height = _get_size_from_page_or_pil(pcgts, image_path)
        return str(image_path), int(width), int(height)

    # Access PAGE element and attributes defensively
    get_Page: Optional[Callable[[], OcrdPage]] = getattr(pcgts, "get_Page", None)
    if callable(get_Page):
        page = get_Page()
    else:
        page = getattr(pcgts, "Page", None)
    if page is None:
        raise ValueError("Could not access PAGE object from PcGts")

    # Try reading filename from PAGE (@imageFilename)
    page_image_fn = None
    for attr in ("get_imageFilename", "imageFilename"):
        if hasattr(page, attr):
            try:
                val = getattr(page, attr) if (isinstance(attr, str) and not attr.startswith("get_")) else getattr(page,
                                                                                                                  attr)()
                if isinstance(val, str) and val.strip():
                    page_image_fn = val
                    break
            except Exception:
                pass

    # Candidate images to search (if needed)
    candidates = _collect_candidate_images(page_xml_path, uploaded_images)

    # If PAGE gives a path, try it (absolute, then relative to PAGE)
    tried: list[str] = []
    if page_image_fn:
        p = Path(page_image_fn)
        if p.is_absolute() and p.exists():
            image_path = p.resolve()
            width, height = _get_size_from_page_or_pil(pcgts, image_path)
            return str(image_path), int(width), int(height)
        else:
            rel = (base_dir / p).resolve()
            if rel.exists():
                image_path = rel
                width, height = _get_size_from_page_or_pil(pcgts, image_path)
                return str(image_path), int(width), int(height)
            tried.append(str(rel))

        # If PAGE gave only a basename that doesn’t exist at rel/abs, try matching by basename among candidates
        hit = _match_by_exact_basename(os.path.basename(page_image_fn), candidates)
        if hit:
            width, height = _get_size_from_page_or_pil(pcgts, hit)
            return str(hit), int(width), int(height)

    # Heuristic match using PAGE-XML filename vs images
    hit = _match_by_stem_heuristics(page_xml_path, candidates)
    if hit:
        width, height = _get_size_from_page_or_pil(pcgts, hit)
        return str(hit), int(width), int(height)

    # Nothing found
    if page_image_fn and tried:
        attempt_str = ", ".join(tried)
    else:
        attempt_str = "(no viable candidates / empty search set)"
    raise FileNotFoundError(
        f"Could not resolve page image for '{page_xml_path.name}'. Tried: {attempt_str}"
    )


def _get_size_from_page_or_pil(pcgts: Any, image_path: Path) -> Tuple[int, int]:
    """
    Try to get width/height from PAGE getters; if missing or invalid, read via PIL.
    """
    width = height = None

    # Access PAGE element
    get_Page: Optional[Callable[[], OcrdPage]] = getattr(pcgts, "get_Page", None)
    page = get_Page() if callable(get_Page) else getattr(pcgts, "Page", None)

    # Try PAGE-provided width/height
    if page is not None:
        for getter, key in (("get_imageWidth", "width"), ("get_imageHeight", "height")):
            if hasattr(page, getter):
                try:
                    val = getattr(page, getter)()
                    if isinstance(val, (int, float)) and val > 0:
                        if key == "width":
                            width = int(val)
                        else:
                            height = int(val)
                except Exception:
                    pass

    # Read with PIL if needed
    if width is None or height is None:
        with Image.open(image_path) as im:
            w, h = im.size
        width = w if width is None else width
        height = h if height is None else h

    return int(width), int(height)
