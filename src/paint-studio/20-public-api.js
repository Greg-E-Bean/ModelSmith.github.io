      return { setMode, addLayer, undo, redo, init, composite,
               _history: () => history, _histIndex: () => histIndex, _jump: jumpToStep,
               _liveText: () => liveText, _setTool: (t) => setTool(t), _icon: (k) => svg(k),
               _cursorPos: () => cursorPos, _floatSel: () => floatSel, _sel: () => sel,
               _tool: () => tool, _layers: () => layers, _xform: () => xform, _zoom: () => zoom, _vsel: () => vSel };
    })();
    window.Paint = Paint;

    // Expose the paint timeline to the shared history panel.
    (window.__historyPending = window.__historyPending || []).push(['paint', {
      list: () => Paint._history(),
      index: () => Paint._histIndex(),
      jump: (i) => Paint._jump(i),
      limit: 60
    }]);

    // The header Undo/Redo must serve whichever workspace is on screen. This is
    // wired here (outside the 3D module's init) so it stays reliable even if the
    // 3D side is still starting up or failed to load — the paint studio doesn't
    // depend on three.js.
    (function wireHeaderHistory() {
      const attach = () => {
        const u = document.getElementById('bld-undo');
        const r = document.getElementById('bld-redo');
        if (!u || !r) return;
        const inPaint = () => {
          const p = document.getElementById('paint-app');
          return p && p.style.display !== 'none';
        };
        u.addEventListener('click', (e) => {
          if (inPaint()) { e.stopImmediatePropagation(); Paint.undo(); }
        }, true);
        r.addEventListener('click', (e) => {
          if (inPaint()) { e.stopImmediatePropagation(); Paint.redo(); }
        }, true);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
      else attach();
    })();
  