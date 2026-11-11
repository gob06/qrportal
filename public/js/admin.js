// Admin client-side behavior (CSP-safe: no inline scripts).
(function () {
  'use strict';

  // Confirmation prompts on destructive forms.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Logo file preview on the organization form.
  var logoInput = document.getElementById('logoInput');
  if (logoInput) {
    logoInput.addEventListener('change', function () {
      var file = logoInput.files && logoInput.files[0];
      var preview = document.getElementById('logoPreview');
      var placeholder = document.getElementById('logoPlaceholder');
      if (!file || !preview) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        preview.src = e.target.result;
        preview.classList.remove('d-none');
        if (placeholder) placeholder.classList.add('d-none');
      };
      reader.readAsDataURL(file);
    });
  }

  // QR generator: live preview + download links reflect current options.
  var qrPage = document.getElementById('qrPage');
  if (qrPage) {
    var orgId = qrPage.getAttribute('data-org-id');
    var preview = document.getElementById('qrPreview');
    var dlPng = document.getElementById('dlPng');
    var dlSvg = document.getElementById('dlSvg');

    var buildQuery = function () {
      var params = new URLSearchParams({
        fg: document.getElementById('qrFg').value,
        bg: document.getElementById('qrBg').value,
        size: document.getElementById('qrSize').value,
        margin: document.getElementById('qrMargin').value,
        ec: document.getElementById('qrEc').value
      });
      if (document.getElementById('qrLogo').checked) params.set('logo', '1');
      return params.toString();
    };

    var refresh = function () {
      var qs = buildQuery();
      preview.src = '/admin/organizations/' + orgId + '/qr/preview?' + qs + '&t=' + Date.now();
      dlPng.href = '/admin/organizations/' + orgId + '/qr/download.png?' + qs;
      dlSvg.href = '/admin/organizations/' + orgId + '/qr/download.svg?' + qs;
    };

    document.querySelectorAll('.js-qr-opt').forEach(function (el) {
      el.addEventListener('change', refresh);
    });
    refresh();
  }

  // Social link reordering with up/down buttons.
  var linkList = document.getElementById('linkList');
  if (linkList) {
    var saveOrder = function () {
      var ids = Array.prototype.map.call(
        linkList.querySelectorAll('[data-link-id]'),
        function (el) { return el.getAttribute('data-link-id'); }
      );
      fetch('/admin/organizations/' + linkList.getAttribute('data-org-id') + '/social-links/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': linkList.getAttribute('data-csrf')
        },
        body: JSON.stringify({ order: ids })
      }).catch(function () {});
    };

    linkList.addEventListener('click', function (e) {
      var up = e.target.closest('.js-move-up');
      var down = e.target.closest('.js-move-down');
      if (!up && !down) return;
      var item = e.target.closest('[data-link-id]');
      if (!item) return;
      // Each link row is followed by its collapsible edit panel; move both.
      var editPanel = item.nextElementSibling;
      var block = [item];
      if (editPanel && editPanel.classList.contains('collapse')) block.push(editPanel);

      var rows = Array.prototype.filter.call(linkList.children, function (el) {
        return el.hasAttribute('data-link-id');
      });
      var idx = rows.indexOf(item);
      if (up && idx > 0) {
        var ref = rows[idx - 1];
        block.forEach(function (el) { linkList.insertBefore(el, ref); });
        saveOrder();
      } else if (down && idx < rows.length - 1) {
        var nextRow = rows[idx + 1];
        var nextPanel = nextRow.nextElementSibling;
        var after = (nextPanel && nextPanel.classList.contains('collapse')) ? nextPanel : nextRow;
        block.forEach(function (el) {
          linkList.insertBefore(el, after.nextSibling);
          after = el;
        });
        saveOrder();
      }
    });
  }

  // Analytics chart.
  var chartEl = document.getElementById('dailyChart');
  var chartData = document.getElementById('dailyData');
  if (chartEl && chartData && window.Chart) {
    var daily = JSON.parse(chartData.textContent);
    new window.Chart(chartEl, {
      type: 'bar',
      data: {
        labels: daily.map(function (d) { return d.day.slice(5); }),
        datasets: [{
          label: 'Scans',
          data: daily.map(function (d) { return d.scans; }),
          backgroundColor: 'rgba(13, 110, 253, 0.65)',
          borderRadius: 4
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }
})();
