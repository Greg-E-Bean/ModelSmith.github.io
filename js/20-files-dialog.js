
    // ── 3D Files dialog ──────────────────────────────────────────────────────
    // Export, import, saved versions and the print check were four sections in a
    // long sidebar tab. They're now one window with its own tabs. The sections
    // themselves are MOVED into the dialog and put back on close — not copied —
    // so there is still exactly one of each control and all existing wiring
    // continues to work untouched.
    (function () {
      // Export and the print check moved into the Export model dialog, where
      // they belong together — this window is now import and version history.
      const PANES = {
        import:   { ids: ['sec-import'] },
        versions: { ids: ['sec-saves'] }
      };
      let homes = null, current = null;

      function stash() {
        if (homes) return;
        homes = {};
        Object.values(PANES).forEach(p => p.ids.forEach(id => {
          const el = document.getElementById(id);
          if (el) homes[id] = { parent: el.parentElement, next: el.nextSibling };
        }));
      }
      function show(key) {
        const body = document.getElementById('fd-body');
        if (!body) return;
        // Return whatever is on screen to the body's holding area first.
        current = key;
        document.querySelectorAll('#fd-tabs button').forEach(b =>
          b.classList.toggle('active', b.dataset.fd === key));
        Object.entries(PANES).forEach(([k, p]) => p.ids.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          if (k === key) { el.style.display = ''; body.appendChild(el); }
          else if (el.parentElement === body) { el.style.display = 'none'; }
        }));
      }
      function open() {
        stash();
        document.getElementById('fd-backdrop').classList.add('open');
        document.getElementById('fd-dialog').classList.add('open');
        show(current || 'import');
      }
      function close() {
        // Put every section back exactly where it came from, so the sidebar's own
        // tab logic keeps working if it's ever shown again.
        if (homes) Object.entries(homes).forEach(([id, h]) => {
          const el = document.getElementById(id);
          if (el && h.parent) h.parent.insertBefore(el, h.next);
        });
        document.getElementById('fd-backdrop').classList.remove('open');
        document.getElementById('fd-dialog').classList.remove('open');
      }
      window.openFilesDialog = open;

      function wire() {
        document.querySelectorAll('#fd-tabs button').forEach(b => {
          b.onclick = () => show(b.dataset.fd);
        });
        const c = document.getElementById('fd-close');
        if (c) c.onclick = close;
        const bd = document.getElementById('fd-backdrop');
        if (bd) bd.onclick = close;
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
      else wire();
    })();
  