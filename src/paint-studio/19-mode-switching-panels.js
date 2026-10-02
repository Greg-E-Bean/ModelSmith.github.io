      // ── Mode switching ──────────────────────────────────────────────────────
      function setMode(mode) {
        const model = document.querySelector('.app-container:not(.paint-app)');
        const paint = $('paint-app');
        if (!model || !paint) return;
        const toPaint = mode === 'paint';
        model.style.display = toPaint ? 'none' : '';
        paint.style.display = toPaint ? '' : 'none';
        document.querySelectorAll('#mode-switch .mode-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.mode === mode));
        const sub = document.querySelector('.brand-sub');
        if (sub) sub.textContent = toPaint ? 'paint studio' : 'CAD suite';
        if (toPaint) { if (!layers.length) init(); fitZoom(); composite(); }
        else if (window.invalidate3D) {
          // Coming back to 3D: the render loop idles while the 2D studio is showing,
          // so explicitly ask for frames or the viewport stays blank until you touch
          // something. Two passes — one now, one after layout settles.
          window.invalidate3D();
          setTimeout(() => { if (window.invalidate3D) window.invalidate3D(); }, 60);
          window.dispatchEvent(new Event('resize'));
        }
        if (window.renderHistoryPanel) window.renderHistoryPanel();
        else if (window.dispatchEvent) window.dispatchEvent(new Event('resize'));
      }

      function init() {
        if (!view) return;
        view.width = W; view.height = H;
        // Record the opening state, whether the document is new or restored. Without
        // it the timeline starts empty, the first stroke lands at index 0, and undo
        // has nothing to step back to — the "can't undo my first stroke" bug.
        const baseline = () => {
          if (history.length) return;
          history = []; histIndex = -1;
          pushHistory('Opened');
        };
        // A restored session decodes its layers asynchronously, so the snapshot has
        // to wait for the pixels; otherwise undo would restore a blank canvas.
        if (!load(baseline) || !layers.length) {
          const bg = makeLayer('Background', 'raster');
          bg.ctx.fillStyle = '#ffffff'; bg.ctx.fillRect(0, 0, W, H);
          const l1 = makeLayer('Layer 1', 'raster');
          layers = [bg, l1]; activeId = l1.id;
          baseline();
        }
        fitZoom(); renderLayerList(); composite(); syncHud(); syncFontList();
      }

      // boot
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { wire(); });
      else wire();
      document.querySelectorAll('#mode-switch .mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));

      // ── Collapsible panel sections ──────────────────────────────────────────
      // Make every panel section (both the 3D and Paint side panels) collapse from
      // its header, so unused tool groups don't eat vertical space. Runs once at
      // load; state persists per-section in localStorage.
      function enhanceCollapsibleSections() {
        const CHEVRON = '<svg class="collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        // Sections whose visibility/content is managed dynamically must NOT be made
        // collapsible — wrapping their body fights the code that shows/hides parts of
        // them (e.g. the contextual Tool panel swaps .tool-ctx children in and out).
        const SKIP = new Set(['psec-tool']);
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('modelsmith_collapsed_v1') || '{}'); } catch (e) {}
        const persist = () => { try { localStorage.setItem('modelsmith_collapsed_v1', JSON.stringify(saved)); } catch (e) {} };

        document.querySelectorAll('.section').forEach(section => {
          if (SKIP.has(section.id) || section.dataset.collapsibleReady) return;
          // Only a real .section-label is a valid collapse header. Never treat a
          // .tool-ctx-name (which changes text as tools switch) as one.
          const header = section.querySelector(':scope > .section-label');
          if (!header) return;
          section.dataset.collapsibleReady = '1';

          // Wrap everything after the header into a body wrapper we can animate.
          const body = document.createElement('div');
          body.className = 'section-body';
          let node = header.nextSibling;
          while (node) { const next = node.nextSibling; body.appendChild(node); node = next; }
          section.appendChild(body);

          header.classList.add('collapsible');
          header.insertAdjacentHTML('beforeend', CHEVRON);

          const key = section.id || header.textContent.trim();
          const setState = (collapsed, animate) => {
            if (collapsed) {
              body.style.height = body.scrollHeight + 'px';
              requestAnimationFrame(() => { section.classList.add('section-collapsed'); body.style.height = '0px'; });
            } else {
              section.classList.remove('section-collapsed');
              body.style.height = body.scrollHeight + 'px';
              const done = () => { if (!section.classList.contains('section-collapsed')) body.style.height = ''; body.removeEventListener('transitionend', done); };
              if (animate) body.addEventListener('transitionend', done); else body.style.height = '';
            }
          };

          if (saved[key]) { section.classList.add('section-collapsed'); body.style.height = '0px'; }

          header.addEventListener('click', (e) => {
            if (e.target.closest('button, input, select, a')) return;
            const nowCollapsed = !section.classList.contains('section-collapsed');
            setState(nowCollapsed, true);
            saved[key] = nowCollapsed; persist();
          });
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceCollapsibleSections);
      else enhanceCollapsibleSections();

