// 雨夜街景、摊子、灯和雨。THREE 由 main.js 传入（这里不 import），和 prizes.js 用的是同一份。
// 几何和贴图全部程序生成，不加载外部素材；固定种子，每次打开街景都一样。

const FOG_COLOR = 0x1a1530; // 蓝紫色雾；背景同色，远处的雾直接融进天空
const FOG_DENSITY = 0.028;
const STREET_END = -40;
const WALK_OUTER = 5.2; // 店面从人行道外沿开始
const CURB = 0.14;
const LIT = ["#ffd27a", "#ff9a4a", "#fff0c4", "#ff6a3c", "#ffb55a"];
const WALLS = [
  { wall: "#4a2f2a", trim: "#26180f" },
  { wall: "#2f3a47", trim: "#1a2029" },
  { wall: "#5a4a2a", trim: "#2b2416" },
  { wall: "#2e3b34", trim: "#18201c" },
];
// 霓虹招牌：贴在店面上，朝向街心
const SIGNS = [
  { text: "金龍茶樓", color: "#ff3b2a", side: -1, z: -7 },
  { text: "按摩", color: "#ffd64a", side: 1, z: -12, flicker: true },
  { text: "燒臘", color: "#ff7a1f", side: -1, z: -17 },
  { text: "茶餐", color: "#7ff0d0", side: 1, z: -22 },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(THREE, c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

// 贴图边缘要能接上，所以在四周的重复位置也画一遍
function wrapped(S, x, y, draw) {
  for (const dx of [-S, 0, S])
    for (const dy of [-S, 0, S]) draw(x + dx, y + dy);
}

// 低端机用 low：不开阴影、像素比封顶 1.5、雨和溅水减半
function detectQuality() {
  if (typeof window === "undefined") return "high";
  const coarse =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 800;
  return coarse || small ? "low" : "high";
}

function groundCanvases(rand) {
  const S = 512;
  const rough = canvas(S, S);
  const color = canvas(S, S);
  const rg = rough.getContext("2d");
  const cg = color.getContext("2d");
  // 粗糙度贴图的绿通道乘以材质粗糙度 1，所以 #404040 ≈ 0.25，是沥青的底子
  rg.fillStyle = "#404040";
  rg.fillRect(0, 0, S, S);
  cg.fillStyle = "#1d1f26";
  cg.fillRect(0, 0, S, S);
  for (let i = 0; i < 3000; i++) {
    const v = 22 + Math.floor(rand() * 26);
    cg.fillStyle = `rgb(${v},${v},${v + 5})`;
    cg.fillRect(rand() * S, rand() * S, 1.5, 1.5);
  }
  // 积水：粗糙度图里很暗（接近镜面），颜色偏蓝，映出街灯
  for (let i = 0; i < 46; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 8 + rand() * 38;
    const ry = rx * (0.35 + rand() * 0.35);
    wrapped(S, x, y, (px, py) => {
      rg.fillStyle = "#0c0c0c";
      rg.beginPath();
      rg.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      rg.fill();
      cg.fillStyle = "#2a3446";
      cg.beginPath();
      cg.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      cg.fill();
    });
  }
  // 裂缝：更粗糙、更暗
  for (let i = 0; i < 36; i++) {
    let x = rand() * S;
    let y = rand() * S;
    rg.strokeStyle = "#9a9a9a";
    cg.strokeStyle = "#0a0b0e";
    rg.lineWidth = cg.lineWidth = 1 + rand() * 1.5;
    rg.beginPath();
    cg.beginPath();
    rg.moveTo(x, y);
    cg.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rand() - 0.5) * 40;
      y += rand() * 30;
      rg.lineTo(x, y);
      cg.lineTo(x, y);
    }
    rg.stroke();
    cg.stroke();
  }
  return { rough, color };
}

function facadeTextures(THREE, wall, rand) {
  const S = 256;
  const map = canvas(S, S);
  const em = canvas(S, S);
  const m = map.getContext("2d");
  const e = em.getContext("2d");
  m.fillStyle = wall.wall;
  m.fillRect(0, 0, S, S);
  e.fillStyle = "#000";
  e.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    m.fillStyle = `rgba(0,0,0,${rand() * 0.12})`;
    m.fillRect(rand() * S, rand() * S, 2, 2);
  }
  // 每块 256 贴图 2×2 扇窗；亮窗只写进自发光图，暗窗写进颜色图
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 2; row++) {
      const x = col * 128 + 28;
      const y = row * 128 + 24;
      const w = 72;
      const h = 80;
      m.fillStyle = "#0b0d14";
      m.fillRect(x, y, w, h);
      m.fillStyle = wall.trim;
      m.fillRect(x - 5, y + h, w + 10, 6);
      if (rand() < 0.45) {
        const c = LIT[Math.floor(rand() * LIT.length)];
        e.fillStyle = c;
        e.fillRect(x, y, w, h);
        m.globalAlpha = 0.35;
        m.fillStyle = c;
        m.fillRect(x, y, w, h);
        m.globalAlpha = 1;
      }
    }
  }
  return { map: canvasTexture(THREE, map), em: canvasTexture(THREE, em) };
}

function signCanvas(text, color) {
  const c = canvas(512, 192);
  const g = c.getContext("2d");
  g.fillStyle = "#0a0505";
  g.fillRect(0, 0, 512, 192);
  const size = Math.min(124, Math.floor(430 / text.length));
  g.font = `bold ${size}px "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  // 先画带光晕的颜色，再压一层淡白的芯，像灯管
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;
  g.fillText(text, 256, 98);
  g.shadowBlur = 0;
  g.fillStyle = "rgba(255,240,220,0.35)";
  g.fillText(text, 256, 98);
  return c;
}

// 摊位手写的木牌
function boardCanvas() {
  const c = canvas(512, 160);
  const g = c.getContext("2d");
  g.fillStyle = "#4a2d1a";
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (let y = 40; y < 160; y += 40) g.fillRect(0, y, 512, 2);
  g.strokeStyle = "#f2e4bf";
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 140);
  g.font = `bold 66px "STKaiti", "KaiTi", "Kaiti SC", "Noto Serif CJK SC", serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#c8302a";
  g.fillText("套圈", 130, 84);
  g.fillStyle = "#f2e4bf";
  g.fillText("三圈十蚊", 372, 84);
  return c;
}

function awningCanvas() {
  // 红白竖条：列是条纹，条纹沿着棚面从前往后
  const c = canvas(256, 16);
  const g = c.getContext("2d");
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? "#f3efe6" : "#b3261e";
    g.fillRect(i * 16, 0, 16, 16);
  }
  return c;
}

function woodCanvas(rand) {
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#6a4426";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(20,10,4,${0.08 + rand() * 0.18})`;
    g.lineWidth = 0.6 + rand() * 1.6;
    const x = rand() * 256;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(
      x + (rand() - 0.5) * 18,
      85,
      x + (rand() - 0.5) * 18,
      170,
      x + (rand() - 0.5) * 10,
      256,
    );
    g.stroke();
  }
  return c;
}

function glowCanvas() {
  // 远端的橙色天光：上面深靛蓝，地平线处烧成橙
  const c = canvas(8, 256);
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#120e24");
  grd.addColorStop(0.5, "#2a1c3c");
  grd.addColorStop(0.74, "#7a3442");
  grd.addColorStop(0.8, "#ff7a2e");
  grd.addColorStop(0.9, "#ffb35a");
  grd.addColorStop(1, "#ffd28a");
  g.fillStyle = grd;
  g.fillRect(0, 0, 8, 256);
  return c;
}

export function createStage(THREE, scene, renderer) {
  const rand = mulberry32(20211);
  const quality = detectQuality();
  const high = quality === "high";

  // ---- renderer ----
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFShadowMap; // 软阴影采样更贵，手机上不划算；靠 radius 略微柔化

  // ---- camera ----
  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.05,
    240,
  );
  camera.position.set(0, 1.55, 0);
  camera.lookAt(0, 0.4, -5);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    // 像素比封顶：手机更容易掉帧，1.5 已经够清楚
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, quality === "low" ? 1.5 : 2),
    );
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  resize();
  window.addEventListener("resize", resize);

  // ---- fog and sky ----
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  scene.background = new THREE.Color(FOG_COLOR);

  // ---- ground: wet asphalt with puddles and cracks ----
  const gc = groundCanvases(rand);
  const groundMat = new THREE.MeshStandardMaterial({
    map: canvasTexture(THREE, gc.color, { repeat: [8, 18] }),
    roughnessMap: canvasTexture(THREE, gc.rough, {
      srgb: false,
      repeat: [8, 18],
    }),
    roughness: 1,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 110), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -30);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- sidewalks ----
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x3b3a45,
    roughness: 0.9,
  });
  const walkGeo = new THREE.BoxGeometry(1.2, CURB, 48);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(walkGeo, concrete);
    w.position.set(s * 4.6, CURB / 2, -21);
    w.receiveShadow = true;
    scene.add(w);
  }

  // ---- buildings: boxes of different heights with lit windows ----
  // 每栋自己一份贴图（克隆，共用同一张图源）：窗格大小一致，高矮不同
  const facades = WALLS.map((w) => facadeTextures(THREE, w, rand));
  function addBuilding(side, zc, len, depth, h, facade) {
    const map = facade.map.clone();
    map.repeat.set(len / 3, h / 3);
    map.needsUpdate = true; // 克隆出来的贴图要显式上传
    const em = facade.em.clone();
    em.repeat.set(len / 3, h / 3);
    em.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: em,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      roughness: 0.8,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(depth, h, len), mat);
    mesh.position.set(side * (WALK_OUTER + depth / 2), h / 2, zc);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const s of [-1, 1]) {
    let z = 4;
    while (z > STREET_END - 6) {
      if (rand() < 0.15) {
        z -= 2.2; // 小巷
        continue;
      }
      const len = 4 + rand() * 3.5;
      const depth = 6 + rand() * 3;
      const h = 5 + rand() * 13;
      addBuilding(
        s,
        z - len / 2,
        len,
        depth,
        h,
        facades[Math.floor(rand() * facades.length)],
      );
      z -= len;
    }
  }

  // ---- far skyline silhouettes and the dusk glow behind them ----
  // 天光不受雾影响（fog:false），僵尸走近时轮廓压在橙色上
  const silMat = new THREE.MeshStandardMaterial({
    color: 0x0c0b16,
    roughness: 1,
  });
  for (let i = 0; i < 16; i++) {
    const w = 5 + rand() * 5;
    const h = 6 + rand() * 12;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), silMat);
    m.position.set(-30 + i * 4 + rand() * 2, h / 2, -50 - rand() * 6);
    scene.add(m);
  }
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 40),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(THREE, glowCanvas()),
      fog: false,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  glow.position.set(0, 12, -68);
  scene.add(glow);

  // ---- neon signs on the facades (emissive planes) ----
  let flickerMat = null;
  for (const d of SIGNS) {
    const tex = canvasTexture(THREE, signCanvas(d.text, d.color));
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 1.3,
      roughness: 0.5,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), mat);
    m.position.set(d.side * (WALK_OUTER + 0.03), 3.3, d.z);
    m.rotation.y = (-d.side * Math.PI) / 2; // 法线朝街心
    scene.add(m);
    if (d.flicker) flickerMat = mat;
  }

  // ---- the stall ----
  // 摊台前沿在 z=-0.5，深 0.45，向远处（-Z）伸；玩家在原点，看见的是正面
  const stall = new THREE.Group();
  scene.add(stall);
  const woodMat = new THREE.MeshStandardMaterial({
    map: canvasTexture(THREE, woodCanvas(rand), { repeat: [2, 1] }),
    roughness: 0.7,
  });
  const darkWood = new THREE.MeshStandardMaterial({
    color: 0x3a2416,
    roughness: 0.8,
  });
  const paint = new THREE.MeshStandardMaterial({
    color: 0x7a1d1a,
    roughness: 0.55,
  });
  const awningMat = new THREE.MeshStandardMaterial({
    map: canvasTexture(THREE, awningCanvas(), { repeat: [1, 1] }),
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const bamboo = new THREE.MeshStandardMaterial({
    color: 0xc9a25a,
    roughness: 0.5,
  });

  function part(mesh, p, rot = [0, 0, 0]) {
    mesh.position.set(p[0], p[1], p[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;
    stall.add(mesh);
    return mesh;
  }

  // 摊台：深 0.32、宽 2.4、台面 0.85（压低，不挡奖品场）
  part(
    new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.82, 0.32), woodMat),
    [0, 0.41, -0.66],
  );
  part(
    new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.03, 0.36), darkWood),
    [0, 0.835, -0.66],
  );
  // 竹圈的箱子，放在台面右边
  part(
    new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.34), darkWood),
    [1.0, 0.92, -0.66],
  );
  for (let k = 0; k < 5; k++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.011, 8, 20),
      bamboo,
    );
    const jx = ((k * 37) % 5) * 0.004 - 0.008;
    part(ring, [1.0 + jx, 1.01 + k * 0.022, -0.66], [Math.PI / 2, 0, 0]);
  }

  // 两根柱子：前面两角，棚子的骨架
  for (const x of [-1.32, 1.32]) {
    part(
      new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.95, 8), paint),
      [x, 0.975, -0.42],
    );
  }

  // 棚子：前低后高，背面朝远处倾斜；只有远半截会进到视野上缘
  const awningLen = Math.hypot(2, 0.1); // 从 (z=-0.4, y=1.92) 到 (z=-2.4, y=2.02)
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, awningLen),
    awningMat,
  );
  awning.position.set(0, 1.97, -1.4);
  awning.rotation.x = Math.atan2(-2, 0.1); // 平面的 +Y 指向棚面斜向远方
  awning.castShadow = true;
  stall.add(awning);
  part(
    new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.02), paint),
    [0, 1.86, -0.41],
  );

  // 挂在棚檐上的木牌
  const boardMat = new THREE.MeshStandardMaterial({
    map: canvasTexture(THREE, boardCanvas()),
    roughness: 0.75,
  });
  // hangs from the eave above the eye line: only its lower edge shows, the street stays clear
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), boardMat);
  board.position.set(0, 1.8, -0.418);
  stall.add(board);

  // 一串灯泡：沿棚檐下面垂下去，轻微摇晃
  const bulbGeo = new THREE.SphereGeometry(0.03, 10, 8);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0x3a1f0a,
    emissive: 0xffa040,
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  const bulbs = [];
  const wirePts = [];
  const sag = (x) => 1.76 - 0.05 * (1 - (x / 1.3) * (x / 1.3));
  for (let i = 0; i < 13; i++) {
    const x = -1.3 + i * (2.6 / 12);
    const b = new THREE.Mesh(bulbGeo, bulbMat);
    b.position.set(x, sag(x), -0.44);
    stall.add(b);
    bulbs.push({ mesh: b, bx: x, by: sag(x) });
  }
  for (let i = 0; i <= 24; i++) {
    const x = -1.3 + i * (2.6 / 24);
    wirePts.push(new THREE.Vector3(x, sag(x), -0.44));
  }
  stall.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(wirePts),
      new THREE.LineBasicMaterial({ color: 0x1a100a }),
    ),
  );

  // 摊子的灯：两盏，全场只有这两盏点光
  const lampL = new THREE.PointLight(0xffa860, 1.4, 5, 2);
  lampL.position.set(-0.8, 1.7, -0.4);
  const lampR = new THREE.PointLight(0xffa860, 1.4, 5, 2);
  lampR.position.set(0.8, 1.7, -0.4);
  scene.add(lampL, lampR);

  // ---- lights: 4 in total (hemisphere, dusk sun, two stall lamps) ----
  const hemi = new THREE.HemisphereLight(0x7d8fc4, 0x231a16, 0.55);
  scene.add(hemi);
  // 傍晚最后一道光：从街尽头低角度照过来，沿街打在湿地面上
  const sun = new THREE.DirectionalLight(0xff9c52, 2.0);
  sun.position.set(3, 3.5, -22);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = high;
  if (high) {
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 6;
    sc.bottom = -6;
    sc.near = 1;
    sc.far = 60;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 2;
  }
  scene.add(sun, sun.target);

  // ---- rain: one LineSegments, streaks recycled in a box around the camera ----
  const rainCount = high ? 1500 : 600;
  const hx = new Float32Array(rainCount);
  const hy = new Float32Array(rainCount);
  const hz = new Float32Array(rainCount);
  const spd = new Float32Array(rainCount);
  const streak = new Float32Array(rainCount);
  for (let i = 0; i < rainCount; i++) {
    hx[i] = (rand() - 0.5) * 16;
    hy[i] = rand() * 9;
    hz[i] = 2 - rand() * 32;
    spd[i] = 9 + rand() * 4;
    streak[i] = spd[i] * 0.035;
  }
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(rainCount * 6);
  const rainAttr = new THREE.BufferAttribute(rainPos, 3);
  rainAttr.setUsage(THREE.DynamicDrawUsage);
  rainGeo.setAttribute("position", rainAttr);
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xaec2e6,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false; // 顶点每帧都在动，包围盒不跟着更新
  scene.add(rain);

  // ---- splash rings on the wet ground near the field ----
  const splashCount = high ? 40 : 12;
  const splashGeo = new THREE.RingGeometry(0.012, 0.03, 10);
  splashGeo.rotateX(-Math.PI / 2);
  const splashMat = new THREE.MeshBasicMaterial({
    color: 0xb8cdf0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const splash = new THREE.InstancedMesh(splashGeo, splashMat, splashCount);
  splash.frustumCulled = false;
  scene.add(splash);
  const spLife = new Float32Array(splashCount);
  const spMax = new Float32Array(splashCount);
  const spX = new Float32Array(splashCount);
  const spZ = new Float32Array(splashCount);
  const dummy = new THREE.Object3D();
  let spNext = 0;
  let spAcc = 0;
  const spRate = high ? 25 : 8; // 每秒新溅一次

  // ---- state for update ----
  let windTarget = 0;
  let windSmooth = 0;

  function setWind(windX) {
    windTarget = windX;
  }

  function update(dt, time) {
    const d = Math.min(dt, 0.1); // 切后台回来时 dt 很大，别让雨瞬移
    windSmooth += (windTarget - windSmooth) * Math.min(1, d * 2);
    const lean = windSmooth * 0.25; // 雨线倾斜：dx/dy

    // rain
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < rainCount; i++) {
      let y = hy[i] - spd[i] * d;
      let x = hx[i] + lean * spd[i] * d;
      let z = hz[i];
      if (y < 0) {
        y = 8 + rand() * 2;
        x = cx + (rand() - 0.5) * 16;
        z = cz + 2 - rand() * 32;
      }
      hx[i] = x;
      hy[i] = y;
      hz[i] = z;
      const o = i * 6;
      rainPos[o] = x;
      rainPos[o + 1] = y;
      rainPos[o + 2] = z;
      rainPos[o + 3] = x - lean * streak[i];
      rainPos[o + 4] = y + streak[i];
      rainPos[o + 5] = z;
    }
    rainAttr.needsUpdate = true;

    // splash: a round-robin pool, each ring grows and fades
    spAcc += d * spRate;
    while (spAcc >= 1) {
      spAcc -= 1;
      spX[spNext] = (rand() - 0.5) * 3.2;
      spZ[spNext] = -2.0 - rand() * 3;
      spMax[spNext] = spLife[spNext] = 0.3 + rand() * 0.15;
      spNext = (spNext + 1) % splashCount;
    }
    for (let i = 0; i < splashCount; i++) {
      if (spLife[i] > 0) {
        spLife[i] -= d;
        const age = 1 - Math.max(spLife[i], 0) / spMax[i];
        dummy.position.set(spX[i], 0.004, spZ[i]);
        dummy.scale.setScalar(spLife[i] > 0 ? 0.3 + age * 1.4 : 0);
      } else {
        dummy.position.set(0, -10, 0);
        dummy.scale.setScalar(0);
      }
      dummy.updateMatrix();
      splash.setMatrixAt(i, dummy.matrix);
    }
    splash.instanceMatrix.needsUpdate = true;

    // one neon sign flickers: a steady buzz with an occasional stutter
    if (flickerMat) {
      const stutter =
        Math.sin(time * 37) * Math.sin(time * 2.3) > 0.9 ? 0.25 : 1;
      flickerMat.emissiveIntensity =
        1.3 * (0.94 + 0.06 * Math.sin(time * 11)) * stutter;
    }

    // bulbs sway a few millimetres
    for (let i = 0; i < bulbs.length; i++) {
      const b = bulbs[i];
      const s = Math.sin(time * 0.9 + i * 0.6);
      b.mesh.position.x = b.bx + s * 0.012;
      b.mesh.position.y = b.by - (1 - Math.cos(time * 0.9 + i * 0.6)) * 0.004;
    }
  }

  return { camera, update, setWind, quality };
}
