$(function () {
  let workspaceId = null;
  let pages = [];           // uploaded PAGE xml filenames (like OCR-D-SEG_0001.xml)
  let missingImages = [];   // basenames still needed

  function setWs(id) {
    workspaceId = id;
    $('#wsIdTag').text(id);
    $('#wsBox').show();
  }
  function canCommit() {
    return workspaceId && missingImages.length === 0 && pages.length > 0;
  }
  function updateCommitUI(committed=false) {
    $('#btnCommit').prop('disabled', !canCommit());
    $('#commitNotice').toggle(committed);
  }
  function renderMissing() {
    const ul = $('#missingList').empty();
    if (!missingImages.length) {
      ul.append('<li><em>None</em></li>');
    } else {
      missingImages.forEach(n => ul.append(`<li>${n}</li>`));
    }
    $('#imagesBox').show();
    updateCommitUI(false);
  }
  function renderPages() {
    const tb = $('#pagesTableBody').empty();
    if (!pages.length) {
      tb.append('<tr><td><em>No PAGE-XML uploaded yet</em></td></tr>');
    } else {
      pages.forEach(name => {
        const $a = $(`<a href="#" class="pageLink" data-name="${name}">${name}</a>`);
        tb.append($('<tr>').append($('<td>').append($a)));
      });
    }
    $('#pagesBox').show();
  }

  // file input labels
  function updateFileName(input, target) {
    const files = input.files || [];
    if (!files.length) {
      $(target).text('No files selected');
    } else if (files.length === 1) {
      $(target).text(files[0].name);
    } else {
      $(target).text(`${files.length} files selected`);
    }
  }
  $('#pagesInput').on('change', function () { updateFileName(this, '#pagesInputName'); });
  $('#imagesInput').on('change', function () { updateFileName(this, '#imagesInputName'); });

  $('#formPages').on('submit', function (e) {
    e.preventDefault();
    const files = $('#pagesInput')[0].files;
    if (!files.length) {
      $('#pagesUploadMsg').text('Please choose PAGE-XML files first.').addClass('is-danger');
      return;
    }
    const fd = new FormData();
    for (const f of files) fd.append('files[]', f, f.name);

    $.ajax({
      url: '/api/upload-pages',
      type: 'POST',
      data: fd,
      processData: false,
      contentType: false
    }).done(function (resp) {
      // resp: {workspace_id, pages, missing_images}
      setWs(resp.workspace_id);
      pages = resp.pages || [];
      missingImages = resp.missing_images || [];
      $('#pagesUploadMsg').text(`Uploaded ${pages.length} PAGE-XML file(s).`).removeClass('is-danger').addClass('is-success');
      renderPages();
      renderMissing();
    }).fail(function (xhr) {
      $('#pagesUploadMsg').text(`Upload failed: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

  $('#formImages').on('submit', function (e) {
    e.preventDefault();
    if (!workspaceId) { $('#imagesUploadMsg').text('Upload PAGE-XML first.').addClass('is-danger'); return; }
    const files = $('#imagesInput')[0].files;
    if (!files.length) { $('#imagesUploadMsg').text('Choose image files.').addClass('is-danger'); return; }

    const fd = new FormData();
    for (const f of files) fd.append('files[]', f, f.name);

    $.ajax({
      url: `/api/upload-images?workspace_id=${encodeURIComponent(workspaceId)}`,
      type: 'POST',
      data: fd,
      processData: false,
      contentType: false
    }).done(function (resp) {
      // resp: {added, still_missing}
      missingImages = resp.still_missing || [];
      $('#imagesUploadMsg').text(`Added ${resp.added.length} image(s). Still missing: ${missingImages.length}.`).removeClass('is-danger').addClass('is-success');
      renderMissing();
    }).fail(function (xhr) {
      $('#imagesUploadMsg').text(`Upload failed: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

  $('#btnCommit').on('click', function () {
    if (!canCommit()) return;
    $.post(`/api/commit-import?workspace_id=${encodeURIComponent(workspaceId)}`)
      .done(function (resp) {
        updateCommitUI(true);
      })
      .fail(function (xhr) {
        alert(`Commit failed: ${xhr.responseText || xhr.status}`);
      });
  });

  $('#btnReset').on('click', function () {
    workspaceId = null;
    pages = [];
    missingImages = [];
    $('#wsBox').hide();
    $('#imagesBox').hide();
    $('#pagesBox').hide();
    $('#viewerBox').hide();
    $('#pagesInput').val('');
    $('#imagesInput').val('');
    $('#pagesInputName').text('No files selected');
    $('#imagesInputName').text('No files selected');
    $('#pagesUploadMsg').text('');
    $('#imagesUploadMsg').text('');
    updateCommitUI(false);
  });

  $(document).on('click', 'a.pageLink', function (e) {
    e.preventDefault();
    if (!workspaceId) return;
    const name = $(this).data('name');
    openPage(workspaceId, name);
  });

  const $canvas = $('#pageCanvas');
  const ctx = $canvas[0].getContext('2d');

  function openPage(wsId, pageName) {
    $('#curPage').text(pageName);
    $('#viewerBox').show();

    $.getJSON('/api/page', { workspace_id: wsId, path: pageName })
      .done(function (data) {
        // data.image.path is an absolute server path. Convert to /api/file route.
        // e.g. /abs/.../data/workspaces/<wsId>/images/foo.tif  →  path=images/foo.tif
        const abs = data.image && data.image.path ? data.image.path : '';
        const relMatch = abs.match(new RegExp(`/data/workspaces/${escapeRegExp(wsId)}/(.*)$`));
        let relPath = relMatch ? relMatch[1] : null;
        if (!relPath) {
          // fallback: if the PAGE was not committed yet, try to guess
          relPath = `pages/${pageName}`;
        }
        const imgUrl = data?.image?.url || '';
        $('#pageImage').attr('src', imgUrl);

        // Optionally: set width/height if you use them
        if (data?.image?.width && data?.image?.height) {
        $('#pageImage').attr('width', data.image.width);
        $('#pageImage').attr('height', data.image.height);
        }

        loadAndDraw(imgUrl, data);
      })
      .fail(function (xhr) {
        alert(`Failed to load PAGE: ${xhr.responseText || xhr.status}`);
      });
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function loadAndDraw(url, meta) {
    const img = new Image();
    img.onload = function () {
      // Fit canvas to image width (up to container width)
      $canvas.attr('width', img.width);
      $canvas.attr('height', img.height);
      ctx.clearRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);

      drawOverlays(meta);
    };
    img.onerror = function () {
      alert('Could not load image for this PAGE.');
    };
    img.src = url;
  }

  function drawOverlays(meta) {
    const showRegions = $('#cbRegions').is(':checked');
    const showLines = $('#cbLines').is(':checked');

    // Regions
    if (showRegions && meta.regions && meta.regions.length) {
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0, 128, 255, 0.9)';
      meta.regions.forEach(r => drawPoly(r.points));
      ctx.restore();
    }

    // Lines (polygon + baseline)
    if (showLines && meta.lines && meta.lines.length) {
      ctx.save();
      // line polygon
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 200, 0, 0.9)';
      meta.lines.forEach(l => drawPoly(l.points));
      // baseline
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
      meta.lines.forEach(l => drawPolyline(l.baseline));
      ctx.restore();
    }
  }

  function drawPoly(points) {
    if (!points || !points.length) return;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  function drawPolyline(points) {
    if (!points || !points.length) return;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Toggle redraw on checkbox change
  $('#cbRegions, #cbLines').on('change', function () {
    // naive redraw: trigger click on current page row if visible
    const cur = $('#curPage').text();
    if (workspaceId && cur) openPage(workspaceId, cur);
  });
});
