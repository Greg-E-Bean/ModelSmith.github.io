
    // ═══════════════════════════════════════════════════════════════════════════
    //   PAINT STUDIO
    //   A layered raster + vector drawing workspace living alongside the 3D
    //   modeller. Each layer owns its own offscreen canvas; the visible canvas is
    //   a composite re-drawn whenever something changes. Vector layers keep a list
    //   of editable shapes and are re-rendered from that list, so they stay crisp
    //   and re-editable until rasterised.
    // ═══════════════════════════════════════════════════════════════════════════
    const Paint = (function () {
      let W = 1024, H = 1024;
      let layers = [];             // { id, name, canvas, ctx, visible, opacity, blend, kind, shapes[] }
      let activeId = null;
      let tool = 'brush';
      let zoom = 1;
      let history = [], histIndex = -1;
      const MAX_HIST = 60;

      const view = document.getElementById('paint-canvas');
      const vctx = view ? view.getContext('2d') : null;
      const wrap = document.getElementById('canvas-wrap');

      const $ = (id) => document.getElementById(id);
      const banner = (msg) => {
        const b = $('paint-banner'); if (!b) return;
        b.textContent = msg; b.classList.add('show');
        clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 2600);
      };

