/* global $, window, document */

let WS_ID = null;
let CURRENT_XML = null;
let PAGE_JSON = null;

const $id = (sel) => $(sel);

$(function () {
  $('#btnUpload').on('click', () => $('#fileInput').trigger('click'));
  $('#fileInput').on('change', onPickFiles);
  $('#btnLoadMets').on('click', onLoadMets);
  $(window).on('resize', onResize);
});

function setStatus(msg) {
  $('#status').text(msg);
}

async function onPickFiles(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;

  setStatus('Uploading…');
  $('#btnUpload').prop('disabled', true);

  const form = new FormData();
  for (const f of files) {
    form.append('files[]', f, f.name);
    form.append('paths[]', f.name); // flat structure; adjust if you add subfolders
  }

  $.ajax({
    url: '/api/upload-pages',
    method: 'POST',
    data: form,
    processData: false,
    contentType: false,
  })
  .done((data) => {
    WS_ID = data.workspace_id;
    renderWorkspace(data);
    setStatus('Uploaded.');
  })
  .fail((xhr) => {
    let msg = `HTTP ${xhr.status}`;
    try { msg = (xhr.responseJSON && xhr.responseJSON.error) || msg; } catch(e) {}
    alert('Upload failed: ' + msg);
    setStatus('Upload failed.');
  })
  .always(() => {
    $('#btnUpload').prop('disabled', false);
    $('#fileInput').val('');
  });
}

function renderWorkspace(data) {
  $('#wsInfo').text(`Workspace: ${data.workspace_id}`);

  if (data.mets) {
    $('#metsPanel').show();
    $('#metsInfo').text(data.mets);
  } else {
    $('#metsPanel').hide();
    $('#metsInfo').text('');
  }

  const $ul = $('#pageList').empty();
  (data.pages || []).forEach((rel) => {
    const $li = $('<li/>').text(rel);
    $li.on('click', () => openPageXml(rel, $li));
    $ul.append($li);
  });
}

function openPageXml(relPath, $liEl) {
  CURRENT_XML = relPath;
  $('#pageList li').removeClass('active');
  if ($liEl) $liEl.addClass('active');

  setStatus('Loading page…');

  $.get('/api/page', { workspace_id: WS_ID, path: relPath })
    .done(async (data) => {
      PAGE_JSON = data;

      const imgRel = (PAGE_JSON.image && PAGE_JSON.image.path) || null;
      if (!imgRel) throw new Error('No image path returned from /api/page');

      const imgUrl = '/api/file?' + $.param({ workspace_id: WS_ID, path: imgRel }) + '&_t=' + Date.now();

      await loadImageInto($('#pageImg')[0], imgUrl);
      fitOverlayToImage();
      drawGeometry();
      setStatus('Done.');
    })
    .fail((xhr) => {
      const msg = (xhr.responseJSON && xhr.responseJSON.error) || `HTTP ${xhr.status}`;
      alert('Failed to load page: ' + msg);
      setStatus('Error.');
    });
}

function loadImageInto(imgEl, src) {
  return new Promise((resolve, reject) => {
    $(imgEl)
      .off('load error')
      .on('load', () => resolve())
      .on('error', () => reject(new Error('Image failed to load')))
      .attr('src', src);
  });
}

function fitOverlayToImage() {
  const img = $('#pageImg')[0];
  const $canvas = $('#overlay');

  $canvas.attr('width', img.naturalWidth);
  $canvas.attr('height', img.naturalHeight);

  // CSS scale to match rendered image size
  $canvas.css({
    width: img.clientWidth + 'px',
    height: img.clientHeight + 'px',
  });
}

function drawGeometry() {
  const canvas = $('#overlay')[0];
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const regions = (PAGE_JSON && PAGE_JSON.regions) || [];
  const lines = (PAGE_JSON && PAGE_JSON.lines) || [];

  // Regions
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 128, 255, 0.9)';
  regions.forEach((r) => drawPolygon(ctx, r.points));

  // Lines (polygon + baseline)
  ctx.strokeStyle = 'rgba(0, 200, 100, 0.9)';
  lines.forEach((l) => drawPolygon(ctx, l.points));
  ctx.strokeStyle = 'rgba(220, 50, 50, 0.9)';
  lines.forEach((l) => drawPolyline(ctx, l.baseline));

  $('#geomInfo').text(`${regions.length} regions, ${lines.length} lines`);
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

function onResize() {
  const img = $('#pageImg')[0];
  if (!img || !img.src) return;
  fitOverlayToImage();
  drawGeometry();
}

function onLoadMets() {
  if (!WS_ID) return;
  const metsRel = $('#metsInfo').text().trim();
  if (!metsRel) return;

  setStatus('Loading METS…');

  $.get('/api/mets', { workspace_id: WS_ID, path: metsRel })
    .done((data) => {
      const byXml = (data.pages || [])
        .map((p) => p.pagexml && p.pagexml.href)
        .filter(Boolean);
      if (byXml.length) {
        renderWorkspace({ workspace_id: WS_ID, pages: byXml, mets: metsRel });
      }
      setStatus('METS loaded.');
    })
    .fail((xhr) => {
      const msg = (xhr.responseJSON && xhr.responseJSON.error) || `HTTP ${xhr.status}`;
      alert('Failed to load METS: ' + msg);
      setStatus('Error.');
    });
}
