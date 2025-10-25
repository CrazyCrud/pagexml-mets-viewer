class OSDViewer {
  constructor() {
    this.viewer = null;
    this.svg = null;
    this.item = null;
    this.showRegions = true;
    this.showLines = true;
  }

  mount(el) {
    this.viewer = OpenSeadragon({
      element: el,
      prefixUrl: '/static/images/osd/',
      showNavigationControl: true,
      gestureSettingsMouse: { clickToZoom: false },
      zoomPerClick: 1.2,
      zoomPerScroll: 1.1,
      visibilityRatio: 1.0,
      minZoomLevel: 0.01,
      maxZoomLevel: 40
    });

    // Re-add overlay after new image opens
    this.viewer.addHandler('open', () => {
      this.item = this.viewer.world.getItemAt(0);
      this._ensureSvg();
      this._anchorSvgToImage();
    });
    this.viewer.addHandler('resize', () => this._anchorSvgToImage());
  }

  setToggles({regions, lines}) {
    if (typeof regions === 'boolean') this.showRegions = regions;
    if (typeof lines   === 'boolean') this.showLines   = lines;
    // Re-apply visibility without redrawing geometry
    if (this.svg) {
      this.svg.querySelectorAll('.region').forEach(n => n.style.display = this.showRegions ? '' : 'none');
      this.svg.querySelectorAll('.line').forEach(n => n.style.display = this.showLines ? '' : 'none');
      this.svg.querySelectorAll('.base').forEach(n => n.style.display = this.showLines ? '' : 'none');
    }
  }

  setImage(url, w, h) {
    // Single-image mode, no pyramid; OSD still handles smooth pan and zoom.
    this.viewer.open({ type: 'image', url, buildPyramid: false });
    // Prepare SVG viewBox to PAGE pixels so overlays use native coords
    this._ensureSvg();
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width',  w);
    this.svg.setAttribute('height', h);
  }

  setOverlays(regions = [], lines = []) {
    if (!this.svg) this._ensureSvg();
    // Clear
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    // Regions
    if (this.showRegions) {
      for (const r of regions) {
        if (!r.points || !r.points.length) continue;
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('class', 'region');
        poly.setAttribute('points', r.points.map(([x,y]) => `${x},${y}`).join(' '));
        this.svg.appendChild(poly);
      }
    }

    // Lines and baselines
    if (this.showLines) {
      for (const l of lines) {
        if (l.points && l.points.length) {
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          poly.setAttribute('class', 'line');
          poly.setAttribute('points', l.points.map(([x,y]) => `${x},${y}`).join(' '));
          this.svg.appendChild(poly);
        }
        if (l.baseline && l.baseline.length) {
          const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          pl.setAttribute('class', 'base');
          pl.setAttribute('points', l.baseline.map(([x,y]) => `${x},${y}`).join(' '));
          this.svg.appendChild(pl);
        }
      }
    }
  }

  fit() {
    this.viewer.viewport.goHome(true);
  }

  zoomIn()  { this.viewer.viewport.zoomBy(1.2).applyConstraints(); }
  zoomOut() { this.viewer.viewport.zoomBy(1/1.2).applyConstraints(); }

  _ensureSvg() {
    if (this.svg) return;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.position = 'absolute';
    this.svg.style.left = 0;
    this.svg.style.top = 0;
  }

  _anchorSvgToImage() {
    if (!this.viewer || !this.svg) return;
    // Remove any previous overlay (safe to call repeatedly)
    try { this.viewer.removeOverlay(this.svg); } catch (_) {}

    if (!this.item) this.item = this.viewer.world.getItemAt(0);
    if (!this.item) return;

    // Anchor SVG to the full image bounds so SVG coordinates are in image pixels
    const bounds = this.item.getBounds(true); // true = current, not cached
    this.viewer.addOverlay({
      element: this.svg,
      location: bounds,
      placement: OpenSeadragon.OverlayPlacement.TOP_LEFT
    });
  }
}

window.OSDViewer = OSDViewer;
