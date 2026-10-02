      // ── Session autosave / crash recovery ────────────────────────────────
      // Serialise the current objects (geometry + transform + colour) into
      // localStorage every few seconds and after edits, so an accidental close or
      // crash doesn't lose work. Restored on next launch if a session is found.
      const SESSION_KEY = 'modelsmith_session_v1';
      let sessionSaveTimer = null;

      function serializeScene() {
        const out = [];
        const collect = (o) => {
          if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) {
            if (o.children && o.children.length) o.children.forEach(collect);
            return;
          }
          o.updateMatrixWorld(true);
          const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
          const pos = g.attributes.position;
          const col = g.attributes.color;
          const P = new Float32Array(pos.count * 3);
          const v = new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); P[i*3]=v.x; P[i*3+1]=v.y; P[i*3+2]=v.z; }
          let C = null;
          if (col) { C = new Array(col.count*3); for (let i=0;i<col.count;i++){ C[i*3]=+col.getX(i).toFixed(4); C[i*3+1]=+col.getY(i).toFixed(4); C[i*3+2]=+col.getZ(i).toFixed(4); } }
          const mat = Array.isArray(o.material) ? o.material[0] : o.material;
          out.push({
            p: Array.from(P, x => +x.toFixed(4)),
            c: C,
            color: mat && mat.color ? mat.color.getHex() : 0xb0b8c8,
            vColors: !!(mat && mat.vertexColors),
            isSketch: !!o.userData.isSketch,
            name: o.name || ''
          });
        };
        objects.forEach(collect);
        return out;
      }

      // Cheap fingerprint of everything serializeScene() would write. The 20-second
      // safety timer compares it with the last saved one, so an idle (or Paint-mode)
      // session no longer re-serialises every vertex of every object for nothing.
      let _lastSessionSig = null;
      function sessionSignature() {
        let s = objects.length + '|';
        objects.forEach(o => {
          s += o.uuid + ':' + o.name + ':' + o.matrix.elements.join(',');
          o.traverse(c => {
            const pos = c.geometry && c.geometry.attributes && c.geometry.attributes.position;
            if (!pos) return;
            const col = c.geometry.attributes.color;
            const m = Array.isArray(c.material) ? c.material[0] : c.material;
            s += '#' + c.geometry.uuid + '.' + pos.version + '.' + pos.count + (col ? '.' + col.version : '') + (m && m.color ? '.' + m.color.getHex() : '');
          });
          s += ';';
        });
        return s;
      }
      function autosaveTick() {
        const paintEl = document.getElementById('paint-app');
        if (paintEl && paintEl.style.display !== 'none') return;   // 3D scene can't change while painting
        if (objects.length && sessionSignature() === _lastSessionSig) return;
        saveSession();
      }

      function saveSession() {
        try {
          if (!objects.length) {
            localStorage.removeItem(SESSION_KEY);
            if (window.Store && Store.available) Store.del(SESSION_KEY).catch(() => {});
            updateSessionStatus(); return;
          }
          _lastSessionSig = sessionSignature();
          const data = { v: 1, savedAt: Date.now(), objects: serializeScene() };
          const json = JSON.stringify(data);
          // IndexedDB first: it has room for models that localStorage simply could
          // not hold, which is why dense meshes used to fail to autosave entirely.
          if (window.Store && Store.available) {
            Store.set(SESSION_KEY, json)
              .then(() => { localStorage.removeItem(SESSION_KEY); updateSessionStatus(); })
              .catch(() => {
                // Fall back so a storage failure never means losing the session.
                try {
                  if (json.length <= 4.8 * 1024 * 1024) localStorage.setItem(SESSION_KEY, json);
                  else banner("⚠️ Model too large to auto-save — export to keep it safe.");
                } catch (e2) {}
                updateSessionStatus();
              });
            return;
          }
          if (json.length > 4.8 * 1024 * 1024) { banner("⚠️ Model too large to auto-save — export to keep it safe."); return; }
          localStorage.setItem(SESSION_KEY, json);
          updateSessionStatus();
        } catch (e) { /* private mode / quota — ignore */ }
      }

      function scheduleSessionSave() {
        if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
        sessionSaveTimer = setTimeout(saveSession, 1200);
      }

      // IndexedDB is asynchronous but the callers here are not, so the session is
      // pulled into a small cache as soon as it's available and read synchronously
      // from there. localStorage is still checked as a fallback for anyone whose
      // data hasn't migrated yet.
      let _sessionCache = null, _sessionReady = false;
      function loadSessionData() {
        if (_sessionCache) return _sessionCache;
        try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
        catch (e) { return null; }
      }
      function primeSessionCache() {
        if (!(window.Store && Store.available)) return Promise.resolve(null);
        return Store.get(SESSION_KEY).then(raw => {
          if (raw) { try { _sessionCache = JSON.parse(raw); } catch (e) {} }
          _sessionReady = true;
          return _sessionCache;
        }).catch(() => { _sessionReady = true; return null; });
      }

      function restoreSession(data) {
        if (!data || !data.objects) return;
        objects.slice().forEach(o => scene.remove(o));
        objects = []; selected = []; transformControl.detach();
        data.objects.forEach(rec => {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rec.p), 3));
          if (rec.c) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rec.c), 3));
          g.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: rec.color, roughness: 0.55, metalness: 0.0, vertexColors: !!rec.vColors, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(g, mat);
          mesh.castShadow = true; mesh.receiveShadow = true;
          if (rec.name) mesh.name = rec.name;
          if (rec.isSketch) mesh.userData.isSketch = true;
          scene.add(mesh); objects.push(mesh);
        });
        historyTimeline = []; historyIndex = -1;
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Recovered your previous session — ${objects.length} object${objects.length!==1?'s':''}.`);
      }

      function clearSession() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        updateSessionStatus();
      }

      function updateSessionStatus() {
        const el = document.getElementById('session-status');
        if (!el) return;
        const data = loadSessionData();
        if (data && data.savedAt) {
          const secs = Math.round((Date.now() - data.savedAt)/1000);
          const when = secs < 60 ? 'just now' : secs < 3600 ? `${Math.round(secs/60)} min ago` : `${Math.round(secs/3600)} hr ago`;
          el.textContent = `Auto-saved ${when} · ${data.objects.length} object${data.objects.length!==1?'s':''}`;
        } else {
          el.textContent = 'No auto-saved session yet.';
        }
      }

      // Deep-clone userData for history snapshots WITHOUT destroying THREE.js objects.
      // A plain JSON round-trip turns THREE.Shape / Matrix4 / Vector3 into dead plain
      // objects (losing .getPoints(), etc.), which is why revolve/push-pull/loft broke
      // on a sketch after an undo. Here we copy plain values but keep any object that
      // has a .clone() method (Shapes, matrices, vectors) as a real clone.
      function cloneUserData(ud) {
        const cloneVal = (v) => {
          if (v == null || typeof v !== 'object') return v;
          if (typeof v.clone === 'function') return v.clone();      // THREE.Shape, Matrix4, Vector3, …
          if (Array.isArray(v)) return v.map(cloneVal);
          const out = {};
          for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = cloneVal(v[k]);
          return out;
        };
        return cloneVal(ud || {});
      }

      function saveHistory(label) {
        updateGridExtent();
        // If a group pivot is active, release it first so every object's transform
        // is expressed in world/scene space before we snapshot, then rebuild it.
        const hadPivot = !!groupPivot;
        if (hadPivot) detachGroupPivot();

        if (historyIndex < historyTimeline.length - 1) { historyTimeline = historyTimeline.slice(0, historyIndex + 1); }
        objects.forEach(stableId);   // give each object an identity that survives clone()
        const snapshot = objects.map(obj => {
          const clone = obj.clone();
          if (obj.geometry) clone.geometry = obj.geometry.clone();
          if (obj.material) {
            if (Array.isArray(obj.material)) clone.material = obj.material.map(m => m.clone());
            else clone.material = obj.material.clone();
          }
          clone.userData = cloneUserData(obj.userData);
          clone.name = obj.name;
          return clone;
        });
        // Carry a label and a small preview alongside the objects, so the history
        // panel can show what each step was. Non-enumerable-ish extras on the array
        // keep the rest of the restore path untouched.
        snapshot.label = label || describeChange(historyTimeline[historyIndex], snapshot);
        snapshot.at = Date.now();
        snapshot.thumb = null;
        historyTimeline.push(snapshot);
        if (historyTimeline.length > HISTORY_LIMIT) historyTimeline.shift();
        // Work out what this step changed while both snapshots are to hand; the
        // render loop uses it to ring the affected areas on the thumbnail.
        _thumbWanted = snapshot;
        _thumbMarks = changedObjects(historyTimeline[historyTimeline.length - 2], snapshot);
        historyIndex = historyTimeline.length - 1;

        if (hadPivot && selected.length > 1) attachGizmoToSelection();
        scheduleSessionSave();   // keep the crash-recovery copy fresh
        renderHistoryPanel();
      }

      // Work out a readable label by diffing against the previous snapshot, so the
      // ~46 existing saveHistory() calls don't all need updating by hand.
      function describeChange(prev, next) {
        if (!prev) return 'Start';
        const a = prev.length, b = next.length;
        if (b > a) return b - a === 1 ? `Added ${next[next.length - 1].name || 'object'}` : `Added ${b - a} objects`;
        if (b < a) return a - b === 1 ? 'Deleted object' : `Deleted ${a - b} objects`;
        return 'Edited';
      }

      // Render the live scene into a small square preview for the history list.
      // The WebGL canvas is created without preserveDrawingBuffer, so its pixels
      // are only readable immediately after a draw — we therefore grab the thumb
      // inside the render loop rather than straight away, and patch it into the
      // snapshot once it arrives.
      let _thumbWanted = null;   // the snapshot awaiting its preview
      let _thumbMarks = null;    // { added, removed } for that snapshot's glow
      function captureThumb() { return null; }
      // three.js assigns a fresh uuid on clone(), so snapshots can't be diffed by
      // uuid — every object would look both added and removed. We stamp our own id
      // into userData instead, which cloneUserData carries across faithfully.
      let _msIdSeq = 0;
      function stableId(obj) {
        if (!obj.userData) obj.userData = {};
        if (!obj.userData.msId) obj.userData.msId = 'ms' + (++_msIdSeq);
        return obj.userData.msId;
      }

      // Work out which objects appeared or vanished between two snapshots, so the
      // thumbnail can highlight them. Frame-diffing would be wrong here: orbiting
      // the camera changes every pixel without changing the model.
      function changedObjects(prev, next) {
        const key = o => (o.userData && o.userData.msId) || o.uuid;
        const prevIds = new Set((prev || []).map(key));
        const nextIds = new Set((next || []).map(key));
        const added = (next || []).filter(o => !prevIds.has(key(o)));
        const removed = (prev || []).filter(o => !nextIds.has(key(o)));
        return { added, removed };
      }


      // Ring the region an object occupies, so the history thumb shows at a glance
      // what this step added (green) or removed (red).
      // Trace the silhouette of the objects that changed, rather than boxing them.
      // We re-render just those objects to an offscreen target, read back which
      // pixels they cover, and outline that shape — so the highlight follows the
      // actual item (as the paint side's glow does) instead of drawing a rectangle
      // around empty space.
      function silhouetteMask(objs, S) {
        if (!objs || !objs.length || !renderer) return null;
        try {
          const rt = new THREE.WebGLRenderTarget(S, S);
          const stencil = new THREE.Scene();
          const flat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const clones = [];
          objs.forEach(o => {
            if (!o.geometry) return;
            const m = new THREE.Mesh(o.geometry, flat);
            m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
            stencil.add(m); clones.push(m);
          });
          if (!clones.length) { rt.dispose(); return null; }
          const prevTarget = renderer.getRenderTarget();
          const prevClear = renderer.getClearColor(new THREE.Color()).clone();
          const prevAlpha = renderer.getClearAlpha();
          renderer.setRenderTarget(rt);
          renderer.setClearColor(0x000000, 1);
          renderer.clear();
          renderer.render(stencil, camera);
          const buf = new Uint8Array(S * S * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
          renderer.setRenderTarget(prevTarget);
          renderer.setClearColor(prevClear, prevAlpha);
          rt.dispose(); flat.dispose();

          // readRenderTargetPixels gives bottom-up rows; flip to match the canvas
          const mask = new Uint8Array(S * S);
          let any = false;
          for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
              const src = ((S - 1 - y) * S + x) * 4;
              if (buf[src] > 40) { mask[y * S + x] = 1; any = true; }
            }
          }
          return any ? mask : null;
        } catch (e) { return null; }
      }

      // Outline a mask on the thumbnail, matching the paint side's change-glow look.
      function glowMask(g, mask, S, rgb) {
        const k = S / 40;
        const R = Math.max(1, Math.round(1.4 * k));
        const grown = new Uint8Array(S * S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if (!mask[y * S + x]) continue;
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy > R * R) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < S && ny < S) grown[ny * S + nx] = 1;
          }
        }
        const edge = [];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const p = y * S + x;
          if (!grown[p]) continue;
          const l = x > 0 && grown[p - 1], r = x < S - 1 && grown[p + 1];
          const u = y > 0 && grown[p - S], d = y < S - 1 && grown[p + S];
          if (!l || !r || !u || !d) edge.push(p);
        }
        if (!edge.length) return;
        const stamp = (colour, thick, alpha) => {
          const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
          const cx = cv.getContext('2d');
          const im = cx.createImageData(S, S);
          const put = (x, y) => {
            if (x < 0 || y < 0 || x >= S || y >= S) return;
            const i = (y * S + x) * 4;
            im.data[i] = colour[0]; im.data[i+1] = colour[1]; im.data[i+2] = colour[2]; im.data[i+3] = 255;
          };
          for (const p of edge) {
            const x = p % S, y = (p / S) | 0;
            put(x, y);
            if (thick) { put(x-1,y); put(x+1,y); put(x,y-1); put(x,y+1); }
          }
          cx.putImageData(im, 0, 0);
          g.save(); g.globalAlpha = alpha; g.drawImage(cv, 0, 0); g.restore();
        };
        stamp([8, 10, 14], true, 0.5);
        stamp(rgb, false, 1);
      }

      function grabThumbNow(marks) {
        try {
          if (!renderer) return null;
          const src = renderer.domElement;
          if (!src.width || !src.height) return null;
          const S = 48;
          const c = document.createElement('canvas');
          c.width = S; c.height = S;
          const g = c.getContext('2d');
          g.fillStyle = '#12161c'; g.fillRect(0, 0, S, S);
          const s = Math.min(src.width, src.height);
          g.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, S, S);
          if (marks) {
            // Added objects are still in the scene, so their silhouette can be
            // rendered. Removed ones are gone — fall back to projecting the
            // bounding box of the copy held in the previous snapshot.
            const addMask = silhouetteMask(marks.added, S);
            if (addMask) glowMask(g, addMask, S, [45, 212, 160]);
            const remMask = silhouetteMask(marks.removed, S);
            if (remMask) glowMask(g, remMask, S, [245, 101, 101]);
          }
          return c.toDataURL('image/png');
        } catch (e) { return null; }
      }
      // Called from the render loop right after renderer.render(), while the
      // drawing buffer still holds this frame. Tracks the snapshot by identity so
      // it stays correct even when the timeline shifts at its cap.
