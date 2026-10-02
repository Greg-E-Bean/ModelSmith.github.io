
    // ── QR / Barcode panel wiring ────────────────────────────────────────────
    // Both are generated entirely client-side and extruded straight into a
    // solid via their own exact grid/bar builders (buildQR3DFromGrid,
    // buildBarcode3DFromWidths) — no image round-trip, so there's no
    // rasterizing or smoothing step anywhere that could round a corner.
    (function () {
      let kind = 'qr';           // 'qr' | 'barcode'
      let ecLevel = 'M';
      let currentQR = null;      // { modules, size, version, ecLevel }
      let currentBC = null;      // { widths, text }
      const say = (msg) => {
        // A separate script scope from the 3D engine, so this posts to the
        // same banner element directly rather than assuming a global
        // banner() exists — the same reason the builders themselves had to
        // be exposed on window to be reachable from here at all.
        const el = document.getElementById('bld-banner');
        if (!el) return;
        el.textContent = msg; el.classList.add('show');
        clearTimeout(window.__qrBannerT);
        window.__qrBannerT = setTimeout(() => el.classList.remove('show'), 4200);
      };

      function drawQR(qr, canvas) {
        const ctx = canvas.getContext('2d');
        const quiet = 4;
        const n = qr.size + quiet * 2;
        canvas.width = canvas.height = n;
        canvas.style.width = canvas.style.height = '148px';
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n, n);
        ctx.fillStyle = '#000';
        for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
          if (qr.modules[y][x]) ctx.fillRect(x + quiet, y + quiet, 1, 1);
        }
      }
      function drawBarcode(bc, canvas) {
        const ctx = canvas.getContext('2d');
        const quiet = 10;
        const total = quiet * 2 + bc.widths.reduce((a, b) => a + b, 0);
        canvas.width = total; canvas.height = Math.round(total * 0.35);
        canvas.style.width = '260px'; canvas.style.height = Math.round(260 * canvas.height / canvas.width) + 'px';
        const ctx2 = ctx;
        ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, canvas.width, canvas.height);
        ctx2.fillStyle = '#000';
        let x = quiet;
        bc.widths.forEach((w, i) => {
          if (i % 2 === 0) ctx2.fillRect(x, 0, w, canvas.height);
          x += w;
        });
      }

      // Rough usable-length note per mode/level, just for the live hint text —
      // the real limit is whatever the encoder actually accepts, checked live.
      function capacityNote() {
        if (kind === 'barcode') return 'Any printable text or number (letters, digits, standard punctuation) — around 60 characters keeps the printed code a practical size.';
        const cw = { L: 1588, M: 1258, Q: 902, H: 655 }[ecLevel]; // v25 data codewords, approx
        return 'Up to roughly ' + Math.floor(cw * 0.9) + ' characters at this level (less for accented text or emoji).';
      }

      function regenerate() {
        const text = (document.getElementById('qr-text') || {}).value || '';
        const canvas = document.getElementById('qr-preview');
        const status = document.getElementById('qr-status');
        const go = document.getElementById('bld-qr3d-go');
        const note = document.getElementById('qr-cap-note');
        if (note) note.textContent = capacityNote();
        currentQR = null; currentBC = null;
        if (!text.trim()) {
          if (go) go.disabled = true;
          if (status) status.textContent = '';
          if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
          return;
        }
        if (kind === 'qr') {
          let qr = null;
          try { qr = window.msEncodeQR ? window.msEncodeQR(text, ecLevel) : null; }
          catch (e) { qr = null; }
          if (!qr) {
            if (go) go.disabled = true;
            if (status) status.textContent = '⚠️ Too long for a QR code at this error-correction level — try a lower level or shorter text.';
            return;
          }
          currentQR = qr;
          if (canvas) drawQR(qr, canvas);
          if (go) go.disabled = false;
          if (status) status.textContent = 'Version ' + qr.version + ' • ' + qr.size + '×' + qr.size + ' modules • EC ' + ecLevel + '.';
        } else {
          let bc = null;
          try { bc = window.msEncode128 ? window.msEncode128(text) : null; }
          catch (e) { bc = null; }
          if (!bc) {
            if (go) go.disabled = true;
            if (status) status.textContent = '⚠️ That contains a character a barcode can\u2019t encode (only standard printable ASCII — letters, digits, common punctuation) — try removing it or switch to QR.';
            return;
          }
          currentBC = { widths: bc.widths, text };
          if (canvas) drawBarcode(currentBC, canvas);
          if (go) go.disabled = false;
          const bars = bc.widths.filter((_, i) => i % 2 === 0).length;
          if (status) status.textContent = bars + ' bars • Code 128.';
        }
      }

      function applyKind() {
        document.querySelectorAll('#qr-kind .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
        const ecRow = document.getElementById('qr-ec-row');
        const bcRow = document.getElementById('bc-height-row');
        if (ecRow) ecRow.style.display = kind === 'qr' ? '' : 'none';
        if (bcRow) bcRow.style.display = kind === 'barcode' ? '' : 'none';
        const note = document.getElementById('qr-kind-note');
        if (note) note.textContent = kind === 'qr'
          ? 'A 2D code that packs more text into a small area and keeps scanning even if part of the print is damaged.'
          : 'A classic 1D barcode (Code 128) — narrower to read, best for short IDs and part numbers.';
        const go = document.getElementById('bld-qr3d-go');
        if (go) go.textContent = 'Generate 3D model';
        regenerate();
      }

      function wire() {
        const textEl = document.getElementById('qr-text');
        if (textEl) textEl.addEventListener('input', regenerate);
        document.querySelectorAll('#qr-kind .toggle-btn').forEach(b => {
          b.onclick = () => { kind = b.dataset.kind; applyKind(); };
        });
        document.querySelectorAll('#qr-ec .toggle-btn').forEach(b => {
          b.onclick = () => {
            ecLevel = b.dataset.ec;
            document.querySelectorAll('#qr-ec .toggle-btn').forEach(x => x.classList.toggle('active', x === b));
            regenerate();
          };
        });
        const bcHeight = document.getElementById('bc-height');
        if (bcHeight) bcHeight.oninput = () => {
          document.getElementById('bc-height-val').textContent = bcHeight.value + ' mm';
        };
        const go = document.getElementById('bld-qr3d-go');
        if (go) go.onclick = () => {
          const footprint = parseFloat((document.getElementById('img3d-size') || {}).value) || 40;
          const depth = parseFloat((document.getElementById('img3d-depth') || {}).value) || 3;
          if (kind === 'qr') {
            if (!currentQR) return;
            if (!window.buildQR3DFromGrid) { say('⚠️ 3D isn\u2019t ready yet.'); return; }
            window.buildQR3DFromGrid(currentQR.modules, currentQR.size, { footprint, depth, quiet: 4 });
          } else {
            if (!currentBC) return;
            if (!window.buildBarcode3DFromWidths) { say('⚠️ 3D isn\u2019t ready yet.'); return; }
            const barHeight = parseFloat((document.getElementById('bc-height') || {}).value) || 18;
            window.buildBarcode3DFromWidths(currentBC.widths, { footprint, barHeight, depth, quiet: 10 });
          }
        };
        applyKind();
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
      else wire();
    })();
  