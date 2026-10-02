
    // ── Full panels toggle ───────────────────────────────────────────────────
    // By default the sidebars show only settings, because the menu bar and the
    // dialogs own the commands. Turning this on restores every original panel —
    // the tabs, the buttons, the lot — which is easier on a touch screen where
    // tapping a visible button beats opening a menu. Nothing is duplicated: the
    // panels and the menus have always driven the same controls, so both routes
    // work and stay in step.
    (function () {
      const KEY = 'modelsmith_panels_v1';
      function apply(on) {
        document.querySelectorAll('.app-container').forEach(c => c.classList.toggle('panels', on));
        document.querySelectorAll('.ms-panels-state').forEach(e => {
          e.textContent = on ? 'Hide extra panels' : 'Show all panels';
        });
      }
      function get() {
        try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
      }
      window.msTogglePanels = function () {
        const on = !get();
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
        apply(on);
        const b = document.getElementById('bld-banner') || document.getElementById('paint-banner');
        if (b) b.textContent = on
          ? 'All panels shown — every command is now in the sidebar as well as the menus.'
          : 'Extra panels hidden — commands live in the menu bar.';
      };
      window.msPanelsOn = get;
      function boot() { apply(get()); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else boot();
    })();
  