
    // ── Keyboard shortcuts dialog ────────────────────────────────────────────
    (function () {
      let scope = 'model', capturing = null;
      const $ = (id) => document.getElementById(id);
      const pretty = (k) => !k ? '—' : k.split('+').map(p =>
        p === 'ctrl' ? (navigator.platform.indexOf('Mac') >= 0 ? '\u2318' : 'Ctrl')
        : p === 'shift' ? 'Shift' : p === 'alt' ? 'Alt'
        : p === 'escape' ? 'Esc' : p === 'delete' ? 'Del'
        : p === 'space' ? 'Space' : p.toUpperCase()).join(' + ');

      function render() {
        const box = $('keys-detail'); if (!box || !window.Keys) return;
        box.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'fx-detail-title';
        title.textContent = scope === 'model' ? '3D workspace' : '2D studio';
        const hint = document.createElement('div');
        hint.className = 'fx-detail-hint';
        hint.textContent = 'Click a shortcut then press the keys you want. Escape cancels, Backspace clears it.';
        box.append(title, hint);
        Keys.list(scope).forEach(a => {
          const row = document.createElement('div');
          row.className = 'fx-row';
          const lab = document.createElement('span');
          lab.textContent = a.label;
          const btn = document.createElement('button');
          btn.className = 'mini-btn';
          btn.style.minWidth = '104px';
          btn.textContent = capturing === a.id ? 'press keys…' : pretty(a.key);
          if (capturing === a.id) btn.classList.add('primary');
          btn.onclick = () => { capturing = capturing === a.id ? null : a.id; render(); };
          row.append(lab, btn);
          box.appendChild(row);
        });
      }
      function msg(t) { const m = $('keys-msg'); if (m) m.textContent = t || ''; }

      // While the dialog is open it swallows every keystroke, so rebinding can use
      // keys that would otherwise trigger tools underneath.
      window.addEventListener('keydown', (e) => {
        const dlg = $('keys-dialog');
        if (!dlg || !dlg.classList.contains('open')) return;
        if (!capturing) {
          if (e.key === 'Escape') { close(); }
          return;
        }
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { capturing = null; msg('Cancelled.'); render(); return; }
        if (e.key === 'Backspace') { Keys.setBinding(scope, capturing, ''); capturing = null; msg('Cleared.'); render(); return; }
        // ignore lone modifier presses so a combo can be built up
        if (['Control','Meta','Shift','Alt'].includes(e.key)) return;
        const k = Keys.eventKey(e);
        const clash = Keys.conflict(scope, capturing, k);
        Keys.setBinding(scope, capturing, k);
        msg(clash ? 'Set — note this now also matches "' + clash.label + '".' : 'Saved.');
        capturing = null;
        render();
      }, true);

      function open() {
        const b = $('keys-backdrop'), d = $('keys-dialog');
        if (!b || !d) return;
        capturing = null; msg('');
        b.classList.add('open'); d.classList.add('open');
        render();
      }
      function close() {
        const b = $('keys-backdrop'), d = $('keys-dialog');
        if (b) b.classList.remove('open');
        if (d) d.classList.remove('open');
        capturing = null;
      }
      window.addEventListener('load', () => {
        const cog = $('keys-open');
        if (cog) cog.onclick = open;
        const cl = $('keys-close'); if (cl) cl.onclick = close;
        const dn = $('keys-done'); if (dn) dn.onclick = close;
        const bd = $('keys-backdrop'); if (bd) bd.onclick = close;
        const rs = $('keys-reset');
        if (rs) rs.onclick = () => { Keys.resetAll(); msg('All shortcuts restored to defaults.'); render(); };
        document.querySelectorAll('#keys-tabs .fx-item').forEach(t => {
          t.onclick = () => {
            scope = t.dataset.kscope;
            document.querySelectorAll('#keys-tabs .fx-item').forEach(x => x.classList.toggle('sel', x === t));
            capturing = null; msg(''); render();
          };
        });
      });
    })();
  