      // ── Object browser ──────────────────────────────────────────────────────
      // Renders each top-level object on its own so you can see what's in the
      // scene. Thumbnails are drawn once into a shared offscreen renderer and
      // cached against the object's geometry, so a scene of 30 parts doesn't cost
      // 30 live renderers — that would be the obvious way to do this and it would
      // bring a tablet to a halt.
      let _obRenderer = null, _obScene = null, _obCam = null;
      const _obCache = new Map();          // uuid -> { url, key }

      function obEnsureRenderer() {
        if (_obRenderer) return true;
        try {
          _obRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
          _obRenderer.setSize(128, 128);
          _obScene = new THREE.Scene();
          _obCam = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
          const key = new THREE.DirectionalLight(0xffffff, 0.95);
          key.position.set(3, -4, 6);
          const fill = new THREE.DirectionalLight(0xffffff, 0.35);
          fill.position.set(-4, 3, 2);
          _obScene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));
          return true;
        } catch (e) { _obRenderer = null; return false; }
      }

      // A cheap signature that changes whenever the look of an object changes, so
      // cached thumbnails refresh when they should and not otherwise.
      function obKey(o) {
        let tris = 0, mat = '';
        o.traverse(c => {
          if (c.isMesh && c.geometry && c.geometry.attributes.position) {
            tris += c.geometry.attributes.position.count;
            if (!mat && c.material && c.material.color) mat = c.material.color.getHexString();
          }
        });
        return tris + '|' + mat + '|' + (o.userData.name || o.name || '');
      }

      function obThumb(o) {
        const cached = _obCache.get(o.uuid);
        const key = obKey(o);
        if (cached && cached.key === key) return cached.url;
        if (!obEnsureRenderer()) return null;
        // Clone so the live scene is never disturbed by the framing we do here.
        let clone;
        try { clone = o.clone(true); } catch (e) { return null; }
        clone.position.set(0, 0, 0);
        clone.rotation.set(0, 0, 0);
        clone.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(clone);
        if (box.isEmpty()) return null;
        const c = box.getCenter(new THREE.Vector3());
        const r = box.getSize(new THREE.Vector3()).length() * 0.5 || 1;
        clone.position.sub(c);
        _obScene.add(clone);
        const d = r / Math.tan((35 * Math.PI / 180) / 2) * 1.25;
        _obCam.position.set(d * 0.62, -d * 0.72, d * 0.55);
        _obCam.up.set(0, 0, 1);
        _obCam.lookAt(0, 0, 0);
        _obCam.near = Math.max(0.01, d - r * 4); _obCam.far = d + r * 6;
        _obCam.updateProjectionMatrix();
        let url = null;
        try {
          _obRenderer.render(_obScene, _obCam);
          url = _obRenderer.domElement.toDataURL('image/png');
        } catch (e) { url = null; }
        _obScene.remove(clone);
        if (url) _obCache.set(o.uuid, { url, key });
        return url;
      }

      // Most objects carry no name, so derive something readable from what they
      // are. A tile labelled "Object" three times over is no more use than no
      // label at all.
      function obLabel(o, kids) {
        if (o.userData && o.userData.name) return o.userData.name;
        if (o.name) return o.name;
        if (kids > 1) return 'Group (' + kids + ')';
        let type = '';
        o.traverse(c => { if (!type && c.isMesh && c.geometry) type = c.geometry.type || ''; });
        const map = {
          BoxGeometry: 'Cube', SphereGeometry: 'Sphere', CylinderGeometry: 'Cylinder',
          ConeGeometry: 'Cone', TorusGeometry: 'Torus', TextGeometry: 'Text',
          ExtrudeGeometry: 'Extrusion', LatheGeometry: 'Revolve', PlaneGeometry: 'Plane'
        };
        if (map[type]) return map[type];
        // Anything booleaned or edited becomes a plain BufferGeometry, so fall
        // back to its size, which at least distinguishes one part from another.
        try {
          const b = new THREE.Box3().setFromObject(o);
          const s = b.getSize(new THREE.Vector3());
          return Math.round(s.x) + '\u00d7' + Math.round(s.y) + '\u00d7' + Math.round(s.z) + ' mm';
        } catch (e) { return 'Object'; }
      }

      function renderObjectBrowser() {
        const grid = document.getElementById('ob-grid');
        if (!grid) return;
        const list = objects.filter(o => o && !o.userData.isSketch);
        const cnt = document.getElementById('ob-count');
        if (cnt) cnt.textContent = list.length ? String(list.length) : '';
        grid.innerHTML = '';
        if (!list.length) {
          const e = document.createElement('div');
          e.className = 'ob-empty';
          e.textContent = 'Nothing in the scene yet.';
          grid.appendChild(e);
          return;
        }
        list.forEach(o => {
          // A div rather than a button: the rename field sits inside the tile, and
          // pressing space inside an input nested in a <button> activates the
          // button and steals focus — which committed the name early, turning
          // "Heel wedge" into "Heel".
          const t = document.createElement('div');
          t.setAttribute('role', 'button');
          t.tabIndex = 0;
          t.className = 'ob-tile' + (selected.includes(o) ? ' sel' : '') + (o.visible === false ? ' ob-hidden' : '');
          const url = obThumb(o);
          if (url) {
            const img = document.createElement('img');
            img.src = url; img.alt = '';
            img.style.cssText = 'width:100%; height:100%; display:block; object-fit:cover;';
            t.appendChild(img);
          }
          // Groups select as one thing, so they read as one tile — the badge says
          // how many parts are inside.
          let kids = 0;
          if (o.type === 'Group' || (o.children && o.children.some(c => c.isMesh))) {
            o.traverse(c => { if (c.isMesh) kids++; });
          }
          if (kids > 1) {
            const b = document.createElement('span');
            b.className = 'ob-badge'; b.textContent = kids;
            t.appendChild(b);
          }
          const nm = document.createElement('span');
          nm.className = 'ob-name';
          nm.textContent = obLabel(o, kids);
          t.appendChild(nm);
          t.title = nm.textContent + ' — click the name to rename';
          // Click the name to rename, the way Finder and Explorer do. The first
          // click on a tile selects it; clicking the name after that renames,
          // so selecting never accidentally starts an edit.
          nm.onclick = (ev) => {
            if (!selected.includes(o)) return;      // let the tile handle selection
            ev.stopPropagation();
            msInlineRename(nm, o.userData.name || o.name || '', (v) => {
              o.userData.name = v;
              renderObjectBrowser(); updateStatus(); saveHistory();
            }, () => renderObjectBrowser());
          };
          t.onclick = (e) => {
            if (e.shiftKey || multiSelectMode) {
              const i = selected.indexOf(o);
              if (i >= 0) selected.splice(i, 1); else selected.push(o);
            } else selected = [o];
            refreshSelectionVisual(); attachGizmoToSelection();
            updateStatus(); updateFloatingHUD(); renderObjectBrowser();
            if (window.invalidate3D) invalidate3D();
          };
          t.ondblclick = () => {
            selected = [o];
            refreshSelectionVisual(); attachGizmoToSelection();
            const b = document.getElementById('bld-frame-sel'); if (b) b.click();
            renderObjectBrowser();
          };
          grid.appendChild(t);
        });
      }
      window.renderObjectBrowser = renderObjectBrowser;

      function serviceThumbQueue() {
        if (!_thumbWanted) return;
        const snap = _thumbWanted; _thumbWanted = null;
        const marks = _thumbMarks; _thumbMarks = null;
        snap.thumb = grabThumbNow(marks);
        renderHistoryPanel();
      }

      function triggerUndo() {
        if (currentMode === 'sketching') { sketchUndo(); return; }
        if (historyIndex > 0) {
          historyIndex--; restoreStateFromSnapshot(historyTimeline[historyIndex]); banner("Undo");
          renderHistoryPanel();
        } else banner("Nothing to undo.");
      }

      function triggerRedo() {
        if (currentMode === 'sketching') { sketchRedo(); return; }
        if (historyIndex < historyTimeline.length - 1) {
          historyIndex++; restoreStateFromSnapshot(historyTimeline[historyIndex]); banner("Redo");
          renderHistoryPanel();
        } else banner("Nothing to redo.");
      }

      // Jump straight to any point in the timeline. Stepping back doesn't discard
      // anything — the later steps stay available until you make a new edit, which
      // is what replaces them.
      function jumpToHistory(i) {
        if (i < 0 || i >= historyTimeline.length || i === historyIndex) return;
        historyIndex = i;
        restoreStateFromSnapshot(historyTimeline[i]);
        renderHistoryPanel();
        banner(historyTimeline[i].label || 'Jumped');
      }

      // ── Edit actions (shared by toolbar buttons and keyboard shortcuts) ──
      function deleteSelected() {
        if (!selected.length) { banner("Nothing selected to delete."); return; }
        detachGroupPivot();
        const n = selected.length;
        selected.forEach(s => scene.remove(s));
        objects = objects.filter(o => !selected.includes(o));
        selected = []; transformControl.detach();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(n > 1 ? `Deleted ${n} objects.` : "Deleted.");
      }

      // Drop each selected solid straight down (along the build-plate's vertical
      // axis) so its lowest point rests exactly on the plate — like letting go
      // of it and having gravity settle it flat. Each object settles on its own;
      // horizontal position is untouched.
      function settleSelected() {
        const targets = selected.filter(o => !o.userData.isSketch);
        if (!targets.length) return banner("⚠️ Select one or more solids to settle onto the build plate.");
        targets.forEach(obj => {
          const box = new THREE.Box3().setFromObject(obj);
          if (!isFinite(box.min.z)) return;
          obj.position.z -= box.min.z;
        });
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(targets.length > 1 ? `Settled ${targets.length} objects onto the build plate.` : "Settled onto the build plate.");
      }

      // Centres the selection on the build plate (X0, Y0) and settles it.
      // A multi-object selection or a group is treated as ONE unit for the X/Y
      // move — the combined bounding box straddles the origin, so objects keep
      // their positions relative to each other rather than collapsing onto one
      // point. Settling afterwards stays per-object, matching settleSelected()
      // above, so each part still rests flush on the plate rather than being
      // offset by whichever object happens to be tallest.
      function centreSelected() {
        const targets = selected.filter(o => !o.userData.isSketch);
        if (!targets.length) return banner("⚠️ Select one or more objects to centre on the plate.");
        const box = new THREE.Box3();
        targets.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
        if (!isFinite(box.min.x)) return;
        const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
        targets.forEach(o => { o.position.x -= cx; o.position.y -= cy; });
        targets.forEach(o => {
          const b = new THREE.Box3().setFromObject(o);
          if (isFinite(b.min.z)) o.position.z -= b.min.z;
        });
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(targets.length > 1 ? `Centred ${targets.length} objects on the plate.` : "Centred on the plate.");
      }

      function cloneObject(src, offset = 25) {
        const c = src.clone();
        if (src.geometry) c.geometry = src.geometry.clone();
        if (src.material) c.material = Array.isArray(src.material) ? src.material.map(m => m.clone()) : src.material.clone();
        c.position.x += offset;
        c.userData = cloneUserData(src.userData || {});
        return c;
      }

      // ── Group / Ungroup / Merge ─────────────────────────────────────────────
      // Group: bundle the selected objects under one container so they move, copy
      // and delete as a single unit (reversible). Ungroup: dissolve it back into
      // its members. Merge: fuse selected solids into one mesh via boolean union
      // (not reversible except by undo).
      function groupSelected() {
        if (selected.length < 2) { banner("Select two or more objects to group."); return; }
        detachGroupPivot();

        const grp = new THREE.Group();
        grp.userData.isGroup = true;
        grp.name = "Group " + (objects.filter(o => o.userData.isGroup).length + 1);

        // Centre the group on the members so its gizmo pivot is sensible.
        const box = new THREE.Box3();
        selected.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
        const centre = new THREE.Vector3(); box.getCenter(centre);
        grp.position.copy(centre);
        scene.add(grp); grp.updateMatrixWorld(true);

        const members = [...selected];
        members.forEach(o => {
          attachKeepWorld(o, grp);
          objects = objects.filter(x => x !== o);   // members live inside the group now
        });
        objects.push(grp);

        selectOnly(grp);
        saveHistory(); updateStatus();
        banner(`Grouped ${members.length} objects.`);
      }

      // Ungroup does two things: it dissolves a group into its members, and it
      // splits a single mesh that is really several loose, non-touching pieces
      // (typical of an imported OBJ/3MF/STL scan or assembly) into one object per
      // piece, each keeping its place in the scene.
      function ungroupSelected() {
        const groups = selected.filter(o => o.userData.isGroup);
        const meshes = selected.filter(o => !o.userData.isGroup && !o.userData.isSketch &&
          o.geometry && o.geometry.attributes && o.geometry.attributes.position);
        if (groups.length === 0 && meshes.length === 0) {
          banner("Select a group to ungroup, or a model made of separate parts to split.");
          return;
        }
        detachGroupPivot();

        let freed = [];
        groups.forEach(grp => {
          [...grp.children].forEach(child => {
            attachKeepWorld(child, scene);
            objects.push(child);
            freed.push(child);
          });
          scene.remove(grp);
          objects = objects.filter(o => o !== grp);
        });
        const dissolved = freed.length;

        // Loose parts. Largest piece first so "part 1" is the main body.
        let split = 0, tooMany = 0;
        const MAX_PARTS = 500;
        meshes.forEach(m => {
          let parts = null;
          try { parts = splitDisconnectedShells(m, true); } catch (e) { parts = null; }
          if (!parts) return;
          if (parts.length > MAX_PARTS) { tooMany = parts.length; return; }
          const tris = (p) => p.geometry.attributes.position.count;
          parts.sort((a, b) => tris(b) - tris(a));
          const base = (m.userData && m.userData.name) || m.name || '';
          scene.remove(m);
          objects = objects.filter(o => o !== m);
          parts.forEach((p, i) => {
            p.userData.name = base ? base + ' \u2013 part ' + (i + 1) : 'Part ' + (i + 1);
            scene.add(p); p.updateMatrixWorld(true);
            objects.push(p);
            freed.push(p);
          });
          split += parts.length;
        });

        if (!freed.length) {
          banner(tooMany
            ? `\u26a0\ufe0f That model has ${tooMany} loose pieces \u2014 too many to split into separate objects (limit ${MAX_PARTS}).`
            : "Nothing to ungroup \u2014 it's one connected piece.");
          return;
        }

        selected = freed;
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(split && !dissolved ? `Split into ${split} separate parts.`
             : split ? `Ungrouped and split into ${freed.length} objects.`
             : `Ungrouped into ${freed.length} objects.`);
      }

      // Fuse all selected solids into a single mesh (chained boolean union).
      function mergeSelected() {
        const solids = selected.filter(o => !o.userData.isSketch && !o.userData.isGroup && o.geometry);
        if (solids.length < 2) { banner("Select two or more solids to merge."); return; }
        detachGroupPivot();
        banner("Merging solids…");

        setTimeout(() => {
          try {
            const CSG = window.CSGEngine;
            let acc = CSG.fromMesh(solids[0]);
            for (let i = 1; i < solids.length; i++) {
              acc = acc.union(CSG.fromMesh(solids[i]));
            }
            const merged = csgToRecenteredMesh(acc, solids[0].material.clone());
            merged.castShadow = true; merged.receiveShadow = true;

            solids.forEach(s => { scene.remove(s); });
            objects = objects.filter(o => !solids.includes(o));
            scene.add(merged); objects.push(merged);

            selectOnly(merged);
            saveHistory(); updateStatus(); updateFloatingHUD();
            banner(`Merged ${solids.length} solids into one.`);
          } catch (err) {
            console.error(err); banner("⚠️ Merge failed — try nudging the solids so they overlap, or merge fewer at once.");
          }
        }, 30);
      }

      function duplicateSelected() {
        if (!selected.length) { banner("Nothing selected to duplicate."); return; }
        detachGroupPivot();
        const copies = selected.map(s => cloneObject(s, 25));
        objects.forEach(o => setEmissive(o, 0x000000));
        copies.forEach(c => { scene.add(c); objects.push(c); });
        selected = copies;
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(copies.length > 1 ? `Duplicated ${copies.length} objects.` : "Duplicated.");
      }

      let mirrorKeepOriginal = false;

      // Mirror an object's geometry across a plane through its own centre, along the
      // given world axis. We flip that coordinate of every vertex and reverse the
      // triangle winding so faces still point outward (otherwise the solid renders
      // inside-out). With "keep original" on, a mirrored copy is added alongside.
      function mirrorGeometryInPlace(mesh, axis) {
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        const pos = g.attributes.position;
        const arr = pos.array;
        const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        // flip the axis coordinate on every vertex
        for (let i = 0; i < pos.count; i++) arr[i*3 + ai] = -arr[i*3 + ai];
        // reverse winding per triangle (swap vertices 2 and 3) so faces stay outward
        for (let i = 0; i < pos.count; i += 3) {
          for (let k = 0; k < 3; k++) {
            const a = (i+1)*3 + k, b = (i+2)*3 + k;
            const tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
          }
        }
        pos.needsUpdate = true;
        // carry vertex colours if present (swap the same way)
        if (g.attributes.color) {
          const col = g.attributes.color.array;
          for (let i = 0; i < pos.count; i += 3) {
            for (let k = 0; k < 3; k++) {
              const a = (i+1)*3 + k, b = (i+2)*3 + k;
              const tmp = col[a]; col[a] = col[b]; col[b] = tmp;
            }
          }
          g.attributes.color.needsUpdate = true;
        }
        g.computeVertexNormals();
        mesh.geometry.dispose();
        mesh.geometry = g;
      }

      function mirrorSelected(axis) {
        const targets = selected.filter(o => o.geometry && !o.userData.isSketch);
        if (!targets.length) { banner("Select a solid to mirror."); return; }
        detachGroupPivot();

        if (mirrorKeepOriginal) {
          // Add mirrored copies, keep originals; mirror the copy's local geometry and
          // reflect its position across the selection's centre on that axis.
          const centre = new THREE.Vector3();
          const box = new THREE.Box3(); targets.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o); });
          box.getCenter(centre);
          const ai = axis === 'x' ? 'x' : axis === 'y' ? 'y' : 'z';
          const copies = targets.map(s => {
            const c = cloneObject(s, 0);
            mirrorGeometryInPlace(c, axis);
            c.position[ai] = 2 * centre[ai] - s.position[ai];  // reflect position across centre
            return c;
          });
          objects.forEach(o => setEmissive(o, 0x000000));
          copies.forEach(c => { scene.add(c); objects.push(c); });
          selected = copies;
        } else {
          targets.forEach(s => mirrorGeometryInPlace(s, axis));
        }
        refreshSelectionVisual();
        attachGizmoToSelection();
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(mirrorKeepOriginal ? `Added mirrored copy across ${axis.toUpperCase()}.` : `Mirrored across ${axis.toUpperCase()}.`);
      }

