$(function () {
  let workspaceId = null;
  let pages = [];
  let missingImages = [];
  let missingPageXML = [];
  let fileGrps = null;
  let currentPage = null;
  let currentLines = [];
  let currentRegions = [];
  let lineModalState = { lineId: null };
  let hasPendingChanges = false;
  const sectionIds = ['workspace', 'uploads', 'files', 'viewer'];
  let workspaceLabel = null;

  const viewer = new OSDViewer();
  viewer.mount(document.getElementById('osd'));
  console.debug('[main] viewer mounted');

  function setWs(id, label = null) {
    workspaceId = id;
    workspaceLabel = label || `Workspace ${id.slice(0, 8)}`;
    $('#wsIdTag').text(id);
    $('#topWsChip').text(`${workspaceLabel} (${id})`).show();
    $('#wsLabelInput').val(workspaceLabel);
    $('#wsBox').show();
    updateDownloadButton();
    updateTabAvailability();
  }

  function setPendingChanges(flag) {
    hasPendingChanges = !!flag;
    $('#commitBadge').toggle(hasPendingChanges);
  }

  function updateTabAvailability() {
    const enabled = !!workspaceId;
    $('.section-tab').each(function () {
      const target = $(this).data('target');
      const shouldDisable = !enabled && target !== 'workspace';
      $(this).parent().toggleClass('is-disabled', shouldDisable);
      $(this).attr('aria-disabled', shouldDisable ? 'true' : 'false');
      $(this).attr('tabindex', shouldDisable ? '-1' : '0');
    });
  }

  function showSection(id) {
    const $tab = $(`.section-tab[data-target="${id}"]`);
    if ($tab.parent().hasClass('is-disabled')) return;
    sectionIds.forEach(s => {
      const visible = s === id;
      $(`#${s}`)[visible ? 'show' : 'hide']();
    });
    $('.section-tab').parent().removeClass('is-active');
    $(`.section-tab[data-target="${id}"]`).parent().addClass('is-active');
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
    $('#files').show();
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
    $('#commitBadge').toggle(hasPendingChanges);
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
        setWs(resp.workspace_id, resp.label || (resp.state && resp.state.label));
        pages = resp.pages || (resp.state && resp.state.pages) || [];
        missingImages = resp.missing_images || [];
        missingPageXML = resp.missing_pagexml || [];
        renderFileGrps(resp.file_grps || null);
        renderPages();
        renderMissing();
        resetTranscriptionUI();
        $('#viewer').hide();
        updateCommitUI(false);
        setPendingChanges(false);
        $('#wsLabelStatus').text('').removeClass('is-danger is-success');
        $('#wsStatus').text('').removeClass('is-danger is-success');
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
      $('#wsStatus').text('Workspace deleted.').removeClass('is-danger').addClass('is-success');
      fetchWorkspaceList();
    }).fail(function (xhr) {
      const msg = `Failed to delete workspace: ${xhr.responseText || xhr.status}`;
      $('#wsStatus').text(msg).removeClass('is-success').addClass('is-danger');
      alert(msg);
    });
  }

  function renderTranscriptions() {
    // Legacy list is hidden; editing is done via modal.
    $('#transcriptionBox').hide();
    $('#lineEditor').empty();
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
      setWs(resp.workspace_id, resp.label);

      pages = resp.pages || [];
      missingImages = resp.missing_images || [];
      missingPageXML = resp.missing_pagexml || [];
      renderFileGrps(resp.file_grps || null);
      $('#metsUploadMsg').text(`METS uploaded. Detected ${pages.length} page(s).`).removeClass('is-danger').addClass('is-success');
      renderPages();
      renderMissing();
      fetchWorkspaceList();
      setPendingChanges(true);
      showSection('uploads');
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
      setWs(resp.workspace_id, resp.label);
      pages = resp.pages && resp.pages.length ? resp.pages : pages;
      missingImages = resp.missing_images || [];
      $('#pagesUploadMsg').text(`Uploaded ${resp.pages.length} PAGE-XML file(s).`).removeClass('is-danger').addClass('is-success');
      renderPages();
      renderMissing();
      fetchWorkspaceList();
      setPendingChanges(true);
      showSection('files');
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
      setPendingChanges(true);
      showSection('uploads');
    }).fail(function (xhr) {
      $('#imagesUploadMsg').text(`Upload failed: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

  $('#btnCommit').on('click', function () {
    if (!canCommit()) return;
    $.post(`/api/commit-import?workspace_id=${encodeURIComponent(workspaceId)}`)
      .done(function () {
        setPendingChanges(false);
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

  $('#btnRenameWs').on('click', function () {
    if (!workspaceId) return;
    const newLabel = ($('#wsLabelInput').val() || '').trim();
    if (!newLabel) {
      $('#wsLabelStatus').text('Enter a workspace name.').addClass('is-danger');
      return;
    }
    $('#wsLabelStatus').text('').removeClass('is-danger is-success');
    $.ajax({
      url: `/api/workspaces/${encodeURIComponent(workspaceId)}/label`,
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ label: newLabel })
    }).done(function (resp) {
      workspaceLabel = resp.label || newLabel;
      $('#topWsChip').text(`${workspaceLabel} (${workspaceId})`).show();
      $('#wsLabelInput').val(workspaceLabel);
      $('#wsLabelStatus').text('Renamed.').removeClass('is-danger').addClass('is-success');
      fetchWorkspaceList();
    }).fail(function (xhr) {
      $('#wsLabelStatus').text(`Rename failed: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
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
    $('#files').hide();
    $('#viewer').hide();
    $('#fileGrpBox').hide();
    $('#missingPagesWrap').hide();
    $('#topWsChip').hide();
    $('#wsLabelInput').val('');
    $('#wsLabelStatus').text('').removeClass('is-danger is-success');
    $('#wsStatus').text('').removeClass('is-danger is-success');

    $('#metsInput').val(''); $('#metsInputName').text('No file selected');
    $('#pagesInput').val(''); $('#pagesInputName').text('No files selected');
    $('#imagesInput').val(''); $('#imagesInputName').text('No files selected');

    $('#metsUploadMsg').text(''); $('#pagesUploadMsg').text(''); $('#imagesUploadMsg').text('');
    updateCommitUI(false);
    updateDownloadButton();
    setPendingChanges(false);
    showSection('workspace');
    updateTabAvailability();
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
    $('#viewer').show();
    showSection('viewer');
    currentPage = pageName;

    $.getJSON('/api/page', { workspace_id: wsId, path: pageName })
      .done(function (data) {
        currentRegions = data.regions || [];
        currentLines = data.lines || [];
        viewer.setImage(data.image.url, data.image.width, data.image.height);
        viewer.setOverlays(currentRegions, currentLines);
        viewer.setToggles({
          regions: $('#cbRegions').is(':checked'),
          lines: $('#cbLines').is(':checked')
        });
        renderStats(data.stats);
        renderTranscriptions();
        console.debug('[main] page loaded', { page: pageName, lines: currentLines.length, regions: currentRegions.length });
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

  $(document).on('click', '.section-tab', function (e) {
    e.preventDefault();
    if ($(this).parent().hasClass('is-disabled')) return;
    const target = $(this).data('target');
    if (target) {
      showSection(target);
    }
  });

  fetchWorkspaceList();
  showSection('workspace');
  updateTabAvailability();

  // --- Line modal helpers ---
  function placePopover(click) {
    const $pop = $('#linePopover');
    const osdRect = document.getElementById('osd').getBoundingClientRect();
    const width = $pop.outerWidth() || 320;
    const height = $pop.outerHeight() || 180;
    const padding = 12;
    const px = click && click.pixel ? click.pixel.x : osdRect.width / 2;
    const py = click && click.pixel ? click.pixel.y : osdRect.height / 2;
    let left = osdRect.left + px - width / 2;
    let top = osdRect.top + py + 18;
    // clamp inside viewer
    left = Math.min(Math.max(left, osdRect.left + padding), osdRect.right - width - padding);
    if (top + height + padding > osdRect.bottom) {
      top = osdRect.bottom - height - padding;
    }
    $pop.css({ left: `${left}px`, top: `${top}px` });
  }

  function showLineModal(line, click) {
    lineModalState = { lineId: line.id };
    $('#linePopoverTitle').text(`TextLine ${line.id || ''}`.trim());
    $('#linePopoverLabel').text(line.region_id ? `Region: ${line.region_id}` : 'TextLine');
    $('#linePopoverInput').val(line.text || '');
    $('#linePopoverStatus').text('').removeClass('is-danger is-success');
    $('#linePopover').show();
    placePopover(click);
    console.debug('[main] showLinePopover', line, click);
    setTimeout(() => $('#linePopoverInput').trigger('focus'), 30);
  }

  function hideLineModal() {
    $('#linePopover').hide();
    lineModalState = { lineId: null };
  }

  $('#linePopoverClose, #linePopoverCancel').on('click', hideLineModal);

  $('#linePopoverSave').on('click', function () {
    if (!workspaceId || !currentPage || !lineModalState.lineId) {
      $('#linePopoverStatus').text('Open a PAGE and select a line first.').addClass('is-danger');
      return;
    }
    const newText = $('#linePopoverInput').val();
    const payload = {
      workspace_id: workspaceId,
      path: currentPage,
      lines: [{ id: lineModalState.lineId, text: newText }]
    };
    $.ajax({
      url: '/api/page/transcription',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    }).done(function (resp) {
      $('#linePopoverStatus').text(`Saved line ${lineModalState.lineId}.`).removeClass('is-danger').addClass('is-success');
      // Update local cache
      currentLines = currentLines.map(l => l.id === lineModalState.lineId ? { ...l, text: newText } : l);
      renderTranscriptions();
      viewer.setOverlays(currentRegions, currentLines);
      fetchWorkspaceList();
      setPendingChanges(true);
      setTimeout(hideLineModal, 400);
    }).fail(function (xhr) {
      $('#linePopoverStatus').text(`Failed to save: ${xhr.responseText || xhr.status}`).removeClass('is-success').addClass('is-danger');
    });
  });

  // Bridge line clicks from OSD overlays to modal
  viewer.onLineClick((payload) => {
    if (!payload) return;
    const line = payload.line || payload;
    console.debug('[main] viewer.onLineClick', line);
    showLineModal(line, payload.click || null);
  });
});
