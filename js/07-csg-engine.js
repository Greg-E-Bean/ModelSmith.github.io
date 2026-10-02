
  // ═══════════════════════════════════════════════════════════════════════════
  //   Self-contained BSP CSG engine (Evan Wallace csg.js algorithm, adapted).
  //   No CDN dependency — deterministic union / subtract / intersect on
  //   THREE.BufferGeometry via world matrices.
  // ═══════════════════════════════════════════════════════════════════════════
  (function(){
    const EPS = 1e-5;

    class Vec {
      constructor(x,y,z){ this.x=x; this.y=y; this.z=z; }
      clone(){ return new Vec(this.x,this.y,this.z); }
      negated(){ return new Vec(-this.x,-this.y,-this.z); }
      plus(a){ return new Vec(this.x+a.x,this.y+a.y,this.z+a.z); }
      minus(a){ return new Vec(this.x-a.x,this.y-a.y,this.z-a.z); }
      times(s){ return new Vec(this.x*s,this.y*s,this.z*s); }
      dot(a){ return this.x*a.x+this.y*a.y+this.z*a.z; }
      lerp(a,t){ return this.plus(a.minus(this).times(t)); }
      length(){ return Math.sqrt(this.dot(this)); }
      unit(){ const l=this.length()||1; return this.times(1/l); }
      cross(a){ return new Vec(this.y*a.z-this.z*a.y, this.z*a.x-this.x*a.z, this.x*a.y-this.y*a.x); }
    }

    class Vertex {
      constructor(pos, normal, color, uv){ this.pos=pos; this.normal=normal; this.color=color||new Vec(1,1,1); this.uv=uv||{x:0,y:0}; }
      clone(){ return new Vertex(this.pos.clone(), this.normal.clone(), this.color.clone(), {x:this.uv.x,y:this.uv.y}); }
      flip(){ this.normal = this.normal.negated(); }
      interpolate(other, t){
        return new Vertex(
          this.pos.lerp(other.pos,t), this.normal.lerp(other.normal,t), this.color.lerp(other.color,t),
          { x: this.uv.x + (other.uv.x - this.uv.x) * t, y: this.uv.y + (other.uv.y - this.uv.y) * t }
        );
      }
    }

    class Plane {
      constructor(normal, w){ this.normal=normal; this.w=w; }
      clone(){ return new Plane(this.normal.clone(), this.w); }
      flip(){ this.normal=this.normal.negated(); this.w=-this.w; }
      static fromPoints(a,b,c){
        const n = b.minus(a).cross(c.minus(a)).unit();
        return new Plane(n, n.dot(a));
      }
      splitPolygon(polygon, coplanarFront, coplanarBack, front, back){
        const COPLANAR=0, FRONT=1, BACK=2, SPANNING=3;
        let polygonType=0; const types=[];
        for(let i=0;i<polygon.vertices.length;i++){
          const t=this.normal.dot(polygon.vertices[i].pos)-this.w;
          const type=(t<-EPS)?BACK:(t>EPS)?FRONT:COPLANAR;
          polygonType|=type; types.push(type);
        }
        switch(polygonType){
          case COPLANAR:
            (this.normal.dot(polygon.plane.normal)>0?coplanarFront:coplanarBack).push(polygon);
            break;
          case FRONT: front.push(polygon); break;
          case BACK: back.push(polygon); break;
          case SPANNING: {
            const f=[], b=[];
            for(let i=0;i<polygon.vertices.length;i++){
              const j=(i+1)%polygon.vertices.length;
              const ti=types[i], tj=types[j];
              const vi=polygon.vertices[i], vj=polygon.vertices[j];
              if(ti!==BACK) f.push(vi);
              if(ti!==FRONT) b.push(ti!==BACK?vi.clone():vi);
              if((ti|tj)===SPANNING){
                const t=(this.w-this.normal.dot(vi.pos))/this.normal.dot(vj.pos.minus(vi.pos));
                const v=vi.interpolate(vj,t);
                f.push(v); b.push(v.clone());
              }
            }
            if(f.length>=3) front.push(new Polygon(f, polygon.shared));
            if(b.length>=3) back.push(new Polygon(b, polygon.shared));
            break;
          }
        }
      }
    }

    class Polygon {
      constructor(vertices, shared){
        this.vertices=vertices; this.shared=shared;
        this.plane=Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
      }
      clone(){ return new Polygon(this.vertices.map(v=>v.clone()), this.shared); }
      flip(){ this.vertices.reverse().forEach(v=>v.flip()); this.plane.flip(); }
    }

    class Node {
      constructor(polygons){ this.plane=null; this.front=null; this.back=null; this.polygons=[]; if(polygons) this.build(polygons); }
      clone(){
        // iterative clone to avoid deep recursion on large trees
        const root = new Node();
        const stack = [[this, root]];
        while (stack.length) {
          const [src, dst] = stack.pop();
          dst.plane = src.plane && src.plane.clone();
          dst.polygons = src.polygons.map(p=>p.clone());
          if (src.front){ dst.front = new Node(); stack.push([src.front, dst.front]); }
          if (src.back){ dst.back = new Node(); stack.push([src.back, dst.back]); }
        }
        return root;
      }
      invert(){
        // iterative: walk every node, flip its polygons/plane and swap children
        const stack=[this];
        while(stack.length){
          const n=stack.pop();
          for(const p of n.polygons) p.flip();
          if(n.plane) n.plane.flip();
          const t=n.front; n.front=n.back; n.back=t;
          if(n.front) stack.push(n.front);
          if(n.back) stack.push(n.back);
        }
      }
      // Clip `polygons` against this whole subtree, iteratively. Each frame carries
      // its input polygons and an output array; a plane splits them into front/back,
      // which are handed to child frames whose results are written back into the
      // parent's output array once computed (post-order via a two-pass stack).
      clipPolygons(polygons){
        const rootOut=[];
        // frame: {node, polys, out, phase}
        const stack=[{node:this, polys:polygons, out:rootOut, phase:0}];
        while(stack.length){
          const f=stack[stack.length-1];
          if(f.phase===0){
            if(!f.node.plane){ for(const p of f.polys) f.out.push(p); stack.pop(); continue; }
            const front=[], back=[];
            for(const p of f.polys) f.node.plane.splitPolygon(p, front, back, front, back);
            f.frontOut=[]; f.backOut=[];
            f.phase=1;
            if(f.node.back){ stack.push({node:f.node.back, polys:back, out:f.backOut, phase:0}); }
            // back with no child → dropped (inside solid)
            if(f.node.front){ stack.push({node:f.node.front, polys:front, out:f.frontOut, phase:0}); }
            else { for(const p of front) f.frontOut.push(p); }
          } else {
            // children done: front results, then back results
            for(const p of f.frontOut) f.out.push(p);
            for(const p of f.backOut) f.out.push(p);
            stack.pop();
          }
        }
        return rootOut;
      }
      clipTo(node){
        const stack=[this];
        while(stack.length){
          const n=stack.pop();
          n.polygons=node.clipPolygons(n.polygons);
          if(n.front) stack.push(n.front);
          if(n.back) stack.push(n.back);
        }
      }
      allPolygons(){
        const res=[]; const stack=[this];
        while(stack.length){
          const n=stack.pop();
          for(const p of n.polygons) res.push(p);
          if(n.front) stack.push(n.front);
          if(n.back) stack.push(n.back);
        }
        return res;
      }
      build(polygons){
        // iterative build: each task adds polygons to a node, splitting into
        // front/back child tasks rather than recursing on the JS call stack.
        const stack=[[this, polygons]];
        while(stack.length){
          const [node, polys]=stack.pop();
          if(!polys.length) continue;
          if(!node.plane) node.plane=polys[0].plane.clone();
          const front=[], back=[];
          for(const p of polys) node.plane.splitPolygon(p, node.polygons, node.polygons, front, back);
          if(front.length){ if(!node.front) node.front=new Node(); stack.push([node.front, front]); }
          if(back.length){ if(!node.back) node.back=new Node(); stack.push([node.back, back]); }
        }
      }
    }


    class CSG {
      constructor(){ this.polygons=[]; }
      clone(){ const c=new CSG(); c.polygons=this.polygons.map(p=>p.clone()); return c; }
      toPolygons(){ return this.polygons; }
      static fromPolygons(polygons){ const c=new CSG(); c.polygons=polygons; return c; }
      union(csg){
        const a=new Node(this.clone().polygons), b=new Node(csg.clone().polygons);
        a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
        a.build(b.allPolygons()); return CSG.fromPolygons(a.allPolygons());
      }
      subtract(csg){
        const a=new Node(this.clone().polygons), b=new Node(csg.clone().polygons);
        a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
        a.build(b.allPolygons()); a.invert(); return CSG.fromPolygons(a.allPolygons());
      }
      intersect(csg){
        const a=new Node(this.clone().polygons), b=new Node(csg.clone().polygons);
        a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a);
        a.build(b.allPolygons()); a.invert(); return CSG.fromPolygons(a.allPolygons());
      }

      // ── THREE.js bridges ────────────────────────────────────────────
      // Triplanar UV fallback for geometry that has no real UVs (or lost them to a
      // previous boolean/sculpt step): project each vertex onto whichever axis
      // plane its normal faces most directly, scaled down into a sane repeat
      // range. Not a "correct" unwrap, but it guarantees every exported mesh
      // carries *some* valid UV set, which is what Procreate (and other OBJ
      // importers that reject UV-less models) require.
      static _triplanarUV(p, n){
        const ax=Math.abs(n.x), ay=Math.abs(n.y), az=Math.abs(n.z);
        const s = 0.01; // world units (mm) -> UV space
        if(ax>=ay && ax>=az) return { x: p.y*s, y: p.z*s };
        if(ay>=ax && ay>=az) return { x: p.x*s, y: p.z*s };
        return { x: p.x*s, y: p.y*s };
      }

      static fromMesh(mesh){
        mesh.updateMatrixWorld(true);
        const geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geom.attributes.position;
        const nrm = geom.attributes.normal;
        const colAttr = geom.attributes.color;
        const uvAttr = geom.attributes.uv;
        const m = mesh.matrixWorld;
        const nm = new THREE.Matrix3().getNormalMatrix(m);
        // Fallback colour for meshes with no per-vertex paint: their material's
        // own solid colour, so a plain coloured solid still carries its colour
        // through the boolean instead of losing it to whichever object happens
        // to donate the result's material.
        let fallback = new Vec(1,1,1);
        if (!Array.isArray(mesh.material) && mesh.material && mesh.material.color) {
          const c = mesh.material.color; fallback = new Vec(c.r, c.g, c.b);
        }
        const polygons=[];
        for(let i=0;i<pos.count;i+=3){
          const verts=[];
          for(let j=0;j<3;j++){
            const idx=i+j;
            const vp=new THREE.Vector3().fromBufferAttribute(pos, idx).applyMatrix4(m);
            let vn;
            if(nrm){ vn=new THREE.Vector3().fromBufferAttribute(nrm, idx).applyMatrix3(nm).normalize(); }
            else { vn=new THREE.Vector3(0,0,1); }
            const vc = colAttr ? new Vec(colAttr.getX(idx), colAttr.getY(idx), colAttr.getZ(idx)) : fallback;
            const vuv = uvAttr ? { x: uvAttr.getX(idx), y: uvAttr.getY(idx) } : CSG._triplanarUV(vp, vn);
            verts.push(new Vertex(new Vec(vp.x,vp.y,vp.z), new Vec(vn.x,vn.y,vn.z), vc, vuv));
          }
          // Skip degenerate triangles — ones with effectively no area.
          //
          // This is the single biggest reliability fix in the 3D side. A cone from
          // three.js has 24 zero-area triangles out of 72: the whole apex is a fan
          // of slivers collapsing to one point. A BSP solver can't derive a plane
          // from a triangle with no area, so those slivers produced garbage split
          // planes that shredded the tree — which is why cones failed at booleans,
          // why "slice then fillet" lost edges, and why mold generation collapsed
          // on anything pointed. Dropping them costs nothing (they enclose no
          // volume and are invisible) and takes cone-vs-cone from 0/3 operations
          // succeeding to 3/3.
          const p0 = verts[0].pos, p1 = verts[1].pos, p2 = verts[2].pos;
          const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
          const wx = p2.x - p0.x, wy = p2.y - p0.y, wz = p2.z - p0.z;
          const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
          if ((cx*cx + cy*cy + cz*cz) < 1e-16) continue;   // area ~ 0, no usable plane
          polygons.push(new Polygon(verts));
        }
        return CSG.fromPolygons(polygons);
      }


      // Close T-junctions left by BSP splitting. Where one side of a seam was
      // cut into short pieces and the other side wasn't, the long edge and the
      // short ones only meet at their ends — the surface has hairline cracks
      // (visible as sparkles on flat faces) and slicers report non-manifold
      // edges. Each long edge gets the missing vertices inserted and its
      // triangle re-fanned, so both sides share exactly the same edge chain.
      static _fixTJunctions(P, C, U) {
        const triN = P.length / 9;
        if (!triN) return { P, C, U, fixed: 0 };
        // Weld to 0.1 µm, looking in neighbouring cells too so two copies of
        // the same point that straddle a rounding boundary still merge.
        const Q = 1e4;
        const vid = new Map(), vx = [];
        const idOf = (x, y, z) => {
          const ix = Math.round(x * Q), iy = Math.round(y * Q), iz = Math.round(z * Q);
          let id = vid.get(ix + ',' + iy + ',' + iz);
          if (id !== undefined) return id;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
            if (!a && !b && !c) continue;
            const j = vid.get((ix + a) + ',' + (iy + b) + ',' + (iz + c));
            if (j !== undefined && Math.abs(vx[j * 3] - x) < 1.5 / Q && Math.abs(vx[j * 3 + 1] - y) < 1.5 / Q && Math.abs(vx[j * 3 + 2] - z) < 1.5 / Q) {
              vid.set(ix + ',' + iy + ',' + iz, j); return j;
            }
          }
          id = vx.length / 3; vid.set(ix + ',' + iy + ',' + iz, id); vx.push(x, y, z);
          return id;
        };
        const T = new Int32Array(triN * 3);
        for (let i = 0; i < triN * 3; i++) T[i] = idOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const SH = 4194304;
        const ek = (a, b) => a < b ? a * SH + b : b * SH + a;
        const cnt = new Map();
        for (let t = 0; t < triN; t++) for (let e = 0; e < 3; e++) {
          const k = ek(T[t * 3 + e], T[t * 3 + (e + 1) % 3]);
          cnt.set(k, (cnt.get(k) || 0) + 1);
        }
        // Bucket every once-used edge by the infinite line it lies on, under two
        // staggered quantisation grids so near-boundary values still meet.
        const buckets = new Map();
        const open = [];
        cnt.forEach((n, k) => {
          if (n !== 1) return;
          const a = Math.floor(k / SH), b = k - a * SH;
          let dx = vx[b * 3] - vx[a * 3], dy = vx[b * 3 + 1] - vx[a * 3 + 1], dz = vx[b * 3 + 2] - vx[a * 3 + 2];
          const L = Math.hypot(dx, dy, dz); if (L < 1e-9) return;
          dx /= L; dy /= L; dz /= L;
          if (dx < -1e-6 || (Math.abs(dx) <= 1e-6 && (dy < -1e-6 || (Math.abs(dy) <= 1e-6 && dz < 0)))) { dx = -dx; dy = -dy; dz = -dz; }
          const t0 = vx[a * 3] * dx + vx[a * 3 + 1] * dy + vx[a * 3 + 2] * dz;
          const ox = vx[a * 3] - dx * t0, oy = vx[a * 3 + 1] - dy * t0, oz = vx[a * 3 + 2] - dz * t0;
          const rec = { a, b, dx, dy, dz };
          open.push(rec);
          for (const sh of [0, 0.5]) {
            const key = sh + '|' + Math.round(dx * 400 + sh) + ',' + Math.round(dy * 400 + sh) + ',' + Math.round(dz * 400 + sh) + '|' +
                        Math.round(ox * 40 + sh) + ',' + Math.round(oy * 40 + sh) + ',' + Math.round(oz * 40 + sh);
            let arr = buckets.get(key); if (!arr) { arr = []; buckets.set(key, arr); }
            arr.push(rec);
            (rec.keys || (rec.keys = [])).push(key);
          }
        });

        // For each open edge, the vertices of collinear open edges that fall
        // strictly inside it are the missing split points.
        const splits = new Map();   // edge key -> [vertex ids]
        let fixed = 0;
        for (const r of open) {
          const ax = vx[r.a * 3], ay = vx[r.a * 3 + 1], az = vx[r.a * 3 + 2];
          const ex = vx[r.b * 3] - ax, ey = vx[r.b * 3 + 1] - ay, ez = vx[r.b * 3 + 2] - az;
          const L2 = ex * ex + ey * ey + ez * ez;
          const tol = Math.max(1e-4, Math.sqrt(L2) * 1e-5);
          const got = new Set();
          for (const key of r.keys) for (const o of buckets.get(key)) {
            if (o === r) continue;
            for (const v of [o.a, o.b]) {
              if (v === r.a || v === r.b || got.has(v)) continue;
              const px = vx[v * 3] - ax, py = vx[v * 3 + 1] - ay, pz = vx[v * 3 + 2] - az;
              const s = (px * ex + py * ey + pz * ez) / L2;
              if (s <= 1e-6 || s >= 1 - 1e-6) continue;
              const qx = px - ex * s, qy = py - ey * s, qz = pz - ez * s;
              if (qx * qx + qy * qy + qz * qz > tol * tol) continue;
              got.add(v);
            }
          }
          if (got.size) { splits.set(ek(r.a, r.b), [...got]); fixed += got.size; }
        }

        const nP = [], nC = [], nU = [];
        const push = (p, c, u) => { nP.push(p[0], p[1], p[2]); nC.push(c[0], c[1], c[2]); nU.push(u[0], u[1]); };
        for (let t = 0; t < triN; t++) {
          const ids = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
          if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;   // collapsed by the weld
          const ins = [0, 1, 2].map(e => splits.get(ek(ids[e], ids[(e + 1) % 3])) || null);
          const vi = (i) => T[t * 3 + i];
          const corner = (i) => ({ p: [vx[vi(i) * 3], vx[vi(i) * 3 + 1], vx[vi(i) * 3 + 2]],
                                   c: [C[(t * 3 + i) * 3], C[(t * 3 + i) * 3 + 1], C[(t * 3 + i) * 3 + 2]],
                                   u: [U[(t * 3 + i) * 2], U[(t * 3 + i) * 2 + 1]] });
          const K = [corner(0), corner(1), corner(2)];
          if (!ins[0] && !ins[1] && !ins[2]) { K.forEach(k => push(k.p, k.c, k.u)); continue; }
          // Build the boundary loop with the new points in order along each edge.
          const loop = [];
          const lerp = (A, B, s) => A.map((v, i) => v + (B[i] - v) * s);
          for (let e = 0; e < 3; e++) {
            const A = K[e], B = K[(e + 1) % 3];
            loop.push(Object.assign({ corner: e }, A));
            if (!ins[e]) continue;
            const ex = B.p[0] - A.p[0], ey = B.p[1] - A.p[1], ez = B.p[2] - A.p[2];
            const L2 = ex * ex + ey * ey + ez * ez;
            ins[e].map(v => {
              const p = [vx[v * 3], vx[v * 3 + 1], vx[v * 3 + 2]];
              return { s: ((p[0] - A.p[0]) * ex + (p[1] - A.p[1]) * ey + (p[2] - A.p[2]) * ez) / L2, p };
            }).sort((m, n) => m.s - n.s).forEach(q => loop.push({ p: q.p, c: lerp(A.c, B.c, q.s), u: lerp(A.u, B.u, q.s) }));
          }
          // Fan from a corner whose two edges weren't split (no slivers), else
          // from a new centre point.
          let origin = -1;
          for (let e = 0; e < 3; e++) if (!ins[e] && !ins[(e + 2) % 3]) { origin = e; break; }
          if (origin >= 0) {
            const oi = loop.findIndex(l => l.corner === origin);
            const O = loop[oi];
            for (let j = 1; j < loop.length - 1; j++) {
              const A = loop[(oi + j) % loop.length], B = loop[(oi + j + 1) % loop.length];
              push(O.p, O.c, O.u); push(A.p, A.c, A.u); push(B.p, B.c, B.u);
            }
          } else {
            const avg = (key) => K[0][key].map((v, i) => (v + K[1][key][i] + K[2][key][i]) / 3);
            const G = { p: avg('p'), c: avg('c'), u: avg('u') };
            for (let j = 0; j < loop.length; j++) {
              const A = loop[j], B = loop[(j + 1) % loop.length];
              push(G.p, G.c, G.u); push(A.p, A.c, A.u); push(B.p, B.c, B.u);
            }
          }
        }
        return { P: nP, C: nC, U: nU, fixed };
      }

      // Returns a world-space BufferGeometry (caller recenters into a mesh).
      static toGeometry(csg){
        const positions=[], normals=[], colors=[], uvs=[];
        for(const poly of csg.polygons){
          const vs=poly.vertices;
          for(let i=2;i<vs.length;i++){
            const tri=[vs[0], vs[i-1], vs[i]];
            // Skip slivers: near-zero-area triangles are a normal by-product of
            // BSP plane splitting at boolean seams, and left in they're a common
            // cause of slicers (e.g. Bambu Studio) flagging "non-manifold edges".
            const ab = tri[1].pos.minus(tri[0].pos), ac = tri[2].pos.minus(tri[0].pos);
            if (ab.cross(ac).length() < 1e-8) continue;
            for(const v of tri){
              positions.push(v.pos.x, v.pos.y, v.pos.z);
              normals.push(v.normal.x, v.normal.y, v.normal.z);
              colors.push(v.color.x, v.color.y, v.color.z);
              uvs.push(v.uv.x, v.uv.y);
            }
          }
        }
        const g=new THREE.BufferGeometry();
        let P = positions, Cc = colors, Uu = uvs;
        try {
          // A second pass catches the rare chain where an inserted point
          // itself lands on another long edge.
          for (let pass = 0; pass < 3; pass++) {
            const r = CSG._fixTJunctions(P, Cc, Uu);
            P = r.P; Cc = r.C; Uu = r.U;
            if (!r.fixed) break;
          }
        } catch (e) { console.warn('T-junction repair skipped', e); }
        g.setAttribute('position', new THREE.Float32BufferAttribute(P,3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(Cc,3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(Uu,2));
        g.computeVertexNormals();   // flat per-face normals (non-indexed)
        return g;
      }
    }

    window.CSGEngine = CSG;
    window.CSGEngine.triplanarUV = CSG._triplanarUV;
  })();
  