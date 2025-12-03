$(function () {
  let workspaceId = null;
  let pages = [];
  let missingImages = [];
  let missingPageXML = [];
  let fileGrps = null;
  let currentPage = null;
  let currentLines = [];

  const viewer = new OSDViewer();
  viewer.mount(document.getElementById('osd'));

  function setWs(id) {
    workspaceId = id;
    $('#wsIdTag').text(id);
    $('#wsBox').show();
    updateDownloadButton();
  }

  function updateDownloadButton() {
    $('#btnDownloadWorkspace').prop('disabled', !workspaceId);
  }

  function resetTranscriptionUI() {
    currentPage = null;
    currentLines = [];
    $('#lineEditor').empty();
    $('#transcriptionStatus').text('').removeClass('is-danger is-success');
    $('#transcriptionBox').hide();
  }

  function populateGrpSelects(grps) {
    const $selImg = $('#selImgGrp');
    const $selPage = $('#selPageGrp');
    $selImg.empty();
    $selPage.empty();

    (grps.images || []).forEach(g => {
      $selImg.append(new Option(g, g, false, grps.chosen && grps.chosen.image === g));
    });
    (grps.pagexml || []).forEach(g => {
      $selPage.append(new Option(g, g, false, grps.chosen && grps.chosen.pagexml === g));
    });

    $('#fileGrpBox').show();
  }

  function renderFileGrps(grps) {
    if (!grps) {
      $('#fileGrpBox').hide();
      return;
    }
    populateGrpSelects(grps);
  }

  function refreshForSelection() {
    if (!workspaceId) return;
    const imgGrp = $('#selImgGrp').val() || '';
    const pageGrp = $('#selPageGrp').val() || '';
    $.getJSON('/api/mets/select', {
      workspace_id: workspaceId,
      image_grp: imgGrp,
      pagexml_grp: pageGrp
    }).done(function (resp) {
      pages = resp.pages || [];
      missingImages = resp.missing_images || [];
      missingPageXML = resp.missing_pagexml || [];
      populateGrpSelects(resp.file_grps || null);
      renderPages();
      renderMissing();
      fetchWorkspaceList();
    }).fail(function (xhr) {
      alert(`Failed to apply selection: ${xhr.responseText || xhr.status}`);
    });
  }

  function renderMissing() {
    const ul = $('#missingList').empty();
    if (!missingImages.length) ul.append('<li><em>None</em></li>');
    else missingImages.forEach(n => ul.append(`<li>${n}</li>`));
    $('#imagesBox').show();

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
    if (!stats) {
      panel.style.display = 'none';
      return;
    }
    const lines = [];
    lines.push(`<div><strong>Total regions:</strong> ${stats.regions_total}</div>`);
    lines.push(`<div><strong>Total text lines:</strong> ${stats.lines_total}</div>`);
    if (stats.regions_by_type) {
      lines.push('<div><strong>Regions by type:</strong></div>');
      lines.push('<ul>' +
        Object.entries(stats.regions_by_type)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, v]) => `<li>${k}: ${v}</li>`).join('') +
        '</ul>');
    }
    content.innerHTML = lines.join('');
    panel.style.display = 'block';
  }

  function canCommit() {
    return workspaceId && pages.length > 0;
  }

  function updateCommitUI(committed = false) {
    $('#btnCommit').prop('disabled', !canCommit());
    $('#commitNotice').toggle(committed);
    updateDownloadButton();
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

  function fetchWorkspaceList() {
    $('#workspaceTableBody').html('<tr><td colspan="4"><em>Loading...</em></td></tr>');
    $.getJSON('/api/workspaces')
      .done(function (resp) {
        renderWorkspaceList(resp.workspaces || []);
      })
      .fail(function () {
        $('#workspaceTableBody').html('<tr><td colspan="4"><em>Failed to load workspaces</em></td></tr>');
      });
  }

  function renderWorkspaceList(list) {
    const tb = $('#workspaceTableBody').empty();
    if (!list.length) {
      tb.append('<tr><td colspan="4"><em>No workspaces yet</em></td></tr>');
      return;
    }
    list.forEach(ws => {
      const updated = ws.updated_at ? new Date(ws.updated_at).toLocaleString() : '-';
      const label = ws.label || ws.id;
      const row = $('<tr>');
      row.append(`<td><strong>${label}</strong><br><span class="is-size-7 has-text-grey">${ws.id}</span></td>`);
      row.append(`<td>${(ws.page_count != null ? ws.page_count : 0)}</td>`);
      row.append(`<td>${updated}</td>`);
      const actions = $('<div class="buttons are-small"></div>');
      actions.append(`<button class="button is-link is-light btn-load-ws" data-id="${ws.id}">Load</button>`);
      actions.append(`<button class="button is-info is-light btn-download-ws" data-id="${ws.id}">Download</button>`);
      actions.append(`<button class="button is-danger is-light btn-delete-ws" data-id="${ws.id}">Delete</button>`);
      row.append($('<td>').append(actions));
      tb.append(row);
    });
  }

  function loadWorkspace(id) {
    $.getJSON(`/api/workspaces/${encodeURIComponent(id)}`)
      .done(function (resp) {
        setWs(resp.workspace_id);
        pages = resp.pages || (resp.state && resp.state.pages) || [];
        missingImages = resp.missing_images || [];
        missingPageXML = resp.missing_pagexml || [];
        renderFileGrps(resp.file_grps || null);
        renderPages();
        renderMissing();
        resetTranscriptionUI();
        $('#viewerBox').hide();
        updateCommitUI(false);
      })
      .fail(function (xhr) {
        alert(`Failed to load workspace: ${xhr.responseText || xhr.status}`);
      });
  }

  function deleteWorkspace(id) {
    if (!confirm('Delete this workspace from disk?')) return;
    $.ajax({
      url: `/api/workspaces/${encodeURIComponent(id)}`,
      type: 'DELETE'
    }).done(function () {
      if (workspaceId === id) {
        $('#btnReset').click();
      }
      fetchWorkspaceList();
    }).fail(function (xhr) {
      alert(`Failed to delete workspace: ${xhr.responseText || xhr.status}`);
    });
  }

  function renderTranscriptions(lines) {
    currentLines = lines || [];
    const body = $('#lineEditor').empty();
    if (!currentLines.length) {
      body.append('<p><em>No TextLine elements found in this PAGE.</em></p>');
      $('#transcriptionBox').show();
      return;
    }
    currentLines.forEach((ln, idx) => {
      const row = $('<div class="line-row"></div>');
      const label = ln.id ? `${ln.id}` : `Line ${idx + 1}`;
      row.append(`<label class="label is-small">TextLine ${label}</label>`);
      row.append(`<textarea class="textarea line-input" rows="2" data-line-id="${ln.id || ''}">${ln.text || ''}</textarea>`);
      body.append(row);
    });
    $('#transcriptionStatus').text('').removeClass('is-success is-danger');
    $('#transcriptionBox').show();
  }

  function collectTranscriptions() {
    const out = [];
    $('#lineEditor').find('textarea.line-input').each(function () {
      out.push({
        id: $(this).data('line-id'),
        text: $(this).val()
      });
    });
    return out;
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

      pages = resp.pages || [];
      missingImages = resp.missing_images || [];
      missingPageXML = resp.missing_pagexml || [];
      renderFileGrps(resp.file_grps || null);
      $('#metsUploadMsg').text(`METS uploaded. Detected ${pages.length} page(s).`).removeClass('is-danger').addClass('is-success');
      renderPages();
      renderMissing();
      fetchWorkspaceList();
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
      pages = resp.pages && resp.pages.length ? resp.pages : pages;
      missingImages = resp.missing_images || [];
      $('#pagesUploadMsg').text(`Uploaded ${resp.pages.length} PAGE-XML file(s).`).removeClass('is-danger').addClass('is-success');
      renderPages();
      renderMissing();
      fetchWorkspaceList();
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
      fetchWorkspaceList();
    }).fail(function (xhr) {
      $('#imagesUploadMsg').text(`Upload failed: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

  $('#btnCommit').on('click', function () {
    if (!canCommit()) return;
    $.post(`/api/commit-import?workspace_id=${encodeURIComponent(workspaceId)}`)
      .done(function () {
        updateCommitUI(true);
        fetchWorkspaceList();
      })
      .fail(function (xhr) {
        alert(`Commit failed: ${xhr.responseText || xhr.status}`);
      });
  });

  $('#btnDownloadWorkspace').on('click', function () {
    if (!workspaceId) return;
    window.location = `/api/workspaces/${encodeURIComponent(workspaceId)}/download`;
  });

  $('#btnSaveTranscription').on('click', function () {
    if (!workspaceId || !currentPage) {
      $('#transcriptionStatus').text('Open a PAGE first.').removeClass('is-success').addClass('is-danger');
      return;
    }
    const payload = {
      workspace_id: workspaceId,
      path: currentPage,
      lines: collectTranscriptions()
    };
    $.ajax({
      url: '/api/page/transcription',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    }).done(function (resp) {
      $('#transcriptionStatus').text(`Saved ${resp.updated || payload.lines.length} line(s).`).removeClass('is-danger').addClass('is-success');
      fetchWorkspaceList();
    }).fail(function (xhr) {
      $('#transcriptionStatus').text(`Failed to save: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

  $('#btnReset').on('click', function () {
    workspaceId = null;
    pages = [];
    missingImages = [];
    missingPageXML = [];
    fileGrps = null;
    resetTranscriptionUI();

    $('#wsBox').hide();
    $('#imagesBox').hide();
    $('#pagesBox').hide();
    $('#viewerBox').hide();
    $('#fileGrpBox').hide();
    $('#missingPagesWrap').hide();

    $('#metsInput').val(''); $('#metsInputName').text('No file selected');
    $('#pagesInput').val(''); $('#pagesInputName').text('No files selected');
    $('#imagesInput').val(''); $('#imagesInputName').text('No files selected');

    $('#metsUploadMsg').text(''); $('#pagesUploadMsg').text(''); $('#imagesUploadMsg').text('');
    updateCommitUI(false);
    updateDownloadButton();
  });

  $(document).on('change', '#selImgGrp, #selPageGrp', refreshForSelection);

  $(document).on('click', 'a.pageLink', function (e) {
    e.preventDefault();
    if (!workspaceId) return;
    const name = $(this).data('name');
    openPage(workspaceId, name);
  });

  $(document).on('click', '.btn-load-ws', function () {
    const id = $(this).data('id');
    loadWorkspace(id);
  });

  $(document).on('click', '.btn-delete-ws', function () {
    const id = $(this).data('id');
    deleteWorkspace(id);
  });

  $(document).on('click', '.btn-download-ws', function () {
    const id = $(this).data('id');
    window.location = `/api/workspaces/${encodeURIComponent(id)}/download`;
  });

  function openPage(wsId, pageName) {
    $('#curPage').text(pageName);
    $('#viewerBox').show();
    currentPage = pageName;

    $.getJSON('/api/page', { workspace_id: wsId, path: pageName })
      .done(function (data) {
        viewer.setImage(data.image.url, data.image.width, data.image.height);
        viewer.setOverlays(data.regions || [], data.lines || []);
        viewer.setToggles({
          regions: $('#cbRegions').is(':checked'),
          lines: $('#cbLines').is(':checked')
        });
        renderStats(data.stats);
        renderTranscriptions(data.lines || []);
      })
      .fail(function (xhr) {
        alert(`Failed to load PAGE: ${xhr.responseText || xhr.status}`);
      });
  }

  $('#cbRegions, #cbLines').on('change', function () {
    viewer.setToggles({
      regions: $('#cbRegions').is(':checked'),
      lines: $('#cbLines').is(':checked')
    });
  });

  $('#btnFit').on('click', () => viewer.fit());
  $('#btnZoomIn').on('click', () => viewer.zoomIn());
  $('#btnZoomOut').on('click', () => viewer.zoomOut());

  $('#btnRefreshWs').on('click', fetchWorkspaceList);

  fetchWorkspaceList();
});
