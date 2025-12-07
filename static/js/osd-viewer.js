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

    this._textRegionColors = new Map();
    this._lineClickHandler = null;
    this._regionClickHandler = null;
    this._canvasClickHandler = null;
    this._canvasClickBound = false;
    this._lines = [];
    this._regions = [];
    this._tempShape = null;
    this.imageDims = { width: null, height: null };
    this._lockPan = false;

    // Point editing
    this._selectedPoint = null; // {type: 'region'|'line', id, pointIndex, isBaseline}
    this._pointDragHandler = null;
    this._isPanning = false;
    this._panStartPos = null;
    this._isDragging = false; // Track if user is dragging a shape/point
  }

  _hueFromId(id) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h % 360;
  }

  _hsl(h, s = 60, l = 50) {
    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  _colorForTextRegion(id) {
    if (!this._textRegionColors.has(id)) {
      const hue = this._hueFromId(id);
      this._textRegionColors.set(id, this._hsl(hue, 62, 48));
    }
    return this._textRegionColors.get(id);
  }

  mount(el) {
    this._mountedEl = el;
    this.viewer = OpenSeadragon({
      element: el,
      // use CDN or your local prefix for icons
      prefixUrl: '/static/images/osd/',
      showNavigationControl: true,
      gestureSettingsMouse: {
        clickToZoom: false,
        scrollToZoom: true,
        pinchToZoom: false
      },
      mouseNavEnabled: false,  // Completely disable default mouse navigation
      zoomPerClick: 1.2,
      zoomPerScroll: 1.1,
      visibilityRatio: 1.0,
      minZoomLevel: 0.01,
      maxZoomLevel: 40
    });

    // When a new image opens, anchor SVG overlay
    this.viewer.addHandler('open', () => {
      this.item = this.viewer.world.getItemAt(0);
      this._ensureSvg();
      this._anchorSvgToImage();
      // r-apply visibility in case user toggled before/during open
      this._applyToggleVisibility();
      console.debug('[OSDViewer] open -> overlay anchored');
    });

    // Reanchor overlay on size changes
    this.viewer.addHandler('resize', () => this._anchorSvgToImage());

    // Re-render point handles on zoom to keep them visible
    this.viewer.addHandler('zoom', () => {
      if (this._selectedPoint) {
        this._renderPointHandles();
      }
    });

    // Bind click detection once after viewer exists
    this._bindCanvasClick();

    // Enable middle-button panning
    this._bindMiddleButtonPan();
  }

    styleForRegion(type, region) {
        const t = (type || '').toLowerCase();

        if (t === 'tableregion') {
          return { fill: 'none', stroke: '#ffa500', fillOpacity: 0, strokeWidth: 2, dash: '4 3' };
        }

        if (t === 'textregion') {
          const col = this._colorForTextRegion(region?.id || '');
          // outline colored
          return { fill: col, stroke: col, fillOpacity: 0.08, strokeWidth: 1.4 };
        }

        // fallback for other region types
        return { fill: '#999', stroke: '#999', fillOpacity: 0.12, strokeWidth: 1 };
  }

  setToggles({regions, lines}) {
    if (typeof regions === 'boolean') this.showRegions = regions;
    if (typeof lines   === 'boolean') this.showLines   = lines;
    this._applyToggleVisibility();
  }

  setImage(url, w, h) {
    // Single image. OSD still handles smooth pan/zoom
    this.viewer.open({ type: 'image', url, buildPyramid: false });
    // Prepare overlay coordinate space now
    this._ensureSvg();
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width',  w);
    this.svg.setAttribute('height', h);
    this.imageDims = { width: w, height: h };
  }

  setOverlays(regions = [], lines = []) {
    this._lines = Array.isArray(lines) ? lines : [];
    this._regions = Array.isArray(regions) ? regions : [];
    this._ensureSvg(true); // true -> clear groups
    console.debug('[OSDViewer] setOverlays', { regions: regions?.length || 0, lines: this._lines.length });
    // Regions
    if (regions && regions.length) {
      for (const r of regions) {
        if (!r.points || !r.points.length) continue;

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('class', 'region');
        poly.setAttribute('points', r.points.map(([x,y]) => `${x},${y}`).join(' '));
        if (r.id) poly.dataset.regionId = r.id;
        poly.style.pointerEvents = 'visiblePainted';
        poly.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this._regionClickHandler) {
            this._regionClickHandler({ region: r, event: ev });
          }
        });

        const sty = this.styleForRegion(r.type, r);
        if (sty.fill === 'none') {
        poly.setAttribute('fill', 'none');
      } else {
        poly.setAttribute('fill', sty.fill);
        poly.setAttribute('fill-opacity', String(sty.fillOpacity ?? 0.1));
      }
        poly.style.setProperty('fill', sty.fill);
        poly.style.setProperty('fill-opacity', String(sty.fillOpacity ?? 0.2));
        poly.style.setProperty('stroke', sty.stroke);
        poly.style.setProperty('stroke-opacity', '0.9');
        poly.style.setProperty('stroke-width', String(sty.strokeWidth ?? 1));
        if (sty.dash) poly.style.setProperty('stroke-dasharray', sty.dash);

        if (r.type) {
          const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          titleEl.textContent = r.type;
          poly.appendChild(titleEl);
        }

        this.gRegions.appendChild(poly);
      }
    }
    // Lines and baselines
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
        if (l.id) poly.dataset.lineId = l.id;
        poly.style.pointerEvents = 'visiblePainted';

          if (l.text && l.text.trim().length > 0) {
              const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
              titleEl.textContent = l.text;
              poly.appendChild(titleEl);
            }

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
          if (l.id) pl.dataset.lineId = l.id;
          pl.style.pointerEvents = 'visiblePainted';

            if (l.text && l.text.trim().length > 0) {
              const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
              titleEl.textContent = l.text;
              pl.appendChild(titleEl);
            }

            this.gLines.appendChild(pl);
        }
      }
    }
    // Ensure current toggles are respected immediately
    this._applyToggleVisibility();
    this._ensureLineDelegation();

    // Re-render point handles if a shape is selected
    if (this._selectedPoint) {
      this._renderPointHandles();
    }
  }

  setSelection({ regionId = null, lineId = null } = {}) {
    if (this.gRegions) {
      this.gRegions.querySelectorAll('.region').forEach((el) => {
        el.classList.toggle('selected', regionId && el.dataset.regionId === regionId);
      });
    }
    if (this.gLines) {
      this.gLines.querySelectorAll('.line').forEach((el) => {
        el.classList.toggle('selected', lineId && el.dataset.lineId === lineId);
      });
    }

    // Update point handles for selected shape
    if (regionId) {
      this._selectedPoint = { type: 'region', id: regionId };
      this._renderPointHandles();
    } else if (lineId) {
      this._selectedPoint = { type: 'line', id: lineId, isBaseline: false };
      this._renderPointHandles();
    } else {
      this._selectedPoint = null;
      this._renderPointHandles();
    }
  }

  setTempShape(points = []) {
    if (!this.gRegions) return;
    if (this._tempShape && this._tempShape.parentNode) {
      this._tempShape.parentNode.removeChild(this._tempShape);
    }
    if (!points.length) {
      this._tempShape = null;
      return;
    }
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('class', 'temp-shape');
    poly.setAttribute('points', points.map(([x, y]) => `${x},${y}`).join(' '));
    this.gRegions.appendChild(poly);
    this._tempShape = poly;
  }

  clearTempShape() {
    this.setTempShape([]);
  }

  fit() {
    this.viewer.viewport.goHome(true);
  }
  zoomIn()  { this.viewer.viewport.zoomBy(1.2).applyConstraints(); }
  zoomOut() { this.viewer.viewport.zoomBy(1/1.2).applyConstraints(); }

  _ensureSvg(clearGroups = false) {
    if (!this.svg) {
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.style.position = 'absolute';
      this.svg.style.left = 0;
      this.svg.style.top = 0;
      this.svg.style.zIndex = '5';
      this.svg.style.pointerEvents = 'auto';
      // Create group containers once
      this.gRegions = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.gRegions.setAttribute('data-layer', 'regions');
      this.gLines = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.gLines.setAttribute('data-layer', 'lines');
      this.svg.appendChild(this.gRegions);
      this.svg.appendChild(this.gLines);
      this._ensureLineDelegation();
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
    console.debug('[OSDViewer] overlay re-anchored', bounds);
  }

  _applyToggleVisibility() {
    // Show/hide by flipping the group containers; minimal DOM churn.
    if (this.gRegions) this.gRegions.style.display = this.showRegions ? '' : 'none';
    if (this.gLines)   this.gLines.style.display   = this.showLines   ? '' : 'none';
  }

  onLineClick(handler) {
    this._lineClickHandler = handler;
    // if a handler is set after overlays already exist, ensure delegation is present
    this._ensureLineDelegation();
  }

  onRegionClick(handler) {
    this._regionClickHandler = handler;
  }

  onCanvasClick(handler) {
    this._canvasClickHandler = handler;
  }

  _ensureLineDelegation() {
    if (!this.gLines) return;
    // remove previous listener by resetting
    this.gLines.onclick = null;
    if (!this._lineClickHandler) return;
    this.gLines.style.pointerEvents = 'auto';
    this.gLines.addEventListener('click', (ev) => {
      // Skip if we were dragging
      if (this._isDragging) {
        console.debug('[OSDViewer] skipping SVG line click - was dragging');
        this._isDragging = false;
        return;
      }
      const target = ev.target;
      if (!target) return;
      const lid = target.dataset ? target.dataset.lineId : null;
      const line = this._lines.find(l => l.id === lid) || (lid ? { id: lid, text: '' } : null);
      if (line) {
        ev.preventDefault();
        ev.stopPropagation();
        const payload = this._buildClickPayload(line, this._webPointFromDomEvent(ev));
        console.debug('[OSDViewer] line click', lid, line);
        this._lineClickHandler(payload);
      } else {
        console.debug('[OSDViewer] click with no matching line id', lid);
      }
    });
    console.debug('[OSDViewer] line click delegation attached');
  }

  _bindCanvasClick() {
    if (!this.viewer || this._canvasClickBound) return;
    this._canvasClickBound = true;

    this.viewer.addHandler('canvas-drag', (ev) => {
      if (this._lockPan) {
        ev.preventDefaultAction = true;
        if (ev.originalEvent) {
          ev.originalEvent.preventDefault();
          ev.originalEvent.stopPropagation();
        }
      }
    });

    // Use direct DOM click handler instead of OpenSeadragon events
    // This is more reliable when mouseNavEnabled is disabled
    this._mountedEl.addEventListener('click', (e) => {
      console.debug('[OSDViewer] DOM click event fired, button:', e.button, '_isDragging:', this._isDragging);

      // Only handle left button clicks
      if (e.button !== 0) return;

      // Skip click handlers if we were dragging
      if (this._isDragging) {
        console.debug('[OSDViewer] skipping click - was dragging');
        this._isDragging = false;
        return;
      }

      // Check if click was on SVG elements (regions/lines) - let their handlers deal with it
      if (e.target.closest('.region') || e.target.closest('.line') || e.target.closest('.base') || e.target.closest('.point-handle')) {
        console.debug('[OSDViewer] click on SVG element, ignoring');
        return;
      }

      const rect = this._mountedEl.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const webPoint = new OpenSeadragon.Point(px, py);
      const viewportPt = this.viewer.viewport.pointFromPixel(webPoint);
      const imgPt = this.viewer.viewport.viewportToImageCoordinates(viewportPt);

      let hitSomething = false;

      // Line hit detection - check lines FIRST (they're on top visually)
      if (this._lineClickHandler && this.showLines) {
        const hit = this._hitTestLine(imgPt);
        if (hit) {
          hitSomething = true;
          const payload = this._buildClickPayload(hit, webPoint);
          console.debug('[OSDViewer] canvas line click', hit.id);
          this._lineClickHandler(payload);
          return;
        }
      }

      // Region hit detection - check regions SECOND (they're underneath)
      if (!hitSomething && this._regionClickHandler && this.showRegions) {
        const hitRegion = this._hitTestRegion(imgPt);
        if (hitRegion) {
          hitSomething = true;
          this._regionClickHandler({ region: hitRegion, click: { image: imgPt, pixel: { x: px, y: py } } });
          return;
        }
      }

      // General canvas click callback (used for drawing and deselection)
      // Only fires if we didn't hit a region or line
      console.debug('[OSDViewer] Calling canvas click handler, hitSomething:', hitSomething);
      if (this._canvasClickHandler) {
        this._canvasClickHandler({
          image: { x: imgPt.x, y: imgPt.y },
          viewport: { x: viewportPt.x, y: viewportPt.y },
          pixel: { x: px, y: py }
        });
      }
    });

    console.debug('[OSDViewer] canvas click handler bound');
  }

  _webPointFromDomEvent(ev) {
    if (!ev || !this.viewer || !this.viewer.container) return null;
    const rect = this.viewer.container.getBoundingClientRect();
    return new OpenSeadragon.Point(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  _buildClickPayload(line, webPoint) {
    if (!webPoint || !this.viewer || !this.viewer.viewport) {
      return { line, click: null };
    }
    const viewportPt = this.viewer.viewport.pointFromPixel(webPoint);
    const imgPt = this.viewer.viewport.viewportToImageCoordinates(viewportPt);
    return {
      line,
      click: {
        pixel: { x: webPoint.x, y: webPoint.y },
        viewport: { x: viewportPt.x, y: viewportPt.y },
        image: { x: imgPt.x, y: imgPt.y }
      }
    };
  }

  _hitTestLine(pt) {
    if (!pt || !this._lines || !this._lines.length) return null;
    // Traverse in reverse so topmost (last drawn) wins
    for (let i = this._lines.length - 1; i >= 0; i--) {
      const line = this._lines[i];
      if (line.points && line.points.length >= 3 && this._pointInPolygon(pt, line.points)) {
        return line;
      }
      // fall back to proximity to polygon edges or baseline
      if (line.points && line.points.length >= 2 && this._nearPolyline(pt, line.points, 5)) {
        return line;
      }
      if (line.baseline && line.baseline.length >= 2 && this._nearPolyline(pt, line.baseline, 5)) {
        return line;
      }
    }
    return null;
  }

  _hitTestRegion(pt) {
    if (!pt || !this._regions || !this._regions.length) return null;
    for (let i = this._regions.length - 1; i >= 0; i--) {
      const r = this._regions[i];
      if (r.points && r.points.length >= 3 && this._pointInPolygon(pt, r.points)) {
        return r;
      }
    }
    return null;
  }

  _pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  _nearPolyline(pt, pts, tol = 5) {
    const t2 = tol * tol;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = { x: pts[i][0], y: pts[i][1] };
      const b = { x: pts[i + 1][0], y: pts[i + 1][1] };
      if (this._distToSegmentSq(pt, a, b) <= t2) return true;
    }
    return false;
  }

  _distToSegmentSq(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) {
      const px = p.x - a.x;
      const py = p.y - a.y;
      return px * px + py * py;
    }
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    const projX = a.x + clamped * dx;
    const projY = a.y + clamped * dy;
    const qx = p.x - projX;
    const qy = p.y - projY;
    return qx * qx + qy * qy;
  }

  setPanLock(flag) {
    this._lockPan = !!flag;
  }

  setDragging(flag) {
    this._isDragging = !!flag;
  }

  _bindMiddleButtonPan() {
    if (!this.viewer || !this._mountedEl) return;

    // Use DOM events for middle-button panning
    this._mountedEl.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // Middle button
        e.preventDefault();
        this._isPanning = true;
        const rect = this._mountedEl.getBoundingClientRect();
        const viewportPoint = this.viewer.viewport.pointFromPixel(
          new OpenSeadragon.Point(e.clientX - rect.left, e.clientY - rect.top)
        );
        this._panStartPos = viewportPoint;
      }
    });

    this._mountedEl.addEventListener('mousemove', (e) => {
      if (this._isPanning) {
        e.preventDefault();
        const rect = this._mountedEl.getBoundingClientRect();
        const currentViewportPoint = this.viewer.viewport.pointFromPixel(
          new OpenSeadragon.Point(e.clientX - rect.left, e.clientY - rect.top)
        );
        const delta = this._panStartPos.minus(currentViewportPoint);
        this.viewer.viewport.panBy(delta);
        this._panStartPos = currentViewportPoint;
      }
    });

    const endPan = (e) => {
      if (e.button === 1 || !e.buttons) {
        this._isPanning = false;
        this._panStartPos = null;
      }
    };

    this._mountedEl.addEventListener('mouseup', endPan);
    this._mountedEl.addEventListener('mouseleave', () => {
      this._isPanning = false;
      this._panStartPos = null;
    });

    // Prevent context menu on middle-click
    this._mountedEl.addEventListener('contextmenu', (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    });

    console.debug('[OSDViewer] middle-button pan enabled');
  }

  onPointDrag(handler) {
    this._pointDragHandler = handler;
  }

  setSelectedPoint(selection) {
    this._selectedPoint = selection; // {type, id, pointIndex, isBaseline}
    this._renderPointHandles();
  }

  _renderPointHandles() {
    // Remove existing handles
    const existing = this.svg.querySelectorAll('.point-handle');
    existing.forEach(el => el.remove());

    if (!this._selectedPoint) return;

    const { type, id, isBaseline } = this._selectedPoint;
    let points = null;

    if (type === 'region') {
      const region = this._regions.find(r => r.id === id);
      if (region && region.points) points = region.points;
    } else if (type === 'line') {
      const line = this._lines.find(l => l.id === id);
      if (line) {
        points = isBaseline ? line.baseline : line.points;
      }
    }

    if (!points || !points.length) return;

    // Get current zoom level to scale handle size
    const zoom = this.viewer && this.viewer.viewport ? this.viewer.viewport.getZoom() : 1;
    const baseRadius = 6;
    const radius = baseRadius / (zoom * 0.5); // Scale inversely with zoom

    // Create draggable circles for each point
    points.forEach(([x, y], idx) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'point-handle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', Math.max(3, radius));
      circle.setAttribute('fill', '#ff5050');
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', Math.max(1, radius * 0.25));
      circle.style.cursor = 'move';
      circle.style.pointerEvents = 'auto';
      circle.dataset.pointIndex = idx;
      circle.dataset.shapeType = type;
      circle.dataset.shapeId = id;
      circle.dataset.isBaseline = isBaseline ? 'true' : 'false';

      this.svg.appendChild(circle);
    });
  }
}

// expose globally
window.OSDViewer = OSDViewer;
