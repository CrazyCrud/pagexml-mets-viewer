let WS_ID = null;
let CURRENT_XML = null;
let PAGE_JSON = null;

const el = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  el('btnUpload').addEventListener('click', () => el('fileInput').click());
  el('fileInput').addEventListener('change', onPickFiles);
  el('btnLoadMets').addEventListener('click', onLoadMets);
});

// Upload many files (flat or nested if you build your own paths[])
async function onPickFiles(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;

  setStatus('Uploading…');
  el('btnUpload').disabled = true;

  try {
    const form = new FormData();
    for (const f of files) {
      form.append('files[]', f, f.name);
      // No directory structure here: we just repeat the filename
      form.append('paths[]', f.name);
    }
    const res = await fetch('/api/upload-many', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    WS_ID = data.workspace_id;
    renderWorkspace(data);
    setStatus('Uploaded.');
  } catch (e) {
    console.error(e);
    alert('Upload failed: ' + e.message);
    setStatus('Upload failed.');
  } finally {
    el('btnUpload').disabled = false;
    el('fileInput').value = '';
  }
}

function renderWorkspace(data) {
  // Sidebar
  el('wsInfo').textContent = `Workspace: ${data.workspace_id}`;
  // METS section
  if (data.mets) {
    el('metsPanel').style.display = '';
    el('metsInfo').textContent = data.mets;
  } else {
    el('metsPanel').style.display = 'none';
    el('metsInfo').textContent = '';
  }
  // PAGE list
  const ul = el('pageList');
  ul.innerHTML = '';
  (data.pages || []).forEach((rel) => {
    const li = document.createElement('li');
    li.textContent = rel;
    li.addEventListener('click', () => openPageXml(rel, li));
    ul.appendChild(li);
  });
}

async function openPageXml(relPath, liEl) {
  CURRENT_XML = relPath;

  for (const li of el('pageList').querySelectorAll('li')) li.classList.remove('active');
  if (liEl) liEl.classList.add('active');

  try {
    setStatus('Loading page…');
    const url = new URL('/api/page', window.location.origin);
    url.searchParams.set('workspace_id', WS_ID);
    url.searchParams.set('path', relPath);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    PAGE_JSON = await res.json();

    // Load image
    const imgRel = PAGE_JSON.image?.path;
    if (!imgRel) {
      throw new Error('No image path returned from /api/page');
    }
    const imgUrl = new URL('/api/file', window.location.origin);
    imgUrl.searchParams.set('workspace_id', WS_ID);
    imgUrl.searchParams.set('path', imgRel);

    await loadImageInto(el('pageImg'), imgUrl.toString());
    fitOverlayToImage();
    drawGeometry();
    setStatus('Done.');
  } catch (e) {
    console.error(e);
    alert('Failed to load page: ' + e.message);
    setStatus('Error.');
  }
}

function setStatus(msg) {
  el('status').textContent = msg;
}

function loadImageInto(imgEl, src) {
  return new Promise((resolve, reject) => {
    imgEl.onload = () => resolve();
    imgEl.onerror = () => reject(new Error('Image failed to load'));
    imgEl.src = src + '&_t=' + Date.now(); // cache-bust
  });
}

function fitOverlayToImage() {
  const img = el('pageImg');
  const canvas = el('overlay');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  canvas.style.width = img.clientWidth + 'px';
  canvas.style.height = img.clientHeight + 'px';
}

function drawGeometry() {
  const canvas = el('overlay');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const regions = PAGE_JSON?.regions || [];
  const lines = PAGE_JSON?.lines || [];

  // Regions
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 128, 255, 0.9)';
  regions.forEach(r => drawPolygon(ctx, r.points));

  // Lines
  ctx.strokeStyle = 'rgba(0, 200, 100, 0.9)';
  lines.forEach(l => drawPolygon(ctx, l.points));
  ctx.strokeStyle = 'rgba(220, 50, 50, 0.9)';
  lines.forEach(l => drawPolyline(ctx, l.baseline));

  el('geomInfo').textContent = `${regions.length} regions, ${lines.length} lines`;
}

function drawPolygon(ctx, pts) {
  if (!pts || pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
}

function drawPolyline(ctx, pts) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

// METS viewer
async function onLoadMets() {
  if (!WS_ID) return;
  const metsRel = el('metsInfo').textContent.trim();
  if (!metsRel) return;
  setStatus('Loading METS…');
  try {
    const url = new URL('/api/mets', window.location.origin);
    url.searchParams.set('workspace_id', WS_ID);
    url.searchParams.set('path', metsRel);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Replace PAGE list with METS-defined PAGE-XMLs if present
    const byXml = (data.pages || []).map(p => p.pagexml?.href).filter(Boolean);
    if (byXml.length) {
      renderWorkspace({ workspace_id: WS_ID, pages: byXml, mets: metsRel });
    }
    setStatus('METS loaded.');
  } catch (e) {
    console.error(e);
    alert('Failed to load METS: ' + e.message);
    setStatus('Error.');
  }
}

window.addEventListener('resize', () => {
  const img = el('pageImg');
  if (!img.src) return;
  fitOverlayToImage();
  drawGeometry();
});
