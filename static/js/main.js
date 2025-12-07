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
  let drawMode = 'select'; // select | addRegion | addLine
  let drawPoints = [];
  let selectedRegionId = null;
  let selectedLineId = null;
  let dragState = null; // {type, id, lastImg} or {type: 'point', shapeType, shapeId, pointIndex, isBaseline, lastImg}
  let dragMoved = false;
  let navBackup = null;

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

  function getRegionById(rid) {
    return currentRegions.find(r => r.id === rid);
  }

  function getLineById(lid) {
    return currentLines.find(l => l.id === lid);
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

  function setMode(mode) {
    drawMode = mode;
    drawPoints = [];
    if (viewer.clearTempShape) viewer.clearTempShape();
    $('#modeStatus').text(`Mode: ${mode === 'addRegion' ? 'Add Region' : mode === 'addLine' ? 'Add Line' : 'Select'}`);
    $('#modeSelect').toggleClass('is-link', mode === 'select').toggleClass('is-light', mode !== 'select');
    $('#modeAddRegion').toggleClass('is-link', mode === 'addRegion').toggleClass('is-light', mode !== 'addRegion');
    $('#modeAddLine').toggleClass('is-link', mode === 'addLine').toggleClass('is-light', mode !== 'addLine');

    // Disable pointer events on shapes when in drawing mode so clicks pass through to canvas
    if (viewer.setShapesInteractive) {
      viewer.setShapesInteractive(mode === 'select');
    }
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
    drawPoints = [];
    if (viewer.clearTempShape) viewer.clearTempShape();
    setMode('select');

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
    drawPoints = [];
    if (viewer.clearTempShape) viewer.clearTempShape();
    setMode('select');

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
        if (viewer.setSelection) viewer.setSelection({});
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
  setMode('select');

  // Mode buttons
  $('#modeSelect').on('click', () => setMode('select'));
  $('#modeAddRegion').on('click', () => setMode('addRegion'));
  $('#modeAddLine').on('click', () => setMode('addLine'));

  // Canvas clicks for drawing and deselection
  if (viewer.onCanvasClick) {
    viewer.onCanvasClick((pt) => {
      console.debug('[main] canvas click callback fired, drawMode:', drawMode);
      if (!workspaceId || !currentPage) return;

      // In select mode, clicking empty canvas deselects
      if (drawMode === 'select') {
        console.debug('[main] deselecting shapes');
        selectedRegionId = null;
        selectedLineId = null;
        if (viewer.setSelection) viewer.setSelection({});
        return;
      }

      // In drawing modes, add points
      drawPoints.push([pt.image.x, pt.image.y]);
      if (viewer.setTempShape) viewer.setTempShape(drawPoints);
    });
  }

  // Region selection
  if (viewer.onRegionClick) {
    viewer.onRegionClick(({ region }) => {
      if (!region) return;
      // Don't select regions when in drawing mode
      if (drawMode !== 'select') return;
      selectedRegionId = region.id || null;
      selectedLineId = null;
      if (viewer.setSelection) viewer.setSelection({ regionId: selectedRegionId });
    });
  }

  // Enhance line click to set selection
  viewer.onLineClick((payload) => {
    if (!payload) return;
    if (dragState) return;
    // Don't select lines when in drawing mode
    if (drawMode !== 'select') return;
    const line = payload.line || payload;
    selectedLineId = line.id || null;
    selectedRegionId = line.region_id || null;
    if (viewer.setSelection) viewer.setSelection({ lineId: selectedLineId });
    // existing modal behavior
    showLineModal(line, payload.click || null);
  });

  // Double-click or Enter to finish shape
  $('#osd').on('dblclick', function (e) {
    e.preventDefault();
    finishDrawing();
  });
  $(document).on('keydown', function (e) {
    // Delete selected shape
    if (e.key === 'Delete' && drawMode === 'select') {
      if (selectedLineId) {
        deleteLine(selectedLineId);
      } else if (selectedRegionId) {
        deleteRegion(selectedRegionId);
      }
      return;
    }
    if (drawMode === 'select') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finishDrawing();
    }
    if (e.key === 'Escape') {
      drawPoints = [];
      if (viewer.clearTempShape) viewer.clearTempShape();
    }
  });

  // Point handle dragging (individual point editing)
  $(document).on('mousedown', '#osd svg .point-handle', function (e) {
    console.debug('[main] point-handle mousedown', e.button);
    if (drawMode !== 'select') return;
    if (!workspaceId || !currentPage) return;
    const pointIndex = parseInt($(this).data('pointIndex'), 10);
    const shapeType = $(this).data('shapeType');
    const shapeId = $(this).data('shapeId');
    const isBaseline = $(this).data('isBaseline') === 'true';
    const pt = eventToImage(e);
    if (!pt) return;
    dragState = {
      type: 'point',
      shapeType,
      shapeId,
      pointIndex,
      isBaseline,
      lastImg: pt.img
    };
    dragMoved = false;
    console.debug('[main] point drag started', dragState);
    if (viewer.setPanLock) viewer.setPanLock(true);
    e.preventDefault();
    e.stopPropagation();
  });

  // Drag selection (move whole shape)
  $(document).on('mousedown', '#osd svg .region, #osd svg .line', function (e) {
    console.debug('[main] shape mousedown', e.button, $(this).attr('class'), 'drawMode:', drawMode);
    if (drawMode !== 'select') {
      console.debug('[main] ignoring shape mousedown - not in select mode, allowing event to propagate');
      // Don't preventDefault/stopPropagation so the click can reach the canvas handler for drawing
      return;
    }
    if (!workspaceId || !currentPage) return;
    const isRegion = $(this).hasClass('region');
    const id = isRegion ? $(this).data('regionId') : $(this).data('lineId');
    if (!id) return;
    const pt = eventToImage(e);
    if (!pt) return;
    dragState = { type: isRegion ? 'region' : 'line', id, lastImg: pt.img };
    dragMoved = false;
    selectedRegionId = isRegion ? id : null;
    selectedLineId = isRegion ? null : id;
    console.debug('[main] shape drag started', dragState);
    if (viewer.setSelection) viewer.setSelection({ regionId: selectedRegionId, lineId: selectedLineId });
    if (viewer.setPanLock) viewer.setPanLock(true);
    e.preventDefault();
    e.stopPropagation();
  });

  // Use native DOM events on OSD container instead of document to avoid OpenSeadragon event blocking
  document.getElementById('osd').addEventListener('mousemove', function (e) {
    if (!dragState) return;
    console.debug('[main] mousemove firing', dragState.type);
    const delta = imgDeltaFromScreen(e, dragState.lastImg);
    if (!delta) return;
    const dx = delta.dx;
    const dy = delta.dy;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
    dragMoved = true;
    dragState.lastImg = delta.img;

    // Signal to viewer that we're dragging
    if (viewer.setDragging) viewer.setDragging(true);

    if (dragState.type === 'point') {
      // Individual point dragging
      const { shapeType, shapeId, pointIndex, isBaseline } = dragState;
      if (shapeType === 'region') {
        const reg = getRegionById(shapeId);
        if (!reg || !reg.points || !reg.points[pointIndex]) return;
        reg.points[pointIndex] = [reg.points[pointIndex][0] + dx, reg.points[pointIndex][1] + dy];
        viewer.setOverlays(currentRegions, currentLines);
      } else if (shapeType === 'line') {
        const ln = getLineById(shapeId);
        if (!ln) return;
        const points = isBaseline ? ln.baseline : ln.points;
        if (!points || !points[pointIndex]) return;
        points[pointIndex] = [points[pointIndex][0] + dx, points[pointIndex][1] + dy];
        viewer.setOverlays(currentRegions, currentLines);
        viewer.setSelection({ lineId: ln.id });
      }
    } else if (dragState.type === 'region') {
      const reg = getRegionById(dragState.id);
      if (!reg || !reg.points) return;
      reg.points = reg.points.map(([x, y]) => [x + dx, y + dy]);
      viewer.setOverlays(currentRegions, currentLines);
    } else if (dragState.type === 'line') {
      const ln = getLineById(dragState.id);
      if (!ln) return;
      if (ln.points) ln.points = ln.points.map(([x, y]) => [x + dx, y + dy]);
      if (ln.baseline) ln.baseline = ln.baseline.map(([x, y]) => [x + dx, y + dy]);
      viewer.setOverlays(currentRegions, currentLines);
      viewer.setSelection({ lineId: ln.id });
    }
  });

  // Use native DOM events on OSD container for mouseup too
  document.getElementById('osd').addEventListener('mouseup', function () {
    if (!dragState) return;

    console.debug('[main] mouseup, dragMoved:', dragMoved);

    // Keep dragging flag set until after click events fire
    const wasDragging = dragMoved;

    if (dragMoved) {
      if (dragState.type === 'point') {
        // Save the shape that contains the modified point
        const { shapeType, shapeId } = dragState;
        if (shapeType === 'region') {
          const reg = getRegionById(shapeId);
          if (reg) saveRegionUpdate(reg);
        } else if (shapeType === 'line') {
          const ln = getLineById(shapeId);
          if (ln) saveLineUpdate(ln);
        }
      } else if (dragState.type === 'region') {
        const reg = getRegionById(dragState.id);
        if (reg) {
          saveRegionUpdate(reg);
        }
      } else if (dragState.type === 'line') {
        const ln = getLineById(dragState.id);
        if (ln) {
          saveLineUpdate(ln);
        }
      }
    }

    dragState = null;
    dragMoved = false;
    if (viewer.setPanLock) viewer.setPanLock(false);

    // Let the dragging flag persist briefly so click handlers can see it
    if (wasDragging && viewer.setDragging) {
      // Don't clear it immediately - let the click handler check it first
      setTimeout(() => {
        if (viewer.setDragging) viewer.setDragging(false);
      }, 50);
    }
  });

  function finishDrawing() {
    if (!workspaceId || !currentPage) return;
    if (!drawPoints.length) return;
    if (drawMode === 'addRegion') {
      saveNewRegion(drawPoints.slice());
    } else if (drawMode === 'addLine') {
      saveNewLine(drawPoints.slice());
    }
    drawPoints = [];
    if (viewer.clearTempShape) viewer.clearTempShape();
  }

  function eventToImage(ev) {
    if (!viewer || !viewer.viewer) return null;
    const rect = document.getElementById('osd').getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const vp = viewer.viewer.viewport.pointFromPixel(new OpenSeadragon.Point(px, py));
    const img = viewer.viewer.viewport.viewportToImageCoordinates(vp);
    return { img, pixel: { x: px, y: py } };
  }

  function saveNewRegion(points) {
    if (!points || points.length < 3) {
      alert('Add at least 3 points for a region.');
      return;
    }
    const payload = {
      workspace_id: workspaceId,
      path: currentPage,
      region: { type: 'TextRegion', points }
    };
    $.ajax({
      url: '/api/page/region',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    }).done(function (resp) {
      currentRegions.push(resp.region);
      viewer.setOverlays(currentRegions, currentLines);
      setPendingChanges(true);
    }).fail(function (xhr) {
      alert(`Failed to add region: ${xhr.responseText || xhr.status}`);
    });
  }

  function saveRegionUpdate(reg) {
    const payload = {
      workspace_id: workspaceId,
      path: currentPage,
      region: { id: reg.id, type: reg.type || 'TextRegion', points: reg.points || [] }
    };
    $.ajax({
      url: '/api/page/region',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    }).done(function (resp) {
      const idx = currentRegions.findIndex(r => r.id === reg.id);
      if (idx >= 0) currentRegions[idx] = { ...currentRegions[idx], ...resp.region };
      viewer.setOverlays(currentRegions, currentLines);
      setPendingChanges(true);
    }).fail(function (xhr) {
      alert(`Failed to update region: ${xhr.responseText || xhr.status}`);
    });
  }

  function saveNewLine(points) {
    if (!points || points.length < 2) {
      alert('Add at least 2 points for a line.');
      return;
    }

    // Find which region should contain this line
    let targetRegion = null;

    // Option 1: User has a region selected
    if (selectedRegionId) {
      targetRegion = getRegionById(selectedRegionId);
    }

    // Option 2: Find region that contains the line geometrically
    if (!targetRegion) {
      targetRegion = findContainingRegion(points);
    }

    // Option 3: No region contains it - create one automatically
    if (!targetRegion) {
      console.debug('[main] No region contains line, creating new region automatically');
      createRegionForLine(points, (newRegion) => {
        saveLineWithRegion(points, newRegion.id);
      });
      return;
    }

    console.debug('[main] Using region', targetRegion.id, 'for new line');
    saveLineWithRegion(points, targetRegion.id);
  }

  function saveLineWithRegion(points, regionId) {
    const payload = {
      workspace_id: workspaceId,
      path: currentPage,
      line: {
        region_id: regionId,
        points: points,
        baseline: [],
        text: ''
      }
    };
    $.ajax({
      url: '/api/page/line',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    }).done(function (resp) {
      currentLines.push(resp.line);
      viewer.setOverlays(currentRegions, currentLines);
      setPendingChanges(true);
    }).fail(function (xhr) {
      alert(`Failed to add line: ${xhr.responseText || xhr.status}`);
    });
  }

  function findContainingRegion(linePoints) {
    if (!currentRegions || !currentRegions.length) return null;

    // Check each region to see if it contains the line
    const candidates = currentRegions.filter(region => {
      if (!region.points || region.points.length < 3) return false;
      return isLineInsideRegion(linePoints, region.points);
    });

    if (candidates.length === 0) return null;

    // If multiple regions contain it, pick the smallest one (most specific)
    if (candidates.length > 1) {
      return candidates.reduce((smallest, current) => {
        return getPolygonArea(current.points) < getPolygonArea(smallest.points) ? current : smallest;
      });
    }

    return candidates[0];
  }

  function isLineInsideRegion(linePoints, regionPoints) {
    // Check if all line points are inside the region polygon
    return linePoints.every(pt => pointInPolygon(pt, regionPoints));
  }

  function pointInPolygon(point, polygon) {
    const x = point[0];
    const y = point[1];
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];

      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }

    return inside;
  }

  function getPolygonArea(points) {
    if (!points || points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i][0] * points[j][1];
      area -= points[j][0] * points[i][1];
    }
    return Math.abs(area / 2);
  }

  function createRegionForLine(linePoints, callback) {
    // Create a bounding box around the line with some padding
    const padding = 50; // pixels - generous padding for text region
    const xs = linePoints.map(p => p[0]);
    const ys = linePoints.map(p => p[1]);
    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;

    const regionPoints = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY]
    ];

    const payload = {
      workspace_id: workspaceId,
      path: currentPage,
      region: { type: 'TextRegion', points: regionPoints }
    };

    $.ajax({
      url: '/api/page/region',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    }).done(function (resp) {
      currentRegions.push(resp.region);
      viewer.setOverlays(currentRegions, currentLines);
      setPendingChanges(true);
      console.log('[main] Auto-created TextRegion', resp.region.id, 'for new TextLine');
      callback(resp.region);
    }).fail(function (xhr) {
      alert(`Failed to create region: ${xhr.responseText || xhr.status}`);
    });
  }

  function saveLineUpdate(ln) {
    const payload = {
      workspace_id: workspaceId,
      path: currentPage,
      line: {
        id: ln.id,
        region_id: ln.region_id,
        points: ln.points || [],
        baseline: ln.baseline || [],
        text: ln.text || ''
      }
    };
    $.ajax({
      url: '/api/page/line',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    }).done(function (resp) {
      const idx = currentLines.findIndex(l => l.id === ln.id);
      if (idx >= 0) currentLines[idx] = { ...currentLines[idx], ...resp.line };
      viewer.setOverlays(currentRegions, currentLines);
      setPendingChanges(true);
    }).fail(function (xhr) {
      alert(`Failed to update line: ${xhr.responseText || xhr.status}`);
    });
  }

  function deleteRegion(id) {
    if (!id || !workspaceId || !currentPage) return;
    $.ajax({
      url: '/api/page/region/delete',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ workspace_id: workspaceId, path: currentPage, region_id: id })
    }).done(function () {
      currentRegions = currentRegions.filter(r => r.id !== id);
      currentLines = currentLines.filter(l => l.region_id !== id);
      viewer.setOverlays(currentRegions, currentLines);
      selectedRegionId = null;
      setPendingChanges(true);
    }).fail(function (xhr) {
      alert(`Failed to delete region: ${xhr.responseText || xhr.status}`);
    });
  }

  function deleteLine(id) {
    if (!id || !workspaceId || !currentPage) return;
    $.ajax({
      url: '/api/page/line/delete',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ workspace_id: workspaceId, path: currentPage, line_id: id })
    }).done(function () {
      currentLines = currentLines.filter(l => l.id !== id);
      viewer.setOverlays(currentRegions, currentLines);
      selectedLineId = null;
      setPendingChanges(true);
    }).fail(function (xhr) {
      alert(`Failed to delete line: ${xhr.responseText || xhr.status}`);
    });
  }

  // Accordion behavior
  $(document).on('click', '.accordion-trigger', function () {
    const expanded = $(this).attr('aria-expanded') === 'true';
    $(this).attr('aria-expanded', expanded ? 'false' : 'true');
    const panel = $(this).next('.accordion-panel');
    if (expanded) {
      panel.slideUp(150);
    } else {
      panel.slideDown(150);
    }
  });

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

  function imgDeltaFromScreen(ev, lastImg) {
    const rect = document.getElementById('osd').getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    if (!viewer.viewer || !viewer.viewer.viewport) return null;
    const vp = viewer.viewer.viewport.pointFromPixel(new OpenSeadragon.Point(px, py));
    const img = viewer.viewer.viewport.viewportToImageCoordinates(vp);
    return { img, dx: img.x - lastImg.x, dy: img.y - lastImg.y };
  }

});
