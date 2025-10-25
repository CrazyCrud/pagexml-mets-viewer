$(function () {
  let workspaceId = null;
  let pages = [];
  let missingImages = [];

  const viewer = new OSDViewer();
  viewer.mount(document.getElementById('osd'));

  function setWs(id) {
    workspaceId = id;
    $('#wsIdTag').text(id);
    $('#wsBox').show();
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
      .done(function () { updateCommitUI(true); })
      .fail(function (xhr) { alert(`Commit failed: ${xhr.responseText || xhr.status}`); });
  });

  $('#btnReset').on('click', function () {
    workspaceId = null;
    pages = [];
    missingImages = [];
    $('#wsBox, #imagesBox, #pagesBox, #viewerBox').hide();
    $('#pagesInput, #imagesInput').val('');
    $('#pagesInputName, #imagesInputName').text('No files selected');
    $('#pagesUploadMsg, #imagesUploadMsg').text('');
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
        const imgUrl = data?.image?.url || '';
        const w = data?.image?.width || 0;
        const h = data?.image?.height || 0;

        viewer.setImage(imgUrl, w, h);
        viewer.setToggles({
          regions: $('#cbRegions').is(':checked'),
          lines:   $('#cbLines').is(':checked')
        });
        viewer.setOverlays(data.regions || [], data.lines || []);
        viewer.fit();

        renderStats(data.stats);
      })
      .fail(function (xhr) {
        alert(`Failed to load PAGE: ${xhr.responseText || xhr.status}`);
      });
  }

  // Toggle redraw on checkbox change (no refetch needed)
  $('#cbRegions, #cbLines').on('change', function () {
    viewer.setToggles({
      regions: $('#cbRegions').is(':checked'),
      lines:   $('#cbLines').is(':checked')
    });
  });
});
