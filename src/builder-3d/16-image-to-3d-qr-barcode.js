      // ═══════════════════════════════════════════════════════════════════════════
      //   IMAGE → 3D — rasterize a flat image (e.g. a shape drawn in Paint) into
      //   an extruded pixel-block solid. Dark (or opaque) pixels become material,
      //   light (or transparent) pixels stay empty; the result sits flat like a
      //   plaque, extruded upward by the chosen thickness.
      // ═══════════════════════════════════════════════════════════════════════════
      function rasterizeImageToGrid(img, maxDim, threshold, polarity = 'dark') {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        const scale = maxDim / Math.max(iw, ih);
        const cols = Math.max(1, Math.round(iw * scale));
        const rows = Math.max(1, Math.round(ih * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cols; canvas.height = rows;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cols, rows);
        const data = ctx.getImageData(0, 0, cols, rows).data;
        const grid = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * 4;
            const a = data[i+3];
            const lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
            // Transparent pixels are always "empty". Otherwise the shape is either
            // the dark part (lum < threshold) or the light part, per polarity.
            let on = a >= 16 && (polarity === 'dark' ? lum < threshold : lum >= threshold);
            row.push(on);
          }
          grid.push(row);
        }
        return { grid, cols, rows };
      }

      // Emit only the outward-facing faces of the solid (skip a face wherever the
      // neighbouring cell is also filled, since that face is buried inside the
      // model) — a simple greedy face-culling extrusion of the pixel grid.
      function buildExtrudedGridGeometry(grid, cols, rows, cellSize, depth) {
        const at = (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols) ? grid[r][c] : false;
        const out = [];
        const P = (x,y,z) => new THREE.Vector3(x,y,z);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!grid[r][c]) continue;
            const x0 = c*cellSize, x1 = (c+1)*cellSize;
            const z0 = r*cellSize, z1 = (r+1)*cellSize;
            const y0 = 0, y1 = depth;
            pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y0,z1), P(x0,y0,z1), new THREE.Vector3(0,-1,0)); // bottom
            pushQuadOutward(out, P(x0,y1,z0), P(x1,y1,z0), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,1,0));  // top
            if (!at(r,c-1)) pushQuadOutward(out, P(x0,y0,z0), P(x0,y0,z1), P(x0,y1,z1), P(x0,y1,z0), new THREE.Vector3(-1,0,0));
            if (!at(r,c+1)) pushQuadOutward(out, P(x1,y0,z0), P(x1,y0,z1), P(x1,y1,z1), P(x1,y1,z0), new THREE.Vector3(1,0,0));
            if (!at(r-1,c)) pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y1,z0), P(x0,y1,z0), new THREE.Vector3(0,0,-1));
            if (!at(r+1,c)) pushQuadOutward(out, P(x0,y0,z1), P(x1,y0,z1), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,0,1));
          }
        }
        const arr = new Float32Array(out.length * 9);
        out.forEach((t,i) => { for (let j=0;j<3;j++){ arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.computeVertexNormals();
        return g;
      }

      // Trace the filled region of a boolean grid into closed polygon contours
      // using marching squares on the cell corners, then simplify + smooth them.
      // This turns a pixel blob into clean vector outlines we can extrude smoothly.
      function traceContours(grid, cols, rows) {
        // Sample "inside" at integer corner coordinates (a corner is inside if any
        // of its 4 surrounding cells is filled → gives a tight outline around the shape).
        const inside = (x, y) => {
          if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
          return grid[y][x];
        };
        // Build a padded corner field: corner (cx,cy) covers cells; use cell-centre
        // occupancy directly by treating each filled cell as a unit square. We march
        // over the grid-with-1-cell border so edges close.
        const W = cols + 2, H = rows + 2;
        const val = (cx, cy) => inside(cx - 1, cy - 1) ? 1 : 0;

        // Collect boundary segments between filled and empty cells (Moore-style).
        // Each filled cell contributes edges where its neighbour is empty; we then
        // chain those unit edges into closed loops.
        const edges = new Map(); // "x,y" -> list of "x,y" (directed boundary)
        const key = (x, y) => x + ',' + y;
        const addSeg = (ax, ay, bx, by) => {
          if (!edges.has(key(ax, ay))) edges.set(key(ax, ay), []);
          edges.get(key(ax, ay)).push([bx, by]);
        };
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            if (!grid[cy][cx]) continue;
            const x0 = cx, y0 = cy, x1 = cx + 1, y1 = cy + 1;
            // wind boundary CCW so filled is on the left
            if (!inside(cx, cy - 1)) addSeg(x0, y0, x1, y0); // top edge
            if (!inside(cx + 1, cy)) addSeg(x1, y0, x1, y1); // right
            if (!inside(cx, cy + 1)) addSeg(x1, y1, x0, y1); // bottom
            if (!inside(cx - 1, cy)) addSeg(x0, y1, x0, y0); // left
          }
        }

        // Chain segments into closed loops.
        const loops = [];
        const usedFrom = new Set();
        edges.forEach((list, from) => {
          list.forEach((to, idx) => {
            const startKey = from + '>' + idx;
            if (usedFrom.has(startKey)) return;
            // walk
            const loop = [];
            let curKey = from, curIdx = idx, guard = 0;
            let cur = from.split(',').map(Number);
            while (guard++ < 100000) {
              const outs = edges.get(curKey);
              if (!outs || !outs.length) break;
              // pick first unused outgoing
              let chosen = -1;
              for (let i = 0; i < outs.length; i++) {
                if (!usedFrom.has(curKey + '>' + i)) { chosen = i; break; }
              }
              if (chosen < 0) break;
              usedFrom.add(curKey + '>' + chosen);
              const nxt = outs[chosen];
              loop.push([cur[0], cur[1]]);
              cur = nxt;
              curKey = key(nxt[0], nxt[1]);
              if (curKey === from) { break; }
            }
            if (loop.length >= 4) loops.push(loop);
          });
        });
        return loops;
      }

      // Chaikin smoothing: rounds a polygon by cutting corners, `iters` times.
      function smoothLoop(loop, iters) {
        let pts = loop.map(p => [p[0], p[1]]);
        for (let k = 0; k < iters; k++) {
          const out = [];
          const n = pts.length;
          for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            out.push([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25]);
            out.push([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75]);
          }
          pts = out;
        }
        return pts;
      }

      // Drop points that are nearly collinear, to keep the contour light.
      function simplifyLoop(pts, tol) {
        if (pts.length < 4) return pts;
        const out = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
          const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
          const abx = b[0]-a[0], aby = b[1]-a[1], bcx = c[0]-b[0], bcy = c[1]-b[1];
          const cross = abx*bcy - aby*bcx;
          const lenA = Math.hypot(abx, aby), lenB = Math.hypot(bcx, bcy);
          if (Math.abs(cross) > tol * lenA * lenB || lenA < 1e-6) out.push(b);
        }
        out.push(pts[pts.length - 1]);
        return out;
      }

      // Signed area (shoelace) — used to tell outer contours (CCW) from holes (CW).
      function loopArea(pts) {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          a += p[0]*q[1] - q[0]*p[1];
        }
        return a / 2;
      }

      // Point-in-polygon (ray cast), for assigning holes to their outer shape.
      function pointInLoop(pt, loop) {
        let inside = false;
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
          const xi = loop[i][0], yi = loop[i][1], xj = loop[j][0], yj = loop[j][1];
          if (((yi > pt[1]) !== (yj > pt[1])) &&
              (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      }

      // ── Image → 3D relief (heightmap) ──────────────────────────────────────
      // The existing importer traces the image's OUTLINE and extrudes it flat — a
      // stamp of the silhouette. This instead reads the image's brightness as
      // HEIGHT, so shading in the picture becomes real depth: a photo of a logo or
      // a scan of a foot comes out as a contoured surface rather than a flat plate.
      //
      // Every pixel becomes a vertex on a grid, the grid is triangulated, and skirt
      // walls plus a base are added so the result is a closed solid that can be cut,
      // filleted, and printed rather than an open sheet.
      function buildReliefGeometry(img, opts) {
        const o = Object.assign({
          footprint: 60,     // mm across the longest side
          relief: 6,         // mm from the lowest point to the highest
          base: 2,           // mm of solid plate underneath
          res: 160,          // grid samples across the longest side
          invert: false,     // light = high, or dark = high
          smooth: 1,         // blur passes over the height data
          flatten: 0         // clamp the darkest N% to the base (kills noise)
        }, opts || {});

        // Sample the image into a grid.
        const ar = img.width / img.height;
        const nx = Math.max(8, Math.round(ar >= 1 ? o.res : o.res * ar));
        const ny = Math.max(8, Math.round(ar >= 1 ? o.res / ar : o.res));
        const c = document.createElement('canvas');
        c.width = nx; c.height = ny;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, nx, ny);
        const px = cx.getImageData(0, 0, nx, ny).data;

        // Perceptual luminance — a plain RGB average makes reds and blues read at
        // the wrong height, which matters on coloured scans.
        let h = new Float32Array(nx * ny);
        for (let i = 0, n = nx * ny; i < n; i++) {
          const r = px[i*4], g = px[i*4+1], b = px[i*4+2], a = px[i*4+3] / 255;
          let v = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
          v *= a;                              // transparent areas sit at the base
          h[i] = o.invert ? 1 - v : v;
        }

        // Blur to take the edge off compression noise and dithering, which would
        // otherwise print as a rough, speckled surface.
        for (let s = 0; s < o.smooth; s++) {
          const t = new Float32Array(h.length);
          for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
            let sum = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const xx = x+dx, yy = y+dy;
              if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
              sum += h[yy*nx+xx]; cnt++;
            }
            t[y*nx+x] = sum / cnt;
          }
          h = t;
        }

        // Normalise to the actual range present, so a low-contrast photo still uses
        // the full relief depth instead of coming out nearly flat.
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
        const span = (hi - lo) || 1;
        const cut = o.flatten / 100;
        for (let i = 0; i < h.length; i++) {
          let v = (h[i] - lo) / span;
          v = v <= cut ? 0 : (v - cut) / (1 - cut || 1);
          h[i] = v;
        }

        const w = o.footprint, d = o.footprint / ar;
        const sx = w / (nx - 1), sy = d / (ny - 1);
        const X = (i) => -w/2 + i * sx;
        const Y = (j) => -d/2 + j * sy;
        const Z = (i, j) => o.base + h[j*nx + i] * o.relief;

        const pos = [];
        const tri = (ax,ay,az, bx,by,bz, cx2,cy2,cz) => { pos.push(ax,ay,az, bx,by,bz, cx2,cy2,cz); };

        // Top surface.
        for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++) {
          const x0=X(i), x1=X(i+1), y0=Y(j), y1=Y(j+1);
          const z00=Z(i,j), z10=Z(i+1,j), z01=Z(i,j+1), z11=Z(i+1,j+1);
          tri(x0,y0,z00, x1,y0,z10, x1,y1,z11);
          tri(x0,y0,z00, x1,y1,z11, x0,y1,z01);
        }
        // Flat base — subdivided on the SAME grid as the skirt walls. Using a
        // single large quad here left the base edges unsplit while the walls were
        // split per column, so the corner vertices never matched up and the solid
        // came out with hundreds of open edges (and so couldn't be booleaned).
        const x0=-w/2, x1=w/2, y0=-d/2, y1=d/2;
        for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++) {
          const ax=X(i), bx=X(i+1), ay=Y(j), by=Y(j+1);
          tri(ax,ay,0, bx,by,0, bx,ay,0);
          tri(ax,ay,0, ax,by,0, bx,by,0);
        }
        // Skirt walls joining the surface to the base, so the solid is closed.
        for (let i = 0; i < nx-1; i++) {
          const xa=X(i), xb=X(i+1);
          tri(xa,y0,0, xb,y0,0, xb,y0,Z(i+1,0));
          tri(xa,y0,0, xb,y0,Z(i+1,0), xa,y0,Z(i,0));
          tri(xb,y1,0, xa,y1,0, xa,y1,Z(i,ny-1));
          tri(xb,y1,0, xa,y1,Z(i,ny-1), xb,y1,Z(i+1,ny-1));
        }
        for (let j = 0; j < ny-1; j++) {
          const ya=Y(j), yb=Y(j+1);
          tri(x1,ya,0, x1,yb,0, x1,yb,Z(nx-1,j+1));
          tri(x1,ya,0, x1,yb,Z(nx-1,j+1), x1,ya,Z(nx-1,j));
          tri(x0,yb,0, x0,ya,0, x0,ya,Z(0,j));
          tri(x0,yb,0, x0,ya,Z(0,j), x0,yb,Z(0,j+1));
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
        geo.computeVertexNormals();
        return geo;
      }

      // Read the chosen mode and hand off to the relief builder when asked.
      function img3dMode() {
        const b = document.querySelector('#img3d-mode .toggle-btn.active');
        return b ? b.dataset.mode : 'outline';
      }
      function importImageAsRelief(file) {
        const el = (id) => document.getElementById(id);
        const opts = {
          footprint: parseFloat(el('img3d-size') ? el('img3d-size').value : 60) || 60,
          relief:    parseFloat(el('img3d-relief') ? el('img3d-relief').value : 6) || 6,
          base:      parseFloat(el('img3d-base') ? el('img3d-base').value : 2) || 2,
          res:       parseInt(el('img3d-res') ? el('img3d-res').value : 160, 10) || 160,
          smooth:    parseInt(el('img3d-rsmooth') ? el('img3d-rsmooth').value : 1, 10) || 0,
          flatten:   parseInt(el('img3d-flatten') ? el('img3d-flatten').value : 0, 10) || 0,
          invert:    el('img3d-invert') ? el('img3d-invert').checked : false
        };
        banner('Reading image…');
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            window._img3dLastImage = img;   // so the dialog can preview it
            try {
              banner('Building relief — this can take a moment at high detail…');
              const geo = buildReliefGeometry(img, opts);
              const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb0b8c8, roughness: 0.45 }));
              mesh.userData.name = (file.name || 'Relief').replace(/\.[^.]+$/, '');
              recenterMeshTransform(mesh);
              mesh.castShadow = true; mesh.receiveShadow = true;
              scene.add(mesh); objects.push(mesh);
              selected = [mesh];
              refreshSelectionVisual(); attachGizmoToSelection();
              saveHistory(); updateStatus(); updateFloatingHUD();
              if (window.invalidate3D) window.invalidate3D();
              const tris = geo.attributes.position.count / 3;
              banner(`Relief created — ${tris.toLocaleString()} triangles. Lower "Surface detail" if it feels heavy.`);
            } catch (err) {
              console.error('Relief build failed:', err);
              banner('⚠️ Couldn\'t build a relief from that image: ' + ((err && err.message) || err));
            }
            URL.revokeObjectURL(img.src);
          };
          img.onerror = () => banner('⚠️ Couldn\'t read that image.');
          img.src = reader.result;
        };
        reader.onerror = () => banner('⚠️ Couldn\'t read that file.');
        reader.readAsDataURL(file);
      }

      // ── QR code: exact grid extrusion (no image round-trip) ─────────────────
      // The QR panel used to render the code to a PNG and feed it through
      // importImageTo3D() like a dropped photo. That pipeline downsamples through
      // a canvas with smoothing ON by default (rasterizeImageToGrid never turns
      // it off, since a traced photo usually WANTS soft edges), then rounds
      // corners further for a natural-looking outline. Both steps blur and merge
      // module edges — fine for a logo, fatal for a QR code, where a scanner
      // expects every module to be an exact square: the printed codes came out
      // with melted, rounded modules that would not scan.
      //
      // The fix is to skip rasterization and tracing entirely. The QR matrix IS
      // already an exact boolean grid, so this extrudes it directly: one
      // axis-aligned box per dark module, sharing the app's build-face-culling
      // technique (skip a face wherever the neighbouring module is also filled,
      // since that face is buried inside the solid). No pixels, no contours, no
      // smoothing pass exists to round anything.
      window.buildQR3DFromGrid = function (modules, size, opts) {
        opts = opts || {};
        const footprint = opts.footprint || 40;
        const depth = opts.depth || 3;
        const quiet = opts.quiet != null ? opts.quiet : 4;   // standard QR light margin
        const n = size + quiet * 2;
        const cell = footprint / n;

        const at = (r, c) => {
          const rr = r - quiet, cc = c - quiet;
          return rr >= 0 && rr < size && cc >= 0 && cc < size && modules[rr][cc];
        };
        const out = [];
        let moduleCount = 0;
        const P = (x, y, z) => new THREE.Vector3(x, y, z);
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (!at(r, c)) continue;
            moduleCount++;
            const x0 = c * cell, x1 = (c + 1) * cell;
            const y0 = r * cell, y1 = (r + 1) * cell;
            const z0 = 0, z1 = depth;
            pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y1,z0), P(x0,y1,z0), new THREE.Vector3(0,0,-1)); // bottom
            pushQuadOutward(out, P(x0,y0,z1), P(x1,y0,z1), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,0,1));  // top
            if (!at(r,c-1)) pushQuadOutward(out, P(x0,y0,z0), P(x0,y1,z0), P(x0,y1,z1), P(x0,y0,z1), new THREE.Vector3(-1,0,0));
            if (!at(r,c+1)) pushQuadOutward(out, P(x1,y0,z0), P(x1,y1,z0), P(x1,y1,z1), P(x1,y0,z1), new THREE.Vector3(1,0,0));
            if (!at(r-1,c)) pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y0,z1), P(x0,y0,z1), new THREE.Vector3(0,-1,0));
            if (!at(r+1,c)) pushQuadOutward(out, P(x0,y1,z0), P(x1,y1,z0), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,1,0));
          }
        }
        if (!out.length) { banner('⚠️ That QR code has no dark modules to build.'); return null; }
        const arr = new Float32Array(out.length * 9);
        out.forEach((t, i) => { for (let j = 0; j < 3; j++) { arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        geo.computeBoundingBox();
        const c2 = new THREE.Vector3(); geo.boundingBox.getCenter(c2);
        geo.translate(-c2.x, -c2.y, 0);   // centre in X/Y, keep the base sitting at z=0
        geo.computeVertexNormals();

        const clean = makeGeometryCSGReady(geo);
        const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45, side: THREE.DoubleSide }));
        mesh.geometry.computeBoundingBox();
        mesh.position.z = 0.01;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.name = 'QR code';
        scene.add(mesh); objects.push(mesh);
        selected.forEach(o => setEmissive(o, 0x000000));
        selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Built ${moduleCount} dark modules as exact squares — no smoothing, so it scans.`);
        return mesh;
      };

      // ── Barcode: exact bar extrusion (same reasoning as the QR builder) ─────
      // A barcode's width array already strictly alternates bar, space, bar,
      // space... (that's what "symbol bar/space widths" means), so unlike the
      // QR grid there's no adjacent-module face-culling to do at all: a space
      // always separates one bar from the next, so every bar is simply its own
      // free-standing box. Straight from the encoder's own width array — no
      // image, no rasterizing, no smoothing pass to round anything.
      window.buildBarcode3DFromWidths = function (widths, opts) {
        opts = opts || {};
        const footprint = opts.footprint || 60;
        const barHeight = opts.barHeight || 18;
        const depth = opts.depth || 3;
        const quiet = opts.quiet != null ? opts.quiet : 10;   // standard quiet zone, in narrow-bar units
        const totalUnits = quiet * 2 + widths.reduce((a, b) => a + b, 0);
        const cell = footprint / totalUnits;

        const out = [];
        const P = (x, y, z) => new THREE.Vector3(x, y, z);
        const box = (x0, x1, y0, y1, z0, z1) => {
          pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y1,z0), P(x0,y1,z0), new THREE.Vector3(0,0,-1));
          pushQuadOutward(out, P(x0,y0,z1), P(x1,y0,z1), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,0,1));
          pushQuadOutward(out, P(x0,y0,z0), P(x0,y1,z0), P(x0,y1,z1), P(x0,y0,z1), new THREE.Vector3(-1,0,0));
          pushQuadOutward(out, P(x1,y0,z0), P(x1,y1,z0), P(x1,y1,z1), P(x1,y0,z1), new THREE.Vector3(1,0,0));
          pushQuadOutward(out, P(x0,y0,z0), P(x1,y0,z0), P(x1,y0,z1), P(x0,y0,z1), new THREE.Vector3(0,-1,0));
          pushQuadOutward(out, P(x0,y1,z0), P(x1,y1,z0), P(x1,y1,z1), P(x0,y1,z1), new THREE.Vector3(0,1,0));
        };
        let x = quiet * cell, barCount = 0;
        widths.forEach((w, i) => {
          const wide = w * cell;
          if (i % 2 === 0) {   // even index = bar (dark); odd = space (light)
            box(x, x + wide, 0, barHeight, 0, depth);
            barCount++;
          }
          x += wide;
        });
        if (!barCount) { banner('⚠️ That barcode has no bars to build.'); return null; }

        const arr = new Float32Array(out.length * 9);
        out.forEach((t, i) => { for (let j = 0; j < 3; j++) { arr[i*9+j*3]=t[j].x; arr[i*9+j*3+1]=t[j].y; arr[i*9+j*3+2]=t[j].z; } });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        geo.computeBoundingBox();
        const c2 = new THREE.Vector3(); geo.boundingBox.getCenter(c2);
        geo.translate(-c2.x, -c2.y, 0);
        geo.computeVertexNormals();

        const clean = makeGeometryCSGReady(geo);
        const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45, side: THREE.DoubleSide }));
        mesh.geometry.computeBoundingBox();
        mesh.position.z = 0.01;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.name = 'Barcode';
        scene.add(mesh); objects.push(mesh);
        selected.forEach(o => setEmissive(o, 0x000000));
        selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Built ${barCount} bars as exact rectangles \u2014 no smoothing, so it scans.`);
        return mesh;
      };

      // Exposed so the QR panel (a separate script scope) can hand off a
      // generated image the same way a dropped file would arrive here. Kept for
      // the (currently unused) relief mode, which still goes through an image.
      window.importImageTo3D = (f) => importImageTo3D(f);
      function importImageTo3D(file) {
        if (img3dMode() === 'relief') return importImageAsRelief(file);
        const footprint = parseFloat(document.getElementById('img3d-size').value) || 40;
        const depth = parseFloat(document.getElementById('img3d-depth').value) || 5;
        const threshold = parseFloat(document.getElementById('img3d-thresh').value) || 128;
        const detail = parseInt(document.getElementById('img3d-detail').value, 10) || 220;
        const smoothIters = parseInt(document.getElementById('img3d-smooth').value, 10);
        const polarity = (document.querySelector('#img3d-polarity .toggle-btn.active') || {}).dataset?.pol || 'dark';

        banner("Reading image…");
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            try {
              const { grid, cols, rows } = rasterizeImageToGrid(img, detail, threshold, polarity);
              let onCount = 0; grid.forEach(row => row.forEach(v => { if (v) onCount++; }));
              if (!onCount) { banner("⚠️ Couldn't find a shape — try flipping Dark/Light or adjusting the threshold."); return; }
              if (onCount === cols * rows) { banner("⚠️ The whole image reads as the shape — try flipping Dark/Light or adjusting the threshold."); return; }

              // Trace outlines → smooth → build THREE.Shapes with holes.
              let loops = traceContours(grid, cols, rows);
              if (!loops.length) { banner("⚠️ Couldn't trace an outline — try a bolder shape or more detail."); return; }
              loops = loops
                .map(l => simplifyLoop(smoothLoop(l, smoothIters), 0.02))
                .filter(l => Math.abs(loopArea(l)) > 1.5); // drop specks
              if (!loops.length) { banner("⚠️ Only tiny specks found — use a bolder shape."); return; }

              // Separate outer contours (larger, CCW) from holes (inside another loop).
              loops.sort((a, b) => Math.abs(loopArea(b)) - Math.abs(loopArea(a)));
              const outers = [], holes = [];
              loops.forEach(l => {
                const centroid = l.reduce((s, p) => [s[0]+p[0], s[1]+p[1]], [0,0]).map(v => v / l.length);
                const container = outers.find(o => pointInLoop(centroid, o.pts));
                if (container) holes.push({ pts: l, parent: container });
                else outers.push({ pts: l, holes: [] });
              });
              holes.forEach(h => h.parent.holes.push(h.pts));

              // Normalize coordinates to the requested footprint, centre at origin.
              const scale = footprint / Math.max(cols, rows);
              const toXY = (p) => new THREE.Vector2((p[0] - cols/2) * scale, (rows/2 - p[1]) * scale);

              const shapes = outers.map(o => {
                const shape = new THREE.Shape(o.pts.map(toXY));
                o.holes.forEach(h => shape.holes.push(new THREE.Path(h.map(toXY))));
                return shape;
              });

              const geo = new THREE.ExtrudeGeometry(shapes, {
                depth, bevelEnabled: false, curveSegments: 2, steps: 1
              });
              // ExtrudeGeometry builds thickness along +Z, which is already the
              // app's vertical axis — the footprint lies flat on the build plate
              // (X/Y) and the extrusion stands straight up, no rotation needed.
              geo.computeBoundingBox();
              const c = new THREE.Vector3(); geo.boundingBox.getCenter(c);
              geo.translate(-c.x, -c.y, -c.z);

              const clean = makeGeometryCSGReady(geo);
              const mesh = new THREE.Mesh(clean, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45, side: THREE.DoubleSide }));
              mesh.geometry.computeBoundingBox();
              const h2 = (mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z) / 2;
              mesh.position.z = h2 + 0.01;
              mesh.castShadow = true; mesh.receiveShadow = true;
              scene.add(mesh); objects.push(mesh);
              selected.forEach(o => setEmissive(o, 0x000000));
              selected = [mesh]; setEmissive(mesh, 0x0e3d44); attachGizmoTarget(mesh);
              saveHistory(); updateStatus(); updateFloatingHUD();
              banner(`Converted image to a smooth 3D solid (${outers.length} shape${outers.length>1?'s':''}, ${holes.length} hole${holes.length!==1?'s':''}).`);
            } catch (err) {
              console.error(err); banner("⚠️ Couldn't convert that image — try a simpler, bolder shape.");
            }
          };
          img.onerror = () => banner("⚠️ Couldn't read that image file.");
          img.src = reader.result;
        };
        reader.onerror = () => banner("⚠️ Couldn't read that file.");
        reader.readAsDataURL(file);
      }

      function parseSTL(buffer) {
        const dv = new DataView(buffer);
        // Detect ASCII: binary STL has 80-byte header + uint32 tri count; check for "solid" + plausibility
        const isAscii = (() => {
          const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength))).trim().toLowerCase();
          if (!header.startsWith('solid')) return false;
          if (buffer.byteLength < 84) return true;
          const n = dv.getUint32(80, true);
          return (84 + n*50) !== buffer.byteLength;
        })();

        const positions = [];
        if (isAscii) {
          const txt = new TextDecoder().decode(new Uint8Array(buffer));
          const re = /vertex\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)/g;
          let m; while ((m = re.exec(txt)) !== null) positions.push(+m[1], +m[2], +m[3]);
        } else {
          // Clamp the declared triangle count to what the file can actually hold —
          // a corrupt/hostile header would otherwise read past the buffer.
          if (buffer.byteLength < 84) throw new Error('STL file is truncated');
          const n = Math.min(dv.getUint32(80, true), Math.floor((buffer.byteLength - 84) / 50)); let off = 84;
          for (let i=0;i<n;i++){ off += 12; for (let j=0;j<3;j++){ positions.push(dv.getFloat32(off,true), dv.getFloat32(off+4,true), dv.getFloat32(off+8,true)); off += 12; } off += 2; }
        }
        if (!positions.length) throw new Error('No triangles found in this STL');
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.computeVertexNormals();
        return g;
      }

      function parseOBJ(text) {
        const v = [], positions = [];
        const lines = text.split('\n');
        for (const line of lines) {
          const p = line.trim().split(/\s+/);
          if (p[0] === 'v') v.push([+p[1], +p[2], +p[3]]);
          else if (p[0] === 'f') {
            const idx = p.slice(1).map(tok => { let i = parseInt(tok.split('/')[0],10); if (i<0) i = v.length + i + 1; return i-1; });
            for (let i=1;i<idx.length-1;i++){ [idx[0], idx[i], idx[i+1]].forEach(k => { const vert = v[k]; if (vert) positions.push(vert[0], vert[1], vert[2]); }); }
          }
        }
        if (!positions.length) throw new Error('No faces found in this OBJ');
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.computeVertexNormals();
        return g;
      }

      // Minimal ZIP reader supporting stored (0) and deflated (8) entries, using
      // the browser's DecompressionStream for deflate — no external libraries.
      // Also handles ZIP64 (both the whole-archive EOCD64 and per-entry 64-bit
      // size/offset fields), which larger 3MF packages commonly use — without
      // it, the placeholder 0xFFFFFFFF values were being read as real offsets,
      // walking the reader off the end of the buffer ("offset is outside the
      // bounds of the data view").
      function unzipStore(buffer) {
        const dv = new DataView(buffer); const files = {}; const u8 = new Uint8Array(buffer);
        // Find End Of Central Directory
        let eocd = -1;
        for (let i = buffer.byteLength - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
        if (eocd < 0) throw new Error('Bad 3MF (no EOCD)');

        let cdOff = dv.getUint32(eocd + 16, true);
        let count = dv.getUint16(eocd + 10, true);

        // ZIP64: standard EOCD fields are 0xFFFF/0xFFFFFFFF placeholders when
        // the real values don't fit. The real ones live in a separate ZIP64
        // EOCD record, found via a locator directly before the standard EOCD.
        if (count === 0xFFFF || cdOff === 0xFFFFFFFF) {
          const locatorOff = eocd - 20;
          if (locatorOff >= 0 && dv.getUint32(locatorOff, true) === 0x07064b50) {
            // 8-byte offset; the low 32 bits are enough for any file under 4GB,
            // which covers every realistic 3MF.
            const zip64EocdOff = dv.getUint32(locatorOff + 8, true);
            if (zip64EocdOff + 4 <= buffer.byteLength && dv.getUint32(zip64EocdOff, true) === 0x06064b50) {
              cdOff = dv.getUint32(zip64EocdOff + 48, true);
              count = dv.getUint32(zip64EocdOff + 32, true);
            }
          }
        }

        const decoded = [];
        for (let i=0;i<count;i++){
          if (cdOff + 46 > buffer.byteLength || dv.getUint32(cdOff,true) !== 0x02014b50) break;
          const method = dv.getUint16(cdOff+10, true);
          let compSize = dv.getUint32(cdOff+20, true);
          const nameLen = dv.getUint16(cdOff+28, true);
          const extraLen = dv.getUint16(cdOff+30, true);
          const commLen = dv.getUint16(cdOff+32, true);
          let lho = dv.getUint32(cdOff+42, true);
          const name = new TextDecoder().decode(u8.subarray(cdOff+46, cdOff+46+nameLen));

          // Per-entry ZIP64 extra field: real 64-bit values (low 32 bits used)
          // replace whichever standard fields were 0xFFFFFFFF placeholders, in
          // this fixed order: uncompressed size, compressed size, local header
          // offset, disk number — each present only if its standard field was
          // the placeholder.
          if (compSize === 0xFFFFFFFF || lho === 0xFFFFFFFF) {
            const uncompSizeStd = dv.getUint32(cdOff+24, true);
            let exOff = cdOff + 46 + nameLen;
            const exEnd = exOff + extraLen;
            while (exOff + 4 <= exEnd) {
              const tag = dv.getUint16(exOff, true);
              const size = dv.getUint16(exOff + 2, true);
              if (tag === 0x0001) {
                let p = exOff + 4;
                const pEnd = p + size;
                if (uncompSizeStd === 0xFFFFFFFF && p + 8 <= pEnd) { p += 8; }
                if (compSize === 0xFFFFFFFF && p + 8 <= pEnd) { compSize = dv.getUint32(p, true); p += 8; }
                if (lho === 0xFFFFFFFF && p + 8 <= pEnd) { lho = dv.getUint32(p, true); p += 8; }
              }
              exOff += 4 + size;
            }
          }

          // local header to find data start
          if (lho + 30 > buffer.byteLength) break;
          const lNameLen = dv.getUint16(lho+26, true);
          const lExtraLen = dv.getUint16(lho+28, true);
          const dataStart = lho + 30 + lNameLen + lExtraLen;
          const comp = u8.subarray(dataStart, dataStart + compSize);
          decoded.push({ name, method, comp });
          cdOff += 46 + nameLen + extraLen + commLen;
        }
        // synchronously return stored; inflate deflated via a fallback
        return new Promise(async (resolve) => {
          for (const e of decoded) {
            if (e.method === 0) files[e.name] = e.comp.slice();
            else files[e.name] = await inflateRaw(e.comp);
          }
          resolve(files);
        });
      }

      async function inflateRaw(bytes) {
        if (typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const stream = new Blob([bytes]).stream().pipeThrough(ds);
          // Read in chunks and stop at a cap, so a tiny "zip bomb" 3MF can't
          // inflate into gigabytes and take the tab down.
          const MAX_INFLATED = 512 * 1024 * 1024;
          const reader = stream.getReader();
          const chunks = []; let total = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_INFLATED) { reader.cancel(); throw new Error('3MF is too large to unpack safely'); }
            chunks.push(value);
          }
          const out = new Uint8Array(total); let o = 0;
          for (const c of chunks) { out.set(c, o); o += c.length; }
          return out;
        }
        throw new Error('Deflate not supported in this browser for 3MF import');
      }

      // Parses a 3MF package into one or more printable objects. Handles the
      // structure Bambu Studio / PrusaSlicer actually write: the mesh data for
      // each part commonly lives in its OWN file under 3D/Objects/*.model,
      // with the root 3D/3dmodel.model just referencing those object ids via
      // <build><item> and/or <components><component>. A naive reader that
      // only looks at the root file's own <vertex>/<triangle> tags finds
      // nothing there — which is exactly why those files were importing blank.
      async function parse3MF(buffer) {
        const files = await unzipStore(buffer);

        const modelParts = Object.keys(files).filter(f => f.toLowerCase().endsWith('.model'));
        if (!modelParts.length) throw new Error('No model part found in the 3MF');

        // Prefer the part named by the package relationships; fall back to the
        // conventional path, then to just the first .model file found.
        let rootPath = null;
        if (files['_rels/.rels']) {
          try {
            const relsXml = new TextDecoder().decode(files['_rels/.rels']);
            const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
            for (const rel of relsDoc.getElementsByTagName('Relationship')) {
              const type = rel.getAttribute('Type') || '';
              if (/3dmodel$/i.test(type)) {
                let target = rel.getAttribute('Target') || '';
                if (target.startsWith('/')) target = target.slice(1);
                if (files[target]) { rootPath = target; break; }
              }
            }
          } catch (e) { /* fall through to the conventional lookup below */ }
        }
        if (!rootPath) rootPath = modelParts.find(p => /3dmodel\.model$/i.test(p)) || modelParts[0];

        // Parse every .model part and index every <object> by id, regardless
        // of which file it came from — ids are unique across the whole
        // package, which is exactly what lets a root file reference a mesh
        // that physically lives in a different part.
        const objectsById = new Map();
        const parsedDocs = {};
        for (const path of modelParts) {
          const xml = new TextDecoder().decode(files[path]);
          const doc = new DOMParser().parseFromString(xml, 'application/xml');
          parsedDocs[path] = doc;
          for (const objEl of doc.getElementsByTagName('object')) {
            const id = objEl.getAttribute('id');
            if (id == null) continue;
            const meshEl = objEl.getElementsByTagName('mesh')[0];
            if (meshEl) {
              const vertsEl = meshEl.getElementsByTagName('vertices')[0];
              const trisEl = meshEl.getElementsByTagName('triangles')[0];
              const verts = vertsEl ? [...vertsEl.getElementsByTagName('vertex')].map(v => [+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z')]) : [];
              const tris = trisEl ? [...trisEl.getElementsByTagName('triangle')].map(t => [+t.getAttribute('v1'), +t.getAttribute('v2'), +t.getAttribute('v3')]) : [];
              objectsById.set(id, { verts, tris });
            } else {
              const compsEl = objEl.getElementsByTagName('components')[0];
              if (compsEl) {
                const comps = [...compsEl.getElementsByTagName('component')].map(c => ({
                  objectid: c.getAttribute('objectid'),
                  transform: c.getAttribute('transform') || null
                }));
                objectsById.set(id, { components: comps });
              }
            }
          }
        }

        // 3MF's 12-number transform is a row-vector (v·M) 4x3 matrix with
        // translation in the last row; convert to THREE's column-vector form.
        const parseTransform = (str) => {
          if (!str) return null;
          const n = str.trim().split(/\s+/).map(Number);
          if (n.length !== 12 || n.some(Number.isNaN)) return null;
          const m = new THREE.Matrix4();
          m.set(
            n[0], n[3], n[6], n[9],
            n[1], n[4], n[7], n[10],
            n[2], n[5], n[8], n[11],
            0,    0,    0,    1
          );
          return m;
        };

        // Resolves an object id into flat {verts, tris, matrix} leaves,
        // recursing through <components> and composing their transforms.
        function resolveObject(id, parentMatrix, seen) {
          if (seen.has(id)) return []; // guard against a cyclic component reference
          seen = new Set(seen); seen.add(id);
          const obj = objectsById.get(id);
          if (!obj) return [];
          if (obj.verts) return [{ verts: obj.verts, tris: obj.tris, matrix: parentMatrix }];
          const out = [];
          (obj.components || []).forEach(c => {
            const local = parseTransform(c.transform) || new THREE.Matrix4();
            out.push(...resolveObject(c.objectid, parentMatrix.clone().multiply(local), seen));
          });
          return out;
        }

        const rootDoc = parsedDocs[rootPath];
        const items = [...rootDoc.getElementsByTagName('item')].map(it => ({
          objectid: it.getAttribute('objectid'),
          transform: it.getAttribute('transform') || null
        }));
        if (!items.length) throw new Error('No build items found in the 3MF');

        const results = [];
        items.forEach((item, idx) => {
          const baseMatrix = parseTransform(item.transform) || new THREE.Matrix4();
          const leaves = resolveObject(item.objectid, baseMatrix, new Set());
          const positions = [];
          leaves.forEach(leaf => {
            leaf.tris.forEach(([a,b,c]) => {
              [a,b,c].forEach(vi => {
                const v = leaf.verts[vi];
                if (!v) return;
                const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(leaf.matrix);
                positions.push(p.x, p.y, p.z);
              });
            });
          });
          if (positions.length) results.push({ positions, name: `part_${idx+1}` });
        });
        return results;
      }

      async function importFile(file) {
        const name = file.name; const lower = name.toLowerCase();
        try {
          if (lower.endsWith('.stl')) {
            const buf = await file.arrayBuffer();
            addImportedGeometry(parseSTL(buf), name);
          } else if (lower.endsWith('.obj')) {
            const txt = await file.text();
            addImportedGeometry(parseOBJ(txt), name);
          } else if (lower.endsWith('.3mf')) {
            const buf = await file.arrayBuffer();
            const parts = await parse3MF(buf);
            if (!parts.length) throw new Error('No printable geometry found in this 3MF');
            const base = name.replace(/\.3mf$/i, '');
            const geoms = parts.map(part => {
              const g = new THREE.BufferGeometry();
              g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
              g.computeVertexNormals();
              return { geometry: g, name: `${base}_${part.name}` };
            });
            if (geoms.length > 1) addImportedGeometryParts(geoms, name);
            else addImportedGeometry(geoms[0].geometry, name);
          } else {
            banner("⚠️ Unsupported file type. Use STL, OBJ, or 3MF.");
          }
        } catch (err) { console.error(err); banner(`⚠️ Failed to import ${name}: ${err.message}`); }
      }

