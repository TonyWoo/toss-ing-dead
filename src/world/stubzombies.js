// Stand-in zombies built from boxes, used only when the character models fail to load,
// so a run never has dead that grab you without being drawn. Same surface as zombies.js.
const POS_RATE = 14; // 1/s, how fast the drawn position follows the rules

export function createStubZombies(THREE, scene) {
  const skin = new THREE.MeshStandardMaterial({
    color: 0x7d8a6a,
    emissive: 0x2a3024,
    roughness: 0.9,
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: 0x3b3440,
    emissive: 0x16121a,
    roughness: 0.95,
  });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };
  const recs = new Map();

  function make() {
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.add(box(0.42, 0.62, 0.24, cloth, 0, 1.18, 0)); // torso
    body.add(box(0.24, 0.26, 0.24, skin, 0, 1.64, 0.02)); // head
    // arms reach forward (+Z, toward the stall)
    body.add(box(0.1, 0.1, 0.55, skin, -0.26, 1.36, 0.27));
    body.add(box(0.1, 0.1, 0.55, skin, 0.26, 1.36, 0.27));
    g.add(body);
    const legL = box(0.15, 0.86, 0.17, cloth, -0.11, 0.43, 0);
    const legR = box(0.15, 0.86, 0.17, cloth, 0.11, 0.43, 0);
    g.add(legL, legR);
    scene.add(g);
    return { g, body, legL, legR, t: Math.random() * 6, x: 0, z: 0 };
  }

  return {
    sync(list, dt) {
      const seen = new Set();
      for (const z of list) {
        seen.add(z.id);
        let r = recs.get(z.id);
        if (!r) {
          r = make();
          r.x = z.x;
          r.z = z.z;
          recs.set(z.id, r);
        }
        const k = 1 - Math.exp(-POS_RATE * dt);
        r.x += (z.x - r.x) * k;
        r.z += (z.z - r.z) * k;
        const moving = z.state === "walk" || z.state === "lunge";
        r.t += dt * (z.state === "lunge" ? 9 : moving ? 5 : 0);
        const swing = Math.sin(r.t) * 0.35;
        r.legL.rotation.x = swing;
        r.legR.rotation.x = -swing;
        r.body.rotation.x = z.state === "lunge" ? 0.25 : 0.08;
        r.g.position.set(r.x, Math.abs(Math.cos(r.t)) * 0.03, r.z);
        r.g.lookAt(0, 0, 0);
      }
      for (const [id, r] of recs)
        if (!seen.has(id)) {
          scene.remove(r.g);
          recs.delete(id);
        }
    },
    clear() {
      for (const r of recs.values()) scene.remove(r.g);
      recs.clear();
    },
  };
}
