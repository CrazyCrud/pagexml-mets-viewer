$(function () {
  let workspaceId = null;
  let pages = [];
  let missingImages = [];
  let missingPageXML = [];
  let fileGrps = null;

  const viewer = new OSDViewer();
  viewer.mount(document.getElementById('osd'));

  function setWs(id) {
    workspaceId = id;
    $('#wsIdTag').text(id);
    $('#wsBox').show();
  }

  function renderFileGrps(grps) {
    if (!grps) { $('#fileGrpBox').hide(); return; }
    fileGrps = grps;
    const img = (grps.images || []).map(g => {
      const chosen = grps.chosen && grps.chosen.image === g ? ' <span class="tag is-info is-light">default</span>' : '';
      return `<li>${g}${chosen}</li>`;
    }).join('') || '<li><em>none</em></li>';
    const pag = (grps.pagexml || []).map(g => {
      const chosen = grps.chosen && grps.chosen.pagexml === g ? ' <span class="tag is-info is-light">default</span>' : '';
      return `<li>${g}${chosen}</li>`;
    }).join('') || '<li><em>none</em></li>';
    $('#imgGrpList').html(`<ul>${img}</ul>`);
    $('#pageGrpList').html(`<ul>${pag}</ul>`);
    $('#fileGrpBox').show();
  }

  function renderMissing() {
    // images
    const ul = $('#missingList').empty();
    if (!missingImages.length) ul.append('<li><em>None</em></li>');
    else missingImages.forEach(n => ul.append(`<li>${n}</li>`));
    $('#imagesBox').show();

    // PageXML (from METS)
    const ulp = $('#missingPagesList').empty();
    if (!missingPageXML.length) {
      $('#missingPagesWrap').hide();
    } else {
      missingPageXML.forEach(n => ulp.append(`<li>${n}</li>`));
      $('#missingPagesWrap').show();
    }

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

  function renderStats(stats) {
    const panel = document.getElementById('stats-panel');
    const content = document.getElementById('stats-content');
    if (!stats) { panel.style.display = 'none'; return; }
    const lines = [];
    lines.push(`<div><strong>Total regions:</strong> ${stats.regions_total}</div>`);
    lines.push(`<div><strong>Total text lines:</strong> ${stats.lines_total}</div>`);
    if (stats.regions_by_type) {
      lines.push('<div><strong>Regions by type:</strong></div>');
      lines.push('<ul>' +
        Object.entries(stats.regions_by_type)
          .sort((a,b)=>a[0].localeCompare(b[0]))
          .map(([k,v]) => `<li>${k}: ${v}</li>`).join('') +
        '</ul>');
    }
    content.innerHTML = lines.join('');
    panel.style.display = 'block';
  }

  function canCommit() {
    return workspaceId && pages.length > 0;
  }

  function updateCommitUI(committed=false) {
    $('#btnCommit').prop('disabled', !canCommit());
    $('#commitNotice').toggle(committed);
  }

  function updateFileName(input, target) {
    const files = input.files || [];
    if (!files.length) {
      $(target).text('No file(s) selected');
    } else if (files.length === 1) {
      $(target).text(files[0].name);
    } else {
      $(target).text(`${files.length} files selected`);
    }
  }
  $('#metsInput').on('change', function () { updateFileName(this, '#metsInputName'); });
  $('#pagesInput').on('change', function () { updateFileName(this, '#pagesInputName'); });
  $('#imagesInput').on('change', function () { updateFileName(this, '#imagesInputName'); });

  $('#formMETS').on('submit', function (e) {
    e.preventDefault();
    const f = $('#metsInput')[0].files[0];
    if (!f) {
      $('#metsUploadMsg').text('Please choose a METS file.').addClass('is-danger');
      return;
    }
    const fd = new FormData();
    fd.append('file', f, f.name);

    $.ajax({
      url: '/api/upload-mets',
      type: 'POST',
      data: fd,
      processData: false,
      contentType: false
    }).done(function (resp) {
      setWs(resp.workspace_id);

      pages = resp.pages || []; // required PAGE basenames
      missingImages = resp.missing_images || [];
      missingPageXML = resp.missing_pagexml || [];
      renderFileGrps(resp.file_grps || null);
      $('#metsUploadMsg').text(`METS uploaded. Detected ${pages.length} page(s).`).removeClass('is-danger').addClass('is-success');
      renderPages();
      renderMissing();
    }).fail(function (xhr) {
      $('#metsUploadMsg').text(`METS upload failed: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

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
      url: '/api/upload-pages' + (workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''),
      type: 'POST',
      data: fd,
      processData: false,
      contentType: false
    }).done(function (resp) {
      setWs(resp.workspace_id);
      pages = resp.pages || pages; // keep METS-required list if it’s longer
      missingImages = resp.missing_images || [];
      $('#pagesUploadMsg').text(`Uploaded ${resp.pages.length} PAGE-XML file(s).`).removeClass('is-danger').addClass('is-success');
      renderPages();
      renderMissing();
    }).fail(function (xhr) {
      $('#pagesUploadMsg').text(`Upload failed: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

  $('#formImages').on('submit', function (e) {
    e.preventDefault();
    if (!workspaceId) { $('#imagesUploadMsg').text('Upload PAGE-XML or METS first.').addClass('is-danger'); return; }
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
    missingPageXML = [];
    fileGrps = null;

    $('#wsBox').hide();
    $('#imagesBox').hide();
    $('#pagesBox').hide();
    $('#viewerBox').hide();
    $('#fileGrpBox').hide();
    $('#missingPagesWrap').hide();

    $('#metsInput').val('');   $('#metsInputName').text('No file selected');
    $('#pagesInput').val('');  $('#pagesInputName').text('No files selected');
    $('#imagesInput').val(''); $('#imagesInputName').text('No files selected');

    $('#metsUploadMsg').text(''); $('#pagesUploadMsg').text(''); $('#imagesUploadMsg').text('');
    updateCommitUI(false);
  });

  $(document).on('click', 'a.pageLink', function (e) {
    e.preventDefault();
    if (!workspaceId) return;
    const name = $(this).data('name');
    openPage(workspaceId, name);
  });

  function openPage(wsId, pageName) {
    $('#curPage').text(pageName);
    $('#viewerBox').show();

    $.getJSON('/api/page', { workspace_id: wsId, path: pageName })
      .done(function (data) {

        viewer.setImage(data.image.url, data.image.width, data.image.height);

        viewer.setOverlays(data.regions || [], data.lines || []);

        viewer.setToggles({
          regions: $('#cbRegions').is(':checked'),
          lines:   $('#cbLines').is(':checked')
        });
        // optional stats
        renderStats(data.stats);
      })
      .fail(function (xhr) {
        alert(`Failed to load PAGE: ${xhr.responseText || xhr.status}`);
      });
  }

  // Layer toggles (OSD overlay groups)
  $('#cbRegions, #cbLines').on('change', function () {
    viewer.setToggles({
      regions: $('#cbRegions').is(':checked'),
      lines:   $('#cbLines').is(':checked')
    });
  });

  // OSD toolbar
  $('#btnFit').on('click', () => viewer.fit());
  $('#btnZoomIn').on('click', () => viewer.zoomIn());
  $('#btnZoomOut').on('click', () => viewer.zoomOut());
});
