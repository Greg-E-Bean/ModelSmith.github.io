
    // ── Builder dialogs with live preview ────────────────────────────────────
    // 3D text, Image → 3D and Thread each have enough settings to warrant a
    // window. Rather than rebuilding their controls (which would give two sets to
    // keep in sync), the existing sidebar section is MOVED into the dialog and
    // moved back on close — one set of controls, one implementation.
    //
    // The preview runs its own tiny three.js scene so it can't disturb the real
    // one. It's rebuilt from the same generator the Add button uses, so what you
    // see is what gets added.
    (function () {
      const CFG = {
        text3d: { section: 'sec-text3d', title: '3D text',      run: 'bld-text3d-run' },
        img3d:  { section: 'sec-img3d',  title: 'Image → 3D',   run: null },
        thread: { section: 'sec-thread', title: 'Screw thread', run: 'bld-thread-run' }
      };
      let openKey = null, home = null, homeNext = null;
      let pr = null;   // { renderer, scene, camera, mesh }

      function ensurePreview() {
        if (pr || typeof THREE === 'undefined') return pr;
        const cv = document.getElementById('bd-preview');
        if (!cv) return null;
        try {
          const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 3000);
          scene.add(new THREE.AmbientLight(0xffffff, 0.62));
          const key = new THREE.DirectionalLight(0xffffff, 0.85);
          key.position.set(60, -80, 120); scene.add(key);
          const rim = new THREE.DirectionalLight(0x88aaff, 0.35);
          rim.position.set(-70, 60, -40); scene.add(rim);
          pr = { renderer, scene, camera, mesh: null, rot: 0.6, tilt: 0.9, drag: null };
          // Drag to orbit the preview.
          cv.style.touchAction = 'none';
          cv.addEventListener('pointerdown', e => { pr.drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
          cv.addEventListener('pointermove', e => {
            if (!pr.drag) return;
            pr.rot += (e.clientX - pr.drag.x) * 0.01;
            pr.tilt = Math.max(0.15, Math.min(Math.PI - 0.15, pr.tilt + (e.clientY - pr.drag.y) * 0.01));
            pr.drag = { x: e.clientX, y: e.clientY };
            frame();
          });
          ['pointerup','pointercancel'].forEach(ev => cv.addEventListener(ev, () => { pr.drag = null; }));
        } catch (e) { console.error('preview unavailable', e); pr = null; }
        return pr;
      }
      function frame() {
        if (!pr || !pr.mesh) return;
        const cv = pr.renderer.domElement;
        const w = cv.clientWidth || 280, h = cv.clientHeight || 220;
        pr.renderer.setSize(w, h, false);
        pr.camera.aspect = w / h; pr.camera.updateProjectionMatrix();
        const box = new THREE.Box3().setFromObject(pr.mesh);
        const sph = box.getBoundingSphere(new THREE.Sphere());
        const d = Math.max(6, sph.radius / Math.sin((pr.camera.fov * Math.PI / 180) / 2) * 1.15);
        pr.camera.position.set(
          sph.center.x + d * Math.sin(pr.tilt) * Math.cos(pr.rot),
          sph.center.y + d * Math.sin(pr.tilt) * Math.sin(pr.rot),
          sph.center.z + d * Math.cos(pr.tilt));
        pr.camera.up.set(0, 0, 1);
        pr.camera.lookAt(sph.center);
        pr.renderer.render(pr.scene, pr.camera);
      }
      function setPreviewGeometry(geo) {
        if (!ensurePreview()) return;
        if (pr.mesh) { pr.scene.remove(pr.mesh); pr.mesh.geometry.dispose(); pr.mesh = null; }
        if (!geo) { pr.renderer.clear(); return; }
        pr.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.35, metalness: 0.05 }));
        pr.scene.add(pr.mesh);
        frame();
      }
      // Ask the app for a preview of the current settings. The generators live in
      // the 3D engine, which exposes them for this purpose.
      function refreshPreview() {
        const cap = document.getElementById('bd-preview-cap');
        try {
          const fn = window.MS_PREVIEW && window.MS_PREVIEW[openKey];
          if (!fn) { setPreviewGeometry(null); if (cap) cap.textContent = 'Preview not available'; return; }
          const geo = fn();
          setPreviewGeometry(geo);
          if (cap) cap.textContent = geo ? 'Live preview — drag to rotate' : 'Nothing to preview yet';
        } catch (e) {
          setPreviewGeometry(null);
          if (cap) cap.textContent = 'Preview unavailable for these settings';
        }
      }
      let debounce = null;
      function schedule() { clearTimeout(debounce); debounce = setTimeout(refreshPreview, 220); }
      // Generators that need an async resource (a font, say) call this once it is
      // ready so the preview fills in rather than staying blank.
      window.MS_PREVIEW_REFRESH = () => { if (openKey) refreshPreview(); };

      function open(key) {
        const cfg = CFG[key]; if (!cfg) return;
        const sec = document.getElementById(cfg.section); if (!sec) return;
        if (openKey) close();
        openKey = key;
        home = sec.parentElement; homeNext = sec.nextSibling;
        const host = document.getElementById('bd-controls');
        host.innerHTML = '';
        sec.style.display = '';          // the section may be tab-hidden in the panel
        host.appendChild(sec);
        document.getElementById('bd-title').textContent = cfg.title;
        document.getElementById('bd-backdrop').classList.add('open');
        document.getElementById('bd-dialog').classList.add('open');
        // Any control change re-previews.
        host.addEventListener('input', schedule);
        host.addEventListener('change', schedule);
        setTimeout(refreshPreview, 60);
      }
      function close() {
        if (!openKey) return;
        const sec = document.getElementById(CFG[openKey].section);
        if (sec && home) home.insertBefore(sec, homeNext);   // put it back where it lives
        document.getElementById('bd-backdrop').classList.remove('open');
        document.getElementById('bd-dialog').classList.remove('open');
        setPreviewGeometry(null);
        openKey = null; home = null; homeNext = null;
      }
      function apply() {
        const cfg = CFG[openKey];
        const runId = cfg && cfg.run;
        if (runId) { const b = document.getElementById(runId); if (b) b.click(); }
        else if (openKey === 'img3d') {
          const b = document.getElementById('bld-img3d-regen');
          if (b) b.click();
        }
        close();
      }
      document.addEventListener('DOMContentLoaded', wire);
      if (document.readyState !== 'loading') wire();
      function wire() {
        const c = document.getElementById('bd-close'), x = document.getElementById('bd-cancel'),
              a = document.getElementById('bd-apply'), bg = document.getElementById('bd-backdrop');
        if (c) c.onclick = close;
        if (x) x.onclick = close;
        if (bg) bg.onclick = close;
        if (a) a.onclick = apply;
      }
      window.openBuilderDialog = open;
    })();
  