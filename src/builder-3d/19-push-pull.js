      // ── Direct face push/pull ────────────────────────────────────────────
      // Finds every triangle connected to (and coplanar with) the clicked one,
      // so a face that's tessellated into many small triangles still reads as
      // one clickable face. Returns null if the geometry can't be read.
      function findCoplanarFaceTriangles(mesh, seedTriIndex) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const triCount = pos.count / 3;
        if (seedTriIndex >= triCount) return null;

        const triNormal = (t) => {
          const a = new THREE.Vector3().fromBufferAttribute(pos, t*3+0);
          const b = new THREE.Vector3().fromBufferAttribute(pos, t*3+1);
          const c = new THREE.Vector3().fromBufferAttribute(pos, t*3+2);
          return new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
        };
        const triVerts = (t) => [0,1,2].map(k => new THREE.Vector3().fromBufferAttribute(pos, t*3+k));

        const normal = triNormal(seedTriIndex);
        const seedV = triVerts(seedTriIndex);
        const planeConst = normal.dot(seedV[0]);
        const planeEps = 5e-3, normalEps = 0.999;

        const keyOf = (p) => `${p.x.toFixed(4)}_${p.y.toFixed(4)}_${p.z.toFixed(4)}`;
        const edgeKey = (a,b) => { const ka=keyOf(a), kb=keyOf(b); return ka<kb ? ka+'|'+kb : kb+'|'+ka; };
        const edgeToTris = new Map();
        for (let t = 0; t < triCount; t++) {
          const v = triVerts(t);
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(v[e], v[(e+1)%3]);
            if (!edgeToTris.has(k)) edgeToTris.set(k, []);
            edgeToTris.get(k).push(t);
          }
        }

        const isCoplanar = (t) => {
          if (triNormal(t).dot(normal) < normalEps) return false;
          return triVerts(t).every(v => Math.abs(normal.dot(v) - planeConst) < planeEps);
        };

        const included = new Set([seedTriIndex]);
        const queue = [seedTriIndex];
        while (queue.length) {
          const t = queue.pop();
          const v = triVerts(t);
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(v[e], v[(e+1)%3]);
            (edgeToTris.get(k) || []).forEach(t2 => {
              if (!included.has(t2) && isCoplanar(t2)) { included.add(t2); queue.push(t2); }
            });
          }
        }
        return { included, normal, triCount, point: seedV[0].clone(), planeConst };
      }

      function clearPushPullFaceHighlight() {
        pushPullFaceState.faces.forEach(f => { if (f.highlightMesh) scene.remove(f.highlightMesh); });
        pushPullFaceState.faces = [];
      }

      // Find a triangle on the mesh's current geometry lying on the given plane
      // (local normal + constant). Used to re-locate a picked face after the mesh
      // geometry was rebuilt by an earlier push/pull on the same object.
      function findSeedTriByPlane(mesh, planeNormal, planeConst) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const triCount = pos.count / 3;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < triCount; t++) {
          a.fromBufferAttribute(pos, t*3); b.fromBufferAttribute(pos, t*3+1); c.fromBufferAttribute(pos, t*3+2);
          const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
          if (n.dot(planeNormal) < 0.999) continue;
          if (Math.abs(n.dot(a) - planeConst) < 0.01) return t;
        }
        return -1;
      }

      function makeFaceHighlightMesh(mesh, found) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const positions = [];
        found.included.forEach(t => {
          for (let k = 0; k < 3; k++) {
            const v = new THREE.Vector3().fromBufferAttribute(pos, t*3+k).addScaledVector(found.normal, 0.05);
            positions.push(v.x, v.y, v.z);
          }
        });
        const hGeo = new THREE.BufferGeometry();
        hGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const hMat = new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.45, depthTest: true, side: THREE.DoubleSide });
        const hMesh = new THREE.Mesh(hGeo, hMat);
        hMesh.position.copy(mesh.position); hMesh.quaternion.copy(mesh.quaternion); hMesh.scale.copy(mesh.scale);
        hMesh.renderOrder = 999;
        scene.add(hMesh);
        return hMesh;
      }

      // Add a face to the push/pull selection (or toggle it off if already picked).
      // additive = keep existing picks (multi-select / shift); otherwise replace.
      function addPushPullFace(mesh, found, additive) {
        const seed = [...found.included][0];
        const existingIdx = pushPullFaceState.faces.findIndex(f => f.mesh === mesh && f.included && f.included.has(seed));
        if (existingIdx >= 0) {
          scene.remove(pushPullFaceState.faces[existingIdx].highlightMesh);
          pushPullFaceState.faces.splice(existingIdx, 1);
          return;
        }
        if (!additive) clearPushPullFaceHighlight();
        const highlightMesh = makeFaceHighlightMesh(mesh, found);
        // Record the face's local-space plane (normal + constant) so we can re-find
        // its triangles even after another face on the same mesh rebuilds geometry.
        pushPullFaceState.faces.push({
          mesh, triIndex: seed, included: found.included, highlightMesh,
          planeNormal: found.normal.clone(), planeConst: found.normal.dot(found.point || new THREE.Vector3())
        });
      }

      function handlePushPullFaceClick(e) {
        const selectable = objects.filter(o => o.visible && !o.userData.isSketch);
        const intersects = raycaster.intersectObjects(selectable, true);
        if (!intersects.length || intersects[0].faceIndex == null) {
          clearPushPullFaceHighlight();
          banner("⚠️ Click a flat face on a solid to select it.");
          return true;
        }
        let mesh = intersects[0].object;
        while (mesh.parent && mesh.parent !== scene && mesh.parent !== groupPivot && !mesh.userData.isSketch) mesh = mesh.parent;
        const found = findCoplanarFaceTriangles(mesh, intersects[0].faceIndex);
        if (!found) { banner("⚠️ Couldn't read that face."); return true; }
        const additive = multiSelectMode || (e && e.shiftKey);
        addPushPullFace(mesh, found, additive);
        selected = []; transformControl.detach();
        const n = pushPullFaceState.faces.length;
        banner(n === 0 ? "Face deselected."
          : n === 1 ? `Face selected — set direction & distance, then Apply. (Shift-click or multi-select to add more faces.)`
          : `${n} faces selected — set direction & distance, then Apply.`);
        return true;
      }

      // Extends (pull) or insets (push) a directly-picked face in place: moves
      // that coplanar patch of triangles along its own normal and stitches new
      // side walls to the rest of the (unchanged) solid, so the mesh stays
      // watertight. Vertex colours (if the object is painted) are carried over.
      function applyFacePushPull(mesh, seedTriIndex, depth) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        const colAttr = geo.attributes.color;
        const triCount = pos.count / 3;

        const readTri = (t) => {
          const v = [], c = [];
          for (let k = 0; k < 3; k++) {
            v.push(new THREE.Vector3().fromBufferAttribute(pos, t*3+k));
            c.push(colAttr ? new THREE.Vector3(colAttr.getX(t*3+k), colAttr.getY(t*3+k), colAttr.getZ(t*3+k)) : null);
          }
          return { v, c };
        };
        const allTris = []; for (let t = 0; t < triCount; t++) allTris.push(readTri(t));
        const triNormal = (tri) => new THREE.Vector3().crossVectors(tri.v[1].clone().sub(tri.v[0]), tri.v[2].clone().sub(tri.v[0])).normalize();

        const seed = allTris[seedTriIndex];
        const normal = triNormal(seed);
        const planeConst = normal.dot(seed.v[0]);
        const planeEps = 5e-3, normalEps = 0.999;

        const keyOf = (p) => `${p.x.toFixed(4)}_${p.y.toFixed(4)}_${p.z.toFixed(4)}`;
        const edgeKey = (a,b) => { const ka=keyOf(a), kb=keyOf(b); return ka<kb ? ka+'|'+kb : kb+'|'+ka; };
        const edgeToTris = new Map();
        allTris.forEach((tri, t) => {
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(tri.v[e], tri.v[(e+1)%3]);
            if (!edgeToTris.has(k)) edgeToTris.set(k, []);
            edgeToTris.get(k).push(t);
          }
        });
        const isCoplanar = (t) => {
          if (triNormal(allTris[t]).dot(normal) < normalEps) return false;
          return allTris[t].v.every(v => Math.abs(normal.dot(v) - planeConst) < planeEps);
        };
        const included = new Set([seedTriIndex]);
        const queue = [seedTriIndex];
        while (queue.length) {
          const t = queue.pop();
          const tri = allTris[t];
          for (let e = 0; e < 3; e++) {
            const k = edgeKey(tri.v[e], tri.v[(e+1)%3]);
            (edgeToTris.get(k) || []).forEach(t2 => {
              if (!included.has(t2) && isCoplanar(t2)) { included.add(t2); queue.push(t2); }
            });
          }
        }

        const moveVec = normal.clone().multiplyScalar(depth);

        // Boundary edges of the patch: an edge with only one incident triangle
        // from WITHIN the patch borders the rest of the solid.
        const patchEdgeCount = new Map();
        included.forEach(t => {
          const tri = allTris[t];
          for (let e = 0; e < 3; e++) patchEdgeCount.set(edgeKey(tri.v[e], tri.v[(e+1)%3]), (patchEdgeCount.get(edgeKey(tri.v[e], tri.v[(e+1)%3]))||0) + 1);
        });
        const boundaryEdges = [];
        included.forEach(t => {
          const tri = allTris[t];
          for (let e = 0; e < 3; e++) {
            const a = tri.v[e], b = tri.v[(e+1)%3];
            if (patchEdgeCount.get(edgeKey(a,b)) === 1) boundaryEdges.push({ a, b, ca: tri.c[e], cb: tri.c[(e+1)%3] });
          }
        });

        const centroid = new THREE.Vector3(); let ncount = 0;
        included.forEach(t => allTris[t].v.forEach(v => { centroid.add(v); ncount++; }));
        centroid.multiplyScalar(1 / Math.max(1, ncount));

        const hasColor = !!colAttr;
        const outPos = [], outCol = [];
        const pushTri = (a,b,c, ca,cb,cc) => {
          [a,b,c].forEach(v => outPos.push(v.x, v.y, v.z));
          if (hasColor) [ca,cb,cc].forEach(cv => outCol.push(cv?cv.x:1, cv?cv.y:1, cv?cv.z:1));
        };

        allTris.forEach((tri, t) => { if (!included.has(t)) pushTri(tri.v[0], tri.v[1], tri.v[2], tri.c[0], tri.c[1], tri.c[2]); });
        included.forEach(t => {
          const tri = allTris[t];
          const mv = tri.v.map(v => v.clone().add(moveVec));
          pushTri(mv[0], mv[1], mv[2], tri.c[0], tri.c[1], tri.c[2]);
        });
        boundaryEdges.forEach(({a,b,ca,cb}) => {
          const a2 = a.clone().add(moveVec), b2 = b.clone().add(moveVec);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const hint = new THREE.Vector3().crossVectors(normal, b.clone().sub(a));
          if (hint.lengthSq() < 1e-10) return;
          hint.normalize();
          if (hint.dot(mid.clone().sub(centroid)) < 0) hint.negate();
          const n2 = new THREE.Vector3().crossVectors(b.clone().sub(a), b2.clone().sub(a));
          if (n2.dot(hint) < 0) { pushTri(a, a2, b2, ca, ca, cb); pushTri(a, b2, b, ca, cb, cb); }
          else { pushTri(a, b, b2, ca, cb, cb); pushTri(a, b2, a2, ca, cb, ca); }
        });

        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
        if (hasColor) newGeo.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
        newGeo.computeVertexNormals();

        mesh.geometry.dispose();
        mesh.geometry = newGeo;
        mesh.geometry.computeBoundingBox();
        return { faceTriCount: included.size, boundaryCount: boundaryEdges.length };
      }

      function extrudeSelectedSketch() {


        if(selected.length === 0 || !selected[0].userData.isSketch) return banner("⚠️ Select a sketch layer from the list first.");
        const sketchGrp = selected[0];
        const depth = Math.abs(parseFloat(document.getElementById('bld-exh').value) || 15);
        const shapes = sketchGrp.userData.shapes;

        // Full world transform of the sketch plane (bake-time projection composed
        // with any recenter + move the user applied to the layer since).
        const tf = sketchWorldMatrix(sketchGrp);

        // Push in = extrude along the plane's -normal; pull out = along +normal.
        // ExtrudeGeometry always extrudes toward +Z, so for "push" we negate Z
        // before applying the plane transform.
        const dirMatrix = new THREE.Matrix4();
        if (pushDir === 'push') dirMatrix.makeScale(1, 1, -1);

        const baseMat = new THREE.MeshStandardMaterial({color: 0x3d8ef5, roughness: 0.4});

        shapes.forEach(sh => {
          let geo = new THREE.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: false, steps: 1 });
          // Keep the extrusion's clean flat faces (straight edges, no chopped-up
          // triangles). The sculpt brush densifies on demand now, so there's no need
          // to pre-tessellate here — that was what left tiny triangles on the walls.
          geo = makeGeometryCSGReady(geo);

          // Apply direction flip, then bake the plane transform into the vertices so
          // they sit at true WORLD positions; recenter with identity mesh rotation so
          // the solid behaves like a primitive under the move/scale gizmo.
          geo.applyMatrix4(dirMatrix);
          geo.applyMatrix4(tf);
          geo.computeBoundingBox();
          const center = new THREE.Vector3();
          geo.boundingBox.getCenter(center);
          geo.translate(-center.x, -center.y, -center.z);

          const mesh = new THREE.Mesh(geo, baseMat.clone());
          mesh.position.copy(center);
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.updateMatrixWorld(true);
          scene.add(mesh); objects.push(mesh);
        });

        sketchGrp.visible = false;
        selected = []; transformControl.detach();
        saveHistory(); updateStatus();
        banner(`${pushDir === 'push' ? 'Pushed in' : 'Pulled out'} ${shapes.length} profile(s) by ${depth} mm.`);
      }

      function updateLayersUI() {
        const list = document.getElementById('layers-list');
        list.innerHTML = '';
        const sketches = objects.filter(o => o.userData.isSketch);
        
        if (sketches.length === 0) {
          list.innerHTML = `<div class="empty-note">No sketches baked yet.</div>`;
          return;
        }

        const layerIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/></svg>`;
        const eyeOn = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
        const eyeOff = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-1.7 2.5M6.6 6.6A13 13 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/></svg>`;
        const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>`;
        const trashIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;

        sketches.forEach((sk) => {
          const div = document.createElement('div');
          div.className = `layer-item ${selected.includes(sk) ? 'active' : ''}`;
          div.innerHTML = `
            <span class="layer-name">${layerIcon}${sk.name || 'Sketch'}</span>
            <div class="layer-actions">
              <span class="layer-action edit-btn" title="Edit sketch">${editIcon}</span>
              <span class="layer-action vis-toggle" title="Toggle visibility">${sk.visible ? eyeOn : eyeOff}</span>
              <span class="layer-action del-btn" title="Delete layer">${trashIcon}</span>
            </div>
          `;
          
          div.querySelector('.layer-name').onclick = () => {
            clearPushPullFaceHighlight();
            selectOnly(sk);
          };

          div.querySelector('.edit-btn').onclick = (e) => {
            e.stopPropagation();
            editBakedSketch(sk);
          };

          div.querySelector('.vis-toggle').onclick = (e) => {
            e.stopPropagation();
            sk.visible = !sk.visible;
            updateStatus(); 
          };

          div.querySelector('.del-btn').onclick = (e) => {
            e.stopPropagation();
            scene.remove(sk);
            objects = objects.filter(o => o !== sk);
            if(selected.includes(sk)) { selected = []; transformControl.detach(); }
            saveHistory(); updateStatus();
          };
          list.appendChild(div);
        });
      }

      // Rebuilds the build-plate grid at a new size (GridHelper's size is baked
      // into its geometry at construction, so growing it means replacing it).
      function rebuildGrid(size) {
        const divisions = Math.max(10, Math.round(size / 10));
        scene.remove(grid);
        grid.geometry.dispose(); grid.material.dispose();
        grid = new THREE.GridHelper(size, divisions, 0xc2895f, 0x262b34);
        grid.rotation.x = Math.PI / 2;
        grid.material.opacity = 0.5; grid.material.transparent = true;
        scene.add(grid);
        currentGridSize = size;
      }

      // Checks the current model's footprint against the build plate and grows
      // the plate (never shrinks it, to avoid distracting resize "thrashing"
      // while editing) if something now extends past its edge.
      function updateGridExtent() {
        const box = new THREE.Box3();
        let any = false;
        objects.forEach(o => { if (o.visible && !o.userData.isSketch) { box.expandByObject(o); any = true; } });
        if (!any || !isFinite(box.min.x)) return;
        const spanX = box.max.x - box.min.x;
        const spanY = box.max.y - box.min.y; // Y is the other horizontal axis (Z is vertical)
        const neededSpan = Math.max(spanX, spanY) * 1.6; // margin so the plate clearly reads bigger than the model
        const targetSize = Math.max(300, Math.ceil(neededSpan / 50) * 50);
        if (targetSize > currentGridSize) rebuildGrid(targetSize);
      }

