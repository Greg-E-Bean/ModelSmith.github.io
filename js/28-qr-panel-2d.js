
    // ── 2D QR / Barcode panel wiring ──────────────────────────────────────────
    // Same encoders as the 3D panel (window.msEncodeQR / window.msEncode128),
    // but drawn straight onto a new layer's own canvas instead of extruded —
    // this is flat artwork, so there's no 3D builder involved. Every pixel is
    // placed with a plain integer fillRect and imageSmoothingEnabled off, the
    // same crispness rule the 3D fix depends on: no scaling, tracing or
    // smoothing step exists anywhere that could blur a module or bar together.
    (function () {
      let kind = 'qr';
      let ecLevel = 'M';
      let currentQR = null;
      let currentBC = null;

      const say = (msg) => {
        const el = document.getElementById('bld-banner') || document.getElementById('paint-banner');
        if (!el) return;
        el.textContent = msg; el.classList.add('show');
        clearTimeout(window.__pqrBannerT);
        window.__pqrBannerT = setTimeout(() => el.classList.remove('show'), 4200);
      };

      function drawPreviewQR(qr, canvas) {
        const ctx = canvas.getContext('2d');
        const quiet = 4, n = qr.size + quiet * 2;
        canvas.width = canvas.height = n;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n, n);
        ctx.fillStyle = '#000';
        for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
          if (qr.modules[y][x]) ctx.fillRect(x + quiet, y + quiet, 1, 1);
        }
      }
      function drawPreviewBC(bc, canvas) {
        const ctx = canvas.getContext('2d');
        const quiet = 10;
        const total = quiet * 2 + bc.widths.reduce((a, b) => a + b, 0);
        canvas.width = total; canvas.height = Math.round(total * 0.35);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        let x = quiet;
        bc.widths.forEach((w, i) => { if (i % 2 === 0) ctx.fillRect(x, 0, w, canvas.height); x += w; });
      }

      function regenerate() {
        const text = (document.getElementById('pqr-text') || {}).value || '';
        const canvas = document.getElementById('pqr-preview');
        const status = document.getElementById('pqr-status');
        const go = document.getElementById('pqr-go');
        currentQR = null; currentBC = null;
        if (!text.trim()) {
          if (go) go.disabled = true;
          if (status) status.textContent = '';
          if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
          return;
        }
        if (kind === 'qr') {
          let qr = null;
          try { qr = window.msEncodeQR ? window.msEncodeQR(text, ecLevel) : null; } catch (e) { qr = null; }
          if (!qr) {
            if (go) go.disabled = true;
            if (status) status.textContent = '⚠️ Too long for a QR code at this error-correction level — try a lower level or shorter text.';
            return;
          }
          currentQR = qr;
          if (canvas) drawPreviewQR(qr, canvas);
          if (go) go.disabled = false;
          if (status) status.textContent = 'Version ' + qr.version + ' • ' + qr.size + '×' + qr.size + ' modules • EC ' + ecLevel + '.';
        } else {
          let bc = null;
          try { bc = window.msEncode128 ? window.msEncode128(text) : null; } catch (e) { bc = null; }
          if (!bc) {
            if (go) go.disabled = true;
            if (status) status.textContent = '⚠️ That contains a character a barcode can\u2019t encode (only standard printable ASCII) — try removing it or switch to QR.';
            return;
          }
          currentBC = { widths: bc.widths, text };
          if (canvas) drawPreviewBC(currentBC, canvas);
          if (go) go.disabled = false;
          const bars = bc.widths.filter((_, i) => i % 2 === 0).length;
          if (status) status.textContent = bars + ' bars • Code 128.';
        }
      }

      function applyKind() {
        document.querySelectorAll('#pqr-kind .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
        const ecRow = document.getElementById('pqr-ec-row');
        const hRow = document.getElementById('pqr-height-row');
        if (ecRow) ecRow.style.display = kind === 'qr' ? '' : 'none';
        if (hRow) hRow.style.display = kind === 'barcode' ? '' : 'none';
        regenerate();
      }

      // Straight onto a new layer's own canvas — no smoothing, no scaling step,
      // every module/bar placed as an exact integer-pixel rectangle.
      function addQRLayer() {
        if (!currentQR || !window.Paint) return;
        const target = parseInt(document.getElementById('pqr-width').value, 10) || 300;
        const quiet = 4, n = currentQR.size + quiet * 2;
        const cell = Math.max(1, Math.round(target / n));
        const size = cell * n;
        const layers = window.Paint._layers();
        const docW = layers[0] ? layers[0].canvas.width : size;
        const docH = layers[0] ? layers[0].canvas.height : size;
        const l = window.Paint.addLayer('raster', 'QR code');
        const ctx = l.ctx;
        ctx.imageSmoothingEnabled = false;
        const ox = Math.round((docW - size) / 2), oy = Math.round((docH - size) / 2);
        ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, size, size);
        ctx.fillStyle = '#000';
        for (let y = 0; y < currentQR.size; y++) for (let x = 0; x < currentQR.size; x++) {
          if (currentQR.modules[y][x]) ctx.fillRect(ox + (x + quiet) * cell, oy + (y + quiet) * cell, cell, cell);
        }
        window.Paint.composite();
        say('Added a QR code layer — ' + currentQR.size + '×' + currentQR.size + ' modules, no smoothing, so it scans.');
      }
      function addBarcodeLayer() {
        if (!currentBC || !window.Paint) return;
        const targetW = parseInt(document.getElementById('pqr-width').value, 10) || 300;
        const targetH = parseInt(document.getElementById('pqr-height').value, 10) || 110;
        const quiet = 10;
        const totalUnits = quiet * 2 + currentBC.widths.reduce((a, b) => a + b, 0);
        const cell = Math.max(1, targetW / totalUnits);
        const w = Math.round(totalUnits * cell), h = targetH;
        const layers = window.Paint._layers();
        const docW = layers[0] ? layers[0].canvas.width : w;
        const docH = layers[0] ? layers[0].canvas.height : h;
        const l = window.Paint.addLayer('raster', 'Barcode');
        const ctx = l.ctx;
        ctx.imageSmoothingEnabled = false;
        const ox = Math.round((docW - w) / 2), oy = Math.round((docH - h) / 2);
        ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, w, h);
        ctx.fillStyle = '#000';
        let x = ox + Math.round(quiet * cell);
        currentBC.widths.forEach((wd, i) => {
          const wide = Math.round(wd * cell);
          if (i % 2 === 0) ctx.fillRect(x, oy, wide, h);
          x += wide;
        });
        window.Paint.composite();
        const bars = currentBC.widths.filter((_, i) => i % 2 === 0).length;
        say('Added a barcode layer — ' + bars + ' bars, no smoothing, so it scans.');
      }

      window.msRevealQR2D = function () {
        const tabBtn = document.querySelector('#paint-tabs button[data-ptab="layers"]');
        if (tabBtn) tabBtn.click();
        const sec = document.getElementById('lsub-qr2d');
        if (sec) sec.classList.add('ms-show');
        setTimeout(() => {
          const box = document.getElementById('lsub-qr2d');
          const head = box && box.querySelector('.lsub-head');
          if (box && head && !box.classList.contains('open')) head.click();
          const t = document.getElementById('pqr-text');
          if (t) t.focus();
        }, 120);
      };

      function wire() {
        const textEl = document.getElementById('pqr-text');
        if (textEl) textEl.addEventListener('input', regenerate);
        document.querySelectorAll('#pqr-kind .toggle-btn').forEach(b => {
          b.onclick = () => { kind = b.dataset.kind; applyKind(); };
        });
        document.querySelectorAll('#pqr-ec .toggle-btn').forEach(b => {
          b.onclick = () => {
            ecLevel = b.dataset.ec;
            document.querySelectorAll('#pqr-ec .toggle-btn').forEach(x => x.classList.toggle('active', x === b));
            regenerate();
          };
        });
        const wEl = document.getElementById('pqr-width'), wVal = document.getElementById('pqr-width-val');
        if (wEl) wEl.oninput = () => { if (wVal) wVal.textContent = wEl.value + ' px'; };
        const hEl = document.getElementById('pqr-height'), hVal = document.getElementById('pqr-height-val');
        if (hEl) hEl.oninput = () => { if (hVal) hVal.textContent = hEl.value + ' px'; };
        const go = document.getElementById('pqr-go');
        if (go) go.onclick = () => {
          if (!window.Paint) { say('⚠️ 2D isn\u2019t ready yet.'); return; }
          if (kind === 'qr') addQRLayer(); else addBarcodeLayer();
        };
        applyKind();
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
      else wire();
    })();
  