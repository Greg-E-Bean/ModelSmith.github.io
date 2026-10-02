
    // ── Export model dialog (3D) ─────────────────────────────────────────────
    // One "Export model…" entry in File, opening a window that covers naming, the
    // format, and the print validation you'd want to run before committing to a
    // job. Everything here drives the EXISTING controls — the three export
    // buttons, the repair button and the print check — so there is still one
    // implementation of each and the results stay identical.
    (function () {
      let settingsHome = null;

      function syncExt() {
        const f = document.getElementById('me-format');
        const ext = f ? f.value : 'stl';
        const e = document.getElementById('me-ext');
        if (e) e.textContent = '.' + ext;
        // "Keep original UVs" only means anything for OBJ.
        const uv = document.getElementById('me-uv-row');
        if (uv) uv.style.display = (ext === 'obj') ? '' : 'none';
        note();
      }
      function note() {
        const n = document.getElementById('me-note');
        if (!n) return;
        const f = (document.getElementById('me-format') || {}).value || 'stl';
        n.textContent = f === 'stl'
          ? 'STL carries shape only — no colour. This is what most slicers expect.'
          : f === 'obj'
            ? 'OBJ keeps colour. For painting apps like Procreate leave "Keep original UVs" off.'
            : '3MF keeps colour, units and object separation — the richest option where your slicer supports it.';
      }
      function open() {
        const dlg = document.getElementById('me-dialog');
        if (!dlg) return;
        // Seed the name from the existing field so the two never disagree.
        const src = document.getElementById('export-name');
        const nm = document.getElementById('me-name');
        if (src && nm) nm.value = src.value || '';
        const uv = document.getElementById('export-keepuv');
        const meuv = document.getElementById('me-keepuv');
        if (uv && meuv) meuv.checked = uv.checked;
        // Borrow the printer settings from the print-check panel rather than
        // duplicating four sliders that would then need keeping in step.
        const pc = document.getElementById('sec-printcheck');
        const host = document.getElementById('me-settings-body');
        if (pc && host && pc.parentElement !== host) {
          settingsHome = { parent: pc.parentElement, next: pc.nextSibling };
          pc.style.display = '';
          host.appendChild(pc);
        }
        syncExt();
        document.getElementById('me-backdrop').classList.add('open');
        dlg.classList.add('open');
      }
      function close() {
        // Put the print-check section back where it lives.
        const pc = document.getElementById('sec-printcheck');
        if (pc && settingsHome && settingsHome.parent) {
          settingsHome.parent.insertBefore(pc, settingsHome.next);
          settingsHome = null;
        }
        document.getElementById('me-backdrop').classList.remove('open');
        document.getElementById('me-dialog').classList.remove('open');
      }
      window.openExportModel = open;

      function wire() {
        const on = (id, fn, ev) => { const e = document.getElementById(id); if (e) e[ev || 'onclick'] = fn; };
        on('me-close', close);
        on('me-cancel', close);
        on('me-backdrop', close);
        on('me-format', syncExt, 'onchange');
        on('me-check', () => {
          const b = document.getElementById('pc-run');
          if (b) b.click();
          // Show the report inside this dialog rather than back in the sidebar.
          setTimeout(() => {
            const res = document.getElementById('pc-results');
            const here = document.getElementById('me-results');
            if (res && here) here.innerHTML = res.innerHTML;
          }, 350);
        });
        on('me-repair', () => {
          const b = document.getElementById('bld-repair-mesh');
          if (b) b.click();
        });
        on('me-go', () => {
          const nm = (document.getElementById('me-name').value || '').trim();
          const src = document.getElementById('export-name');
          if (src) src.value = nm;
          const uv = document.getElementById('export-keepuv');
          const meuv = document.getElementById('me-keepuv');
          if (uv && meuv) uv.checked = meuv.checked;
          const f = document.getElementById('me-format').value;
          const map = { stl: 'bld-export-stl', obj: 'bld-export-obj', '3mf': 'bld-export-3mf' };
          close();
          const b = document.getElementById(map[f]);
          if (b) b.click();
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
      else wire();
    })();
  