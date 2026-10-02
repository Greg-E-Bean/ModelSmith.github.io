      // ── Fillet / edge rounding ──────────────────────────────────────────
      // Welds a soup into unique vertices + triangle indices so we can reason
      // about which vertices share an edge/corner.
      function weldGeometry(geometry, precision = 4) {
        const pos = geometry.toNonIndexed().attributes.position;
        const map = new Map(); const unique = []; const indices = [];
        const key = (x,y,z)=>`${x.toFixed(precision)}_${y.toFixed(precision)}_${z.toFixed(precision)}`;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const k = key(x,y,z);
          let id = map.get(k);
          if (id === undefined) { id = unique.length; unique.push(new THREE.Vector3(x,y,z)); map.set(k, id); }
          indices.push(id);
        }
        return { verts: unique, indices };
      }

      // Rounds sharp edges of the selected solid by subdividing then running a few
      // constrained smoothing passes weighted toward high-curvature (edge/corner)
      // vertices, so flat faces stay flat and only the sharp transitions soften.
      // ═══════════════════════════════════════════════════════════════════════
      //   SELECTIVE EDGE FILLET (box / extrusion solids)
      //   Detect feature edges → let the user pick some → replace each picked edge
      //   with a real tangent arc of the chosen radius (not a global smooth).
      // ═══════════════════════════════════════════════════════════════════════

      const V3 = () => new THREE.Vector3();
      function keyOfPoint(p, prec = 3) {
        return `${p.x.toFixed(prec)}_${p.y.toFixed(prec)}_${p.z.toFixed(prec)}`;
      }

      // Weld near-identical points to a single representative.
      //
      // Slicing and booleans compute the same physical corner via two different
      // interpolations, so the results can differ by a few nanometres. Plain
      // rounding (keyOfPoint) then puts them in different buckets whenever they
      // straddle a rounding boundary — 4.999501 and 4.999499 are 2e-6 apart but
      // round to "5.000" and "4.999". Edge matching would then see one face per
      // edge instead of two and silently drop it, which is why "slice then fillet"
      // lost edges and cut faces developed gaps.
      //
      // This checks the 27 neighbouring cells around a point, so a match is found
      // regardless of which side of a boundary each copy landed on.
      function makeWelder(tol = 1e-3) {
        const cells = new Map();
        const cs = tol * 2;                       // cell size
        const ci = (v) => Math.floor(v / cs);
        return function weld(p) {
          const x = ci(p.x), y = ci(p.y), z = ci(p.z);
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dz = -1; dz <= 1; dz++) {
                const bucket = cells.get(`${x+dx}_${y+dy}_${z+dz}`);
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                  if (bucket[i].distanceToSquared(p) <= tol * tol) return bucket[i];
                }
              }
          const k = `${x}_${y}_${z}`;
          if (!cells.has(k)) cells.set(k, []);
          const rep = p.clone();
          cells.get(k).push(rep);
          return rep;                             // first occurrence becomes the representative
        };
      }

      // Build the list of feature edges of a mesh: edges shared by exactly two
      // triangles whose face normals differ by more than ~20° (a real model edge,
      // not a seam inside a flat face). Coplanar neighbours are ignored.
      function detectFeatureEdges(mesh) {
        mesh.updateMatrixWorld(true);
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = g.attributes.position;
        const m = mesh.matrixWorld;

        // Map each undirected edge → list of {faceNormal, triIndex}
        // Points are welded first so that vertices which should be identical but
        // differ by a hair (slice/boolean output) still land on the same edge key.
        const weld = makeWelder(1e-3);
        const edgeMap = new Map();
        const addEdge = (pa, pb, n, tri, pc) => {
          const wa = weld(pa), wb = weld(pb);
          const ka = keyOfPoint(wa), kb = keyOfPoint(wb);
          if (ka === kb) return;                 // degenerate (zero-length) edge
          const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          if (!edgeMap.has(key)) edgeMap.set(key, { a: wa.clone(), b: wb.clone(), faces: [] });
          edgeMap.get(key).faces.push({ n: n.clone(), tri, c: pc });
        };

        for (let i = 0; i < pos.count; i += 3) {
          const p0 = V3().fromBufferAttribute(pos, i).applyMatrix4(m);
          const p1 = V3().fromBufferAttribute(pos, i+1).applyMatrix4(m);
          const p2 = V3().fromBufferAttribute(pos, i+2).applyMatrix4(m);
          const n = V3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0)).normalize();
          addEdge(p0, p1, n, i/3, p2); addEdge(p1, p2, n, i/3, p0); addEdge(p2, p0, n, i/3, p1);
        }

        // Keep edges with a sharp dihedral angle between adjacent faces. We accept
        // edges shared by 2 OR MORE faces: slicing and booleans produce T-junctions
        // where a cut edge is touched by extra triangles, so requiring exactly 2
        // faces (as before) silently dropped those edges and made "slice then fillet"
        // fail. Taking the sharpest face pair at each edge recovers them.
        const raw = [];
        edgeMap.forEach(e => {
          if (e.faces.length < 2) return;
          // find the pair of faces with the largest dihedral angle
          let bestAngle = 0, bn1 = null, bn2 = null, bc1 = null, bc2 = null;
          for (let i = 0; i < e.faces.length; i++) {
            for (let j = i + 1; j < e.faces.length; j++) {
              const dot = Math.max(-1, Math.min(1, e.faces[i].n.dot(e.faces[j].n)));
              const ang = Math.acos(dot) * 180 / Math.PI;
              if (ang > bestAngle) { bestAngle = ang; bn1 = e.faces[i].n; bn2 = e.faces[j].n; bc1 = e.faces[i].c; bc2 = e.faces[j].c; }
            }
          }
          if (bestAngle > 20) raw.push({ a: e.a, b: e.b, n1: bn1, n2: bn2, c1: bc1, c2: bc2, ang: bestAngle });
        });

        return mergeCollinearEdges(raw);
      }

      // Chain raw edge fragments that are collinear and connected into single edges,
      // so clicking selects a whole box edge rather than one tessellated slice of it.
      function mergeCollinearEdges(raw) {
        const used = new Array(raw.length).fill(false);
        const merged = [];
        const dirOf = (e) => e.b.clone().sub(e.a).normalize();

        for (let i = 0; i < raw.length; i++) {
          if (used[i]) continue;
          used[i] = true;
          let chain = { a: raw[i].a.clone(), b: raw[i].b.clone(), n1: raw[i].n1, n2: raw[i].n2, c1: raw[i].c1, c2: raw[i].c2, ang: raw[i].ang };
          let d = dirOf(raw[i]);
          let extended = true;
          while (extended) {
            extended = false;
            for (let j = 0; j < raw.length; j++) {
              if (used[j]) continue;
              const dj = dirOf(raw[j]);
              if (Math.abs(Math.abs(d.dot(dj)) - 1) > 1e-3) continue; // not parallel
              // connects to either end, collinearly?
              const eps = 1e-3;
              if (raw[j].a.distanceTo(chain.b) < eps) { chain.b = raw[j].b.clone(); used[j]=true; extended=true; }
              else if (raw[j].b.distanceTo(chain.b) < eps) { chain.b = raw[j].a.clone(); used[j]=true; extended=true; }
              else if (raw[j].b.distanceTo(chain.a) < eps) { chain.a = raw[j].a.clone(); used[j]=true; extended=true; }
              else if (raw[j].a.distanceTo(chain.a) < eps) { chain.a = raw[j].b.clone(); used[j]=true; extended=true; }
            }
          }
          chain.mid = chain.a.clone().add(chain.b).multiplyScalar(0.5);
          chain.len = chain.a.distanceTo(chain.b);
          merged.push(chain);
        }
        return merged;
      }

      // Enter edge-pick mode for the selected solid: detect edges and draw them faint.
      function beginFilletEdgePicking() {
        clearFilletHighlights();
        if (selected.length === 0 || selected[0].userData.isSketch || !selected[0].geometry) {
          document.getElementById('fillet-hint').textContent = 'Select a solid first, then click its edges.';
          return;
        }
        const mesh = selected[0];
        filletState.mesh = mesh;
        filletState.edges = detectFeatureEdges(mesh);
        filletState.picked = new Set();
        filletState.hovered = -1; filletState.hoverSet = null; filletState._adj = null;

        if (!filletState.lineGroup) {
          filletState.lineGroup = new THREE.Group();
          scene.add(filletState.lineGroup);
          filletState.baseMat  = new THREE.LineBasicMaterial({ color: 0x8092aa, transparent: true, opacity: 0.75, depthTest: false });
          // Picked / hovered edges are drawn as solid tubes (below), so these use
          // bright unlit materials for a bold, clear highlight.
          filletState.hoverMat = new THREE.MeshBasicMaterial({ color: 0xffb703, depthTest: false });
          filletState.pickMat  = new THREE.MeshBasicMaterial({ color: 0xff7a1a, depthTest: false });
        }
        renderFilletEdges();
        updateFilletCount();
        document.getElementById('fillet-hint').textContent =
          filletState.edges.length ? 'Click an edge to pick it. Click again to unpick.' : 'No sharp edges detected on this solid.';
      }

      function clearFilletHighlights() {
        if (filletState.lineGroup) {
          while (filletState.lineGroup.children.length) {
            const c = filletState.lineGroup.children[0];
            filletState.lineGroup.remove(c); if (c.geometry) c.geometry.dispose();
          }
        }
      }

      function renderFilletEdges() {
        clearFilletHighlights();
        if (!filletState.lineGroup) return;
        // Scale the highlight-tube radius to the model so it reads clearly on both
        // tiny and large parts.
        let tubeR = 0.5;
        if (filletState.mesh) {
          const box = new THREE.Box3().setFromObject(filletState.mesh);
          const size = new THREE.Vector3(); box.getSize(size);
          tubeR = Math.max(0.25, Math.min(2.2, size.length() * 0.006));
        }
        filletState.edges.forEach((e, idx) => {
          const isPicked = filletState.picked.has(idx);
          const isHover = filletState.hoverSet ? filletState.hoverSet.has(idx) : idx === filletState.hovered;
          if (isPicked || isHover) {
            // Bold tube along the edge for a clear, thick highlight.
            const dir = e.b.clone().sub(e.a);
            const len = dir.length();
            if (len < 1e-6) return;
            const geo = new THREE.CylinderGeometry(tubeR, tubeR, len, 6, 1);
            const tube = new THREE.Mesh(geo, isHover ? filletState.hoverMat : filletState.pickMat);
            // orient the cylinder (default +Y) along the edge, centre it on the edge
            tube.position.copy(e.a).add(e.b).multiplyScalar(0.5);
            tube.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
            tube.renderOrder = 999;
            filletState.lineGroup.add(tube);
          } else {
            const geo = new THREE.BufferGeometry().setFromPoints([e.a, e.b]);
            const line = new THREE.Line(geo, filletState.baseMat);
            line.renderOrder = 998;
            filletState.lineGroup.add(line);
          }
        });
      }

      function updateFilletCount() {
        const el = document.getElementById('fillet-count');
        if (el) el.textContent = filletState.picked.size;
      }

      function clearFilletPicks() {
        filletState.picked = new Set();
        filletState.hovered = -1; filletState.hoverSet = null;
        renderFilletEdges(); updateFilletCount();
        document.getElementById('fillet-hint').textContent = 'Picks cleared. Click an edge to pick it.';
      }

