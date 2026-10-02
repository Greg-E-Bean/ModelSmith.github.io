
    // ── Sidebar resizing ─────────────────────────────────────────────────────
    // Adds a drag handle to each sidebar's inner edge. Pointer events so it works
    // with a mouse or a stylus; hidden on touch, where there's no precise cursor
    // and an edge drag would fight with scrolling.
    (function () {
      const KEY = 'modelsmith_sidew_v1';
      const MIN = 210, MAX = 620;
      function widths() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
      }
      function saveWidth(id, w) {
        const all = widths(); all[id] = w;
        try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
      }
      function attach(bar) {
        if (!bar || bar.querySelector('.side-grip')) return;
        bar.style.position = bar.style.position || 'relative';
        const grip = document.createElement('div');
        grip.className = 'side-grip';
        grip.title = 'Drag to resize · double-click to reset';
        bar.appendChild(grip);
        // Put the handle on the edge that faces the canvas, and keep it there if
        // the panel is flipped to the other side.
        const placeGrip = () => {
          const b = bar.getBoundingClientRect();
          grip.dataset.edge = (b.left > window.innerWidth / 2) ? 'left' : 'right';
        };
        placeGrip();
        window.addEventListener('resize', placeGrip);
        const flip = document.getElementById('side-flip');
        if (flip) flip.addEventListener('click', () => setTimeout(placeGrip, 260));

        const stored = widths()[bar.id];
        if (stored) bar.style.width = stored + 'px';

        let startX = 0, startW = 0;
        grip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          grip.setPointerCapture(e.pointerId);
          startX = e.clientX;
          startW = bar.getBoundingClientRect().width;
          grip.classList.add('dragging');
          bar.classList.add('resizing');
          document.body.classList.add('ms-resizing');
        });
        grip.addEventListener('pointermove', (e) => {
          if (!grip.classList.contains('dragging')) return;
          // Which way widens depends on which side the panel is docked.
          const onRight = grip.dataset.edge === 'left';   // handle on the left = panel on the right
          const delta = onRight ? (startX - e.clientX) : (e.clientX - startX);
          const w = Math.max(MIN, Math.min(MAX, Math.round(startW + delta)));
          bar.style.width = w + 'px';
        });
        const end = () => {
          if (!grip.classList.contains('dragging')) return;
          grip.classList.remove('dragging');
          bar.classList.remove('resizing');
          document.body.classList.remove('ms-resizing');
          saveWidth(bar.id, Math.round(bar.getBoundingClientRect().width));
          // The 3D renderer sizes itself to its container, so tell it to re-measure.
          window.dispatchEvent(new Event('resize'));
        };
        ['pointerup', 'pointercancel'].forEach(ev => grip.addEventListener(ev, end));
        // Double-click the handle to return to the default width.
        grip.addEventListener('dblclick', () => {
          bar.style.width = '';
          const all = widths(); delete all[bar.id];
          try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
          window.dispatchEvent(new Event('resize'));
        });
      }
      function boot() {
        ['app-sidebar', 'paint-sidebar'].forEach(id => attach(document.getElementById(id)));
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else boot();
    })();
  