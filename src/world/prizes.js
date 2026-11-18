// 奖品场：布局（纯函数，node 可测）和奖品模型（THREE 由 main.js 传入，这里不 import）。
// 模型按类型各建一份原型，每个奖品只 clone，几何和材质共用；只有套中的那个才复制材质去发光。

const BASE_H = 0.018; // 木底座的厚度，算在奖品的 h 里面

let nextId = 0; // 模块级计数：每次布局的 id 都不重复，跨轮次也一样

function pickType(types, tune, total, u) {
  const want = u * total;
  let acc = 0;
  for (const k of types) {
    acc += tune.prizes[k].weight;
    if (want < acc) return k;
  }
  return types[types.length - 1];
}

// 纯函数：不碰 THREE、DOM。rand 默认 Math.random，测试里传入带种子的版本。
export function layoutField(tune, rand = Math.random) {
  const { cols, rows, spacingX, nearZ, spacingZ, jitter } = tune.field;
  const types = Object.keys(tune.prizes);
  const total = types.reduce((s, k) => s + tune.prizes[k].weight, 0);
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const type = pickType(types, tune, total, rand());
      const def = tune.prizes[type];
      // 以 x=0 为中心排开；抖动让格子看起来不像印出来的
      const x = (col - (cols - 1) / 2) * spacingX + (rand() * 2 - 1) * jitter;
      const z = nearZ - row * spacingZ + (rand() * 2 - 1) * jitter;
      out.push({
        id: `p${nextId++}`,
        type,
        x,
        z,
        r: def.r,
        h: def.h,
        score: def.score,
        effect: def.effect ?? null,
        alive: true,
      });
    }
  }
  return out;
}

// 模型统一用「单位尺寸」建：footprint 半径 unitR、总高 unitH。
// 放进格子时取 s = min(r/unitR, mh/unitH)，保证既不超出半径也不超出 h。
function at(mesh, p, rot = [0, 0, 0], scl = [1, 1, 1]) {
  mesh.position.set(p[0], p[1], p[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.scale.set(scl[0], scl[1], scl[2]);
  mesh.castShadow = true;
  return mesh;
}

function makeMaterials(THREE) {
  const std = (p) => new THREE.MeshStandardMaterial(p);
  return {
    enamel: std({ color: 0xe7e2d6, roughness: 0.32 }),
    tea: std({ color: 0x5a2e14, roughness: 0.35 }),
    red: std({ color: 0xa8201a, roughness: 0.5 }),
    // 玻璃：透明材质，不用 transmission（移动端太重）
    glass: new THREE.MeshStandardMaterial({
      color: 0x2f7d4f,
      roughness: 0.12,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
    label: std({ color: 0xc8282a, roughness: 0.6, side: THREE.DoubleSide }),
    cat: std({ color: 0xf2efe6, roughness: 0.5 }),
    // 金色材质没有环境贴图，金属度太高会发黑，所以金属度压低、加一点自发光
    gold: std({
      color: 0xe0ac38,
      metalness: 0.45,
      roughness: 0.38,
      emissive: 0x6a4a10,
      emissiveIntensity: 0.15,
    }),
    brass: std({
      color: 0xc08a2e,
      metalness: 0.5,
      roughness: 0.35,
      emissive: 0x4a3008,
      emissiveIntensity: 0.1,
    }),
    wood: std({ color: 0x7a4f2b, roughness: 0.75 }),
    woodDark: std({ color: 0x4a2c18, roughness: 0.85 }),
    fuse: std({ color: 0xd8c48a, roughness: 0.6 }),
    tan: std({ color: 0xc9a46a, roughness: 0.7 }),
  };
}

// 每种奖品的单位模型，返回 { group, unitR, unitH }
const BUILDERS = {
  cup(T, M) {
    const g = new T.Group();
    g.add(
      at(
        new T.Mesh(new T.CylinderGeometry(0.42, 0.4, 1, 24), M.enamel),
        [0, 0.5, 0],
      ),
    );
    g.add(
      at(
        new T.Mesh(
          new T.CylinderGeometry(0.43, 0.43, 0.14, 24, 1, true),
          M.red,
        ),
        [0, 0.3, 0],
      ),
    );
    const tea = new T.Mesh(new T.CircleGeometry(0.4, 24), M.tea);
    g.add(at(tea, [0, 1, 0], [-Math.PI / 2, 0, 0]));
    // 把手在 XY 平面里，从正面看是一个环
    g.add(
      at(
        new T.Mesh(new T.TorusGeometry(0.2, 0.055, 8, 16), M.enamel),
        [0.58, 0.55, 0],
      ),
    );
    return { group: g, unitR: 0.42, unitH: 1 };
  },

  bottle(T, M) {
    const pts = [
      [0, 0],
      [0.18, 0],
      [0.21, 0.04],
      [0.22, 0.12],
      [0.22, 0.3],
      [0.16, 0.42],
      [0.07, 0.5],
      [0.07, 0.9],
      [0.09, 0.94],
      [0.09, 1],
      [0, 1],
    ].map(([x, y]) => new T.Vector2(x, y));
    const g = new T.Group();
    g.add(at(new T.Mesh(new T.LatheGeometry(pts, 20), M.glass), [0, 0, 0]));
    g.add(
      at(
        new T.Mesh(
          new T.CylinderGeometry(0.222, 0.222, 0.18, 20, 1, true),
          M.label,
        ),
        [0, 0.2, 0],
      ),
    );
    g.add(
      at(
        new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.06, 16), M.red),
        [0, 1.0, 0],
      ),
    );
    return { group: g, unitR: 0.22, unitH: 1 };
  },

  // 招财猫：身子、脑袋、耳朵、举起的爪、红项圈、金币
  cat(T, M) {
    const g = new T.Group();
    g.add(
      at(
        new T.Mesh(new T.SphereGeometry(0.3, 20, 14), M.cat),
        [0, 0.33, 0],
        [0, 0, 0],
        [1, 1.1, 1],
      ),
    );
    g.add(
      at(new T.Mesh(new T.SphereGeometry(0.2, 16, 12), M.cat), [0, 0.72, 0]),
    );
    for (const sx of [-1, 1]) {
      g.add(
        at(
          new T.Mesh(new T.ConeGeometry(0.07, 0.14, 12), M.cat),
          [sx * 0.11, 0.92, 0],
          [0, 0, -sx * 0.25],
        ),
      );
    }
    g.add(
      at(
        new T.Mesh(new T.SphereGeometry(0.07, 12, 10), M.cat),
        [0.24, 0.68, 0.06],
      ),
    );
    g.add(
      at(
        new T.Mesh(new T.TorusGeometry(0.22, 0.05, 8, 20), M.red),
        [0, 0.54, 0],
        [Math.PI / 2, 0, 0],
      ),
    );
    g.add(
      at(
        new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.03, 20), M.gold),
        [0, 0.36, 0.3],
        [Math.PI / 2, 0, 0],
      ),
    );
    return { group: g, unitR: 0.3, unitH: 1 };
  },

  // 金猪存钱罐
  pig(T, M) {
    const g = new T.Group();
    g.add(
      at(
        new T.Mesh(new T.SphereGeometry(0.45, 20, 14), M.gold),
        [0, 0.6, 0],
        [0, 0, 0],
        [1.25, 1, 1],
      ),
    );
    g.add(
      at(
        new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.1, 12), M.gold),
        [0.56, 0.6, 0],
        [0, 0, Math.PI / 2],
      ),
    );
    for (const sx of [-1, 1]) {
      g.add(
        at(new T.Mesh(new T.ConeGeometry(0.1, 0.18, 4), M.gold), [
          sx * 0.28,
          0.92,
          0.2,
        ]),
      );
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        g.add(
          at(new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.22, 10), M.gold), [
            sx * 0.3,
            0.11,
            sz * 0.22,
          ]),
        );
      }
    }
    g.add(
      at(
        new T.Mesh(new T.BoxGeometry(0.14, 0.02, 0.04), M.woodDark),
        [0, 1.045, 0],
      ),
    );
    g.add(
      at(
        new T.Mesh(new T.TorusGeometry(0.06, 0.02, 6, 12), M.gold),
        [-0.56, 0.66, 0],
        [0, Math.PI / 2, 0],
      ),
    );
    return { group: g, unitR: 0.56, unitH: 1.05 };
  },

  // 一把鞭炮：五根红筒、金纸腰封、引信
  firecracker(T, M) {
    const g = new T.Group();
    const stick = (x, z) =>
      at(new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 1, 14), M.red), [
        x,
        0.5,
        z,
      ]);
    g.add(
      stick(0, 0),
      stick(0.15, 0),
      stick(-0.15, 0),
      stick(0, 0.15),
      stick(0, -0.15),
    );
    for (const y of [0.25, 0.75]) {
      g.add(
        at(new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.1, 16), M.gold), [
          0,
          y,
          0,
        ]),
      );
    }
    g.add(
      at(
        new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 0.14, 6), M.fuse),
        [0, 1.07, 0],
      ),
    );
    return { group: g, unitR: 0.3, unitH: 1.14 };
  },

  // 小铜锣：平放在一圈木架上（h 只有 8 cm，只能是扁的）
  gong(T, M) {
    const g = new T.Group();
    g.add(
      at(
        new T.Mesh(new T.TorusGeometry(0.7, 0.07, 8, 24), M.wood),
        [0, 0.1, 0],
        [Math.PI / 2, 0, 0],
      ),
    );
    g.add(
      at(
        new T.Mesh(new T.CylinderGeometry(1, 1, 0.1, 32), M.brass),
        [0, 0.2, 0],
      ),
    );
    g.add(
      at(
        new T.Mesh(new T.SphereGeometry(0.3, 16, 10), M.brass),
        [0, 0.25, 0],
        [0, 0, 0],
        [1, 0.4, 1],
      ),
    );
    return { group: g, unitR: 1, unitH: 0.37 };
  },
};

export function createPrizes(THREE, scene, tune) {
  const mats = makeMaterials(THREE);
  const protos = {};
  for (const type of Object.keys(BUILDERS))
    protos[type] = BUILDERS[type](THREE, mats);
  const baseGeo = new THREE.BoxGeometry(1, 1, 1); // 每个底座用 scale 变成正方形薄片
  const field = new THREE.Group();
  scene.add(field);

  const live = new Map(); // id -> { group, body, s, own: [cloned materials] }
  const anims = new Map(); // id -> { rec, t }
  const HOP = 0.6; // 跳起并发光的时长
  const SHRINK = 0.35; // 之后缩没

  function disposeOwn(rec) {
    for (const m of rec.own) m.dispose();
    rec.own.length = 0;
  }

  function removeRec(id) {
    const rec = live.get(id);
    if (!rec) return;
    field.remove(rec.group);
    disposeOwn(rec);
    live.delete(id);
    anims.delete(id);
  }

  function setField(list) {
    for (const id of [...live.keys()]) removeRec(id);
    for (const p of list) {
      const proto = protos[p.type] || protos.cup;
      const mh = Math.max(p.h - BASE_H, 0.01);
      const s = Math.min(p.r / proto.unitR, mh / proto.unitH);

      const group = new THREE.Group();
      group.position.set(p.x, 0, p.z);

      // 木底座：边长 1.8 r，厚 BASE_H
      const base = new THREE.Mesh(baseGeo, mats.woodDark);
      base.scale.set(p.r * 1.8, BASE_H, p.r * 1.8);
      base.position.y = BASE_H / 2;
      base.receiveShadow = true;
      group.add(base);

      const body = proto.group.clone();
      body.scale.setScalar(s);
      body.position.y = BASE_H;
      group.add(body);

      field.add(group);
      live.set(p.id, { group, body, s, own: [] });
    }
  }

  // 套中：跳一下、发光，然后缩没
  function ringed(id) {
    const rec = live.get(id);
    if (!rec || anims.has(id)) return;
    // 只有这一个奖品要发光，所以先复制它自己的材质，别影响同类的其它奖品
    rec.body.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        rec.own.push(o.material);
      }
    });
    anims.set(id, { rec, t: 0 });
  }

  function update(dt, time) {
    // 金色和黄铜的轻微闪动（共用材质，所以所有金器一起闪）
    mats.gold.emissiveIntensity = 0.12 + 0.08 * Math.sin(time * 1.4);
    mats.brass.emissiveIntensity = 0.08 + 0.05 * Math.sin(time * 1.4 + 0.8);

    for (const [id, a] of anims) {
      a.t += dt;
      const { rec } = a;
      if (a.t < HOP) {
        const k = a.t / HOP;
        rec.group.position.y = Math.sin(k * Math.PI) * 0.09;
        rec.body.rotation.y = k * Math.PI * 1.2;
        const glow = 1.2 * (0.55 + 0.45 * Math.sin(a.t * 26)) * (1 - 0.3 * k);
        for (const m of rec.own) {
          m.emissive.setHex(0xffc860);
          m.emissiveIntensity = glow;
        }
      } else {
        const k = (a.t - HOP) / SHRINK;
        if (k >= 1) {
          removeRec(id);
          continue;
        }
        rec.group.position.y = 0;
        rec.group.scale.setScalar(Math.max(0, 1 - k * k));
        for (const m of rec.own) m.emissiveIntensity = 1.2 * (1 - k);
      }
    }
  }

  function dispose() {
    for (const id of [...live.keys()]) removeRec(id);
    scene.remove(field);
    for (const type of Object.keys(protos)) {
      protos[type].group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    baseGeo.dispose();
    for (const m of Object.values(mats)) m.dispose();
  }

  return { setField, ringed, update, dispose };
}
