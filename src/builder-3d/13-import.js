      // ═══════════════════════════════════════════════════════════════════════════
      //   IMPORT  (STL binary/ascii · OBJ · 3MF)
      // ═══════════════════════════════════════════════════════════════════════════
      function addImportedGeometry(geometry, name) {
        geometry = makeGeometryCSGReady(geometry);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45 }));
        recenterMeshTransform(mesh);
        mesh.userData.name = String(name).replace(/\.[^.]+$/, '');   // label it after the file; split parts build on this
        mesh.position.z = Math.max(mesh.position.z, 10);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); objects.push(mesh);
        selected.forEach(o=>setEmissive(o,0x000000));
        selected=[mesh]; setEmissive(mesh,0x0e3d44); attachGizmoTarget(mesh);
        saveHistory(); updateStatus(); updateFloatingHUD();
        // Tell the user when the file is really several loose pieces, since Ungroup
        // can split them. Skipped on very dense meshes so a big import stays instant.
        let loose = 0;
        try { if (geometry.attributes.position.count <= 450000) loose = countLooseShells(geometry); } catch (e) {}
        banner(loose > 1 ? `Imported ${name} \u2014 it has ${loose} separate parts. Use Modify \u2192 Ungroup to split them.`
                         : `Imported ${name}.`);
      }

      // Same idea as addImportedGeometry, but for a multi-part 3MF: clamps the
      // WHOLE group above the build plate together (by the same amount), so
      // parts that are meant to sit at different relative heights — like a
      // multi-piece assembly — don't each get independently snapped to Z=10
      // and end up flattened onto one plane.
      function addImportedGeometryParts(parts, baseName) {
        const meshes = parts.map(({ geometry, name }) => {
          geometry = makeGeometryCSGReady(geometry);
          const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8a9bb8, roughness: 0.45 }));
          recenterMeshTransform(mesh);
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.name = name;
          return mesh;
        });

        let minZ = Infinity;
        meshes.forEach(m => { const box = new THREE.Box3().setFromObject(m); if (isFinite(box.min.z)) minZ = Math.min(minZ, box.min.z); });
        const lift = isFinite(minZ) ? Math.max(0, 10 - minZ) : 0;
        meshes.forEach(m => { m.position.z += lift; scene.add(m); objects.push(m); });

        selected.forEach(o => setEmissive(o, 0x000000));
        selected = meshes.slice();
        selected.forEach(m => setEmissive(m, 0x0e3d44));
        if (meshes.length) attachGizmoTarget(meshes[0]);
        saveHistory(); updateStatus(); updateFloatingHUD();
        banner(`Imported ${meshes.length} separate objects from ${baseName}.`);
      }

