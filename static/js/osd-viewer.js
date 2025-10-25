// static/js/osd-viewer.js
class OSDViewer {
  constructor() {
    this.viewer = null;
    this.svg = null;
    this.gRegions = null;
    this.gLines = null;
    this.item = null;
    this.showRegions = true;
    this.showLines = true;
    this._mountedEl = null;
  }

  mount(el) {
    this._mountedEl = el;
    this.viewer = OpenSeadragon({
      element: el,
      // use CDN or your local prefix for icons; adjust to your setup
      prefixUrl: '/static/images/osd/',
      showNavigationControl: true,
      gestureSettingsMouse: { clickToZoom: false },
      zoomPerClick: 1.2,
      zoomPerScroll: 1.1,
      visibilityRatio: 1.0,
      minZoomLevel: 0.01,
      maxZoomLevel: 40
    });

    // When a new image opens, (re)anchor SVG overlay
    this.viewer.addHandler('open', () => {
      this.item = this.viewer.world.getItemAt(0);
      this._ensureSvg();
      this._anchorSvgToImage();
      // re-apply visibility in case user toggled before/during open
      this._applyToggleVisibility();
    });

    // Re-anchor overlay on size changes
    this.viewer.addHandler('resize', () => this._anchorSvgToImage());
  }

  setToggles({regions, lines}) {
    if (typeof regions === 'boolean') this.showRegions = regions;
    if (typeof lines   === 'boolean') this.showLines   = lines;
    this._applyToggleVisibility();
  }

  setImage(url, w, h) {
    // Single image (no pyramid). OSD still handles smooth pan/zoom.
    this.viewer.open({ type: 'image', url, buildPyramid: false });
    // Prepare overlay coordinate space now (safe even before 'open' fires)
    this._ensureSvg();
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width',  w);
    this.svg.setAttribute('height', h);
  }

  setOverlays(regions = [], lines = []) {
    this._ensureSvg(true); // true -> clear groups
    // Regions
    if (regions && regions.length) {
      for (const r of regions) {
        if (!r.points || !r.points.length) continue;
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('class', 'region');
        poly.setAttribute('points', r.points.map(([x,y]) => `${x},${y}`).join(' '));
        // ---- force visible fill ----
        poly.setAttribute('fill', '#0080ff');
        poly.setAttribute('fill-opacity', '0.2');      // 80% transparent
        poly.setAttribute('stroke', '#0080ff');
        poly.setAttribute('stroke-opacity', '0.9');
        poly.setAttribute('stroke-width', '1');
        this.gRegions.appendChild(poly);
      }
    }
    // Lines + baselines
    if (lines && lines.length) {
      for (const l of lines) {
        if (l.points && l.points.length) {
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          poly.setAttribute('class', 'line');
          poly.setAttribute('points', l.points.map(([x,y]) => `${x},${y}`).join(' '));
          poly.setAttribute('fill', '#00c800');
          poly.setAttribute('fill-opacity', '0.15');
          poly.setAttribute('stroke', '#00c800');
          poly.setAttribute('stroke-opacity', '0.9');
          poly.setAttribute('stroke-width', '1');
          this.gLines.appendChild(poly);
        }
        if (l.baseline && l.baseline.length) {
          const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            pl.setAttribute('class', 'base');
            pl.setAttribute('points', l.baseline.map(([x,y]) => `${x},${y}`).join(' '));
            pl.setAttribute('fill', 'none');
            pl.setAttribute('stroke', '#ff5050');
            pl.setAttribute('stroke-opacity', '0.9');
            pl.setAttribute('stroke-width', '1.5');
            this.gLines.appendChild(pl);
        }
      }
    }
    // Ensure current toggles are respected immediately
    this._applyToggleVisibility();
  }

  fit() {
    this.viewer.viewport.goHome(true);
  }
  zoomIn()  { this.viewer.viewport.zoomBy(1.2).applyConstraints(); }
  zoomOut() { this.viewer.viewport.zoomBy(1/1.2).applyConstraints(); }

  // -------- internals --------

  _ensureSvg(clearGroups = false) {
    if (!this.svg) {
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.style.position = 'absolute';
      this.svg.style.left = 0;
      this.svg.style.top = 0;
      // Create group containers once
      this.gRegions = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.gRegions.setAttribute('data-layer', 'regions');
      this.gLines = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.gLines.setAttribute('data-layer', 'lines');
      this.svg.appendChild(this.gRegions);
      this.svg.appendChild(this.gLines);
    } else if (clearGroups) {
      // Clear only the groups; keep the container & overlay attached
      while (this.gRegions.firstChild) this.gRegions.removeChild(this.gRegions.firstChild);
      while (this.gLines.firstChild) this.gLines.removeChild(this.gLines.firstChild);
    }
  }

  _anchorSvgToImage() {
    if (!this.viewer || !this.svg) return;
    // Remove previous overlay instance if any
    try { this.viewer.removeOverlay(this.svg); } catch (_) {}
    if (!this.item) this.item = this.viewer.world.getItemAt(0);
    if (!this.item) return;
    const bounds = this.item.getBounds(true);
    this.viewer.addOverlay({
      element: this.svg,
      location: bounds,
      placement: OpenSeadragon.OverlayPlacement.TOP_LEFT
    });
  }

  _applyToggleVisibility() {
    // Show/hide by flipping the group containers; minimal DOM churn.
    if (this.gRegions) this.gRegions.style.display = this.showRegions ? '' : 'none';
    if (this.gLines)   this.gLines.style.display   = this.showLines   ? '' : 'none';
  }
}

// expose globally
window.OSDViewer = OSDViewer;
