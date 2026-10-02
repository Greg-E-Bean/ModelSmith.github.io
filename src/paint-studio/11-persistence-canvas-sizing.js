      // ── Persistence ─────────────────────────────────────────────────────────
      const SAVE_KEY = 'modelsmith_paint_v1';
      let saveTimer = null;
      let _saveWarned = false;
      function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 1200); }
      function save() {
        let json;
        try { json = JSON.stringify(snapshot()); } catch (e) { return; }
        // IndexedDB has room for full-resolution layers, imported PSDs and custom
        // brushes, all of which used to compete for the same ~5MB as everything
        // else and could push the autosave over the edge without warning.
        if (window.Store && Store.available) {
          Store.set(SAVE_KEY, json)
            .then(() => { _saveWarned = false; localStorage.removeItem(SAVE_KEY); })
            .catch(() => {
              try { localStorage.setItem(SAVE_KEY, json); _saveWarned = false; }
              catch (e2) {
                if (!_saveWarned) {
                  _saveWarned = true;
                  banner('⚠️ Artwork too large to auto-save — export it from the Files tab to keep it safe.');
                }
              }
            });
          return;
        }
        try {
          localStorage.setItem(SAVE_KEY, json);
          _saveWarned = false;
        }
        catch (e) {
          if (!_saveWarned) {
            _saveWarned = true;
            banner('⚠️ Artwork too large to auto-save — export it from the Files tab to keep it safe.');
          }
        }
      }
      function load(onReady) {
        // Try IndexedDB first, then fall back to any legacy localStorage copy.
        if (window.Store && Store.available) {
          Store.get(SAVE_KEY).then(raw => {
            if (!raw) raw = localStorage.getItem(SAVE_KEY);
            if (!raw) { if (onReady) onReady(); return; }
            try { restore(JSON.parse(raw), onReady); } catch (e) { if (onReady) onReady(); }
          }).catch(() => {
            try {
              const raw = localStorage.getItem(SAVE_KEY);
              if (raw) restore(JSON.parse(raw), onReady); else if (onReady) onReady();
            } catch (e) { if (onReady) onReady(); }
          });
          return true;
        }
        try {
          const raw = localStorage.getItem(SAVE_KEY);
          if (!raw) return false;
          restore(JSON.parse(raw), onReady);
          return true;
        } catch (e) { return false; }
      }

      // ── Canvas sizing / zoom ────────────────────────────────────────────────
      function sizeWrap() {
        if (!wrap) return;
        wrap.style.width = (W * zoom) + 'px';
        wrap.style.height = (H * zoom) + 'px';
        view.style.width = (W * zoom) + 'px';
        view.style.height = (H * zoom) + 'px';
        const zv = $('ps-zoom-val'); if (zv) zv.textContent = Math.round(zoom * 100) + '%';
      }
      function fitZoom() {
        const vp = $('paint-viewport'); if (!vp) return;
        // Leave room for the floating tool rail (top) and brush bar (bottom) so
        // "Fit" shows the whole canvas instead of tucking its edges under them.
        const padX = 60, padY = vp.clientHeight > 520 ? 170 : 96;
        zoom = Math.min((vp.clientWidth - padX) / W, (vp.clientHeight - padY) / H, 1);
        zoom = Math.max(0.05, zoom);
        sizeWrap();
      }

      // ── Pointer → canvas coords ─────────────────────────────────────────────
      function pos(e) {
        const r = view.getBoundingClientRect();
        return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom, p: e.pressure > 0 ? e.pressure : 0.5 };
      }

