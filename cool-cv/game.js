// Cool CV — a small off-road game in a valley ringed by mountains.
// three.js for rendering, cannon-es for physics. No build step.
import * as THREE from './vendor/three.module.min.js';
import * as CANNON from './vendor/cannon-es.min.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';

// Optional 3D models: drop .glb files in cool-cv/assets/ and they replace the box models.
// length = how long the model should be in world units; yaw = turn it so it faces +z (forward).
const ASSETS = {
  car: { url: 'assets/car.glb', length: 4.4, yaw: 0, hideWheels: true },
  dog: { url: 'assets/dog.glb', length: 1.3, yaw: 0 },
};

// ---------------------------------------------------------------- the board
// A round valley ringed by mountains, cut out like a tabletop diorama. x grows east, z grows south.
const SIZE = 280;          // world size (square)
const N = 121;             // samples per side: big flat facets, abstract look
const ES = SIZE / (N - 1); // element size
const HALF = SIZE / 2;
const WATER_Y = 0.45;

// ---------------------------------------------------------------- noise
function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = t => t * t * (3 - 2 * t);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) { let f = 0, amp = 0.5, fr = 1; for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, y * fr); fr *= 2; amp *= 0.5; } return f; }
function ridge(x, y) { let f = 0, amp = 0.55, fr = 1; for (let i = 0; i < 4; i++) { f += amp * (1 - Math.abs(2 * vnoise(x * fr, y * fr) - 1)); fr *= 2.1; amp *= 0.5; } return f; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- geography
const polar = (deg, r) => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r];
const R_EDGE = 112;
const edgeR = a => R_EDGE * (1 + 0.06 * Math.sin(3 * a + 0.7) + 0.04 * Math.sin(5 * a + 2.1));
const BORDER = Array.from({ length: 120 }, (_, i) => { const a = i / 120 * Math.PI * 2, r = edgeR(a); return [Math.cos(a) * r, Math.sin(a) * r]; });
function distSegs(x, z, segs) { let best = 1e9; for (const [[ax, az], [bx, bz]] of segs) { const dx = bx - ax, dz = bz - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - ax - t * dx, z - az - t * dz); if (d < best) best = d; } return best; }
const inside = (x, z) => Math.hypot(x, z) < edgeR(Math.atan2(z, x));
const OUTSIDE_Y = -8;
const SUMMIT = polar(30, 86);             // the highest peak of the ring: the last CV piece sits on top
const LAKE = { x: -22, z: -14, r: 15 };    // a lake in the valley
function height(x, z) {
  if (!inside(x, z)) return OUTSIDE_Y;
  const rr = Math.hypot(x, z) / edgeR(Math.atan2(z, x));             // 0 at the centre, 1 at the rim
  let h = 1 + fbm(x * 0.012 + 3, z * 0.012, 2) * 1.6;                  // a wide, gently rolling valley floor
  h += smooth(0.42, 0.8, rr) * (5 + 14 * Math.pow(ridge(x * 0.02, z * 0.02), 1.6)); // the mountain ring: separate peaks
  const ds = Math.hypot(x - SUMMIT[0], z - SUMMIT[1]); h += 9 * Math.exp(-(ds * ds) / (2 * 8 * 8));
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r; if (dl < 1.4) h = Math.min(h, -1 + 2.2 * smooth(0.6, 1.4, dl) + (h - 1.2) * smooth(1, 1.4, dl));
  return h;
}

// ---------------------------------------------------------------- CV content
const CV = [
  { id: 'edu', title: 'Education & languages', where: 'the southern meadows', pos: polar(90, 52), color: 0x2f81f7, unlock: 'Speedometer unlocked',
    html: `<ul><li><b>PhD, Computer Engineering</b> · Politecnico di Torino · 2022 – present</li><li><b>MSc, Cinema and Multimedia Engineering</b> · PoliTO · 2019 – 2022<br><span style="opacity:.75">Thesis: locomotion interface for VR based on seat pressure mapping</span></li><li><b>BSc, Cinema and Multimedia Engineering</b> · PoliTO · 2015 – 2019</li><li>CIFIS · 24 CFU teacher training · 2021</li></ul><p><b>Languages:</b> Italian (native) · English (C1) · French (A2) · Spanish (A1)</p>` },
  { id: 'proj', title: 'Projects & skills', where: 'the north-west slopes', pos: polar(210, 52), color: 0xd29922, unlock: 'Altimeter & compass unlocked',
    html: `<ul><li><b>HoloACLS</b> – AR training for medical first responders (HoloLens 2)</li><li><b>Virtual Tour, Museo Paleontologico di Asti</b></li><li><b>S3lf</b> – VR storytelling with the National Film Board of Canada</li><li><b>Nexa City</b> – platform on digital rights, Nexa Center for Internet &amp; Society</li></ul><p><b>Skills:</b> experimental design, user research, prototyping, data analysis · project coordination, partnerships, teaching · Unity, Unreal Engine, CARLA, ROS2, Python · AR/VR/XR</p>` },
  { id: 'pub', title: 'Publications', where: 'the north-east foothills', pos: polar(330, 52), color: 0xa371f7, unlock: 'Minimap unlocked',
    html: `<ul><li><b>CARLA-IVR</b>: an open CARLA extension for immersive AR-HUD evaluation and reproducible experimental design – IEEE OJVT, 2026</li><li>A review of automotive AR-HUD interfaces across driver roles and automation levels – IEEE T-ITS, 2026</li><li>Towards CARLA VR: testing head-up displays in CARLA – SAI FICC, 2025</li><li>AR for warehouses: marker-based navigation and inventory – ICCSCC, 2024</li><li>The WalkingSeat: a leaning interface for VR locomotion – EuroXR, 2023</li></ul>` },
  { id: 'exp', title: 'Experience', where: 'the highest summit of the ring', pos: SUMMIT, color: 0x3fb950, unlock: 'HUD complete',
    html: `<ul><li><b>PhD researcher</b>, Politecnico di Torino (2022 – present): conceived CARLA-IVR, cutting immersive study setup from about a month to under a week; opened 8 industry and research collaborations</li><li><b>Co-lecturer &amp; thesis supervisor</b> (2023 – present): 7 master theses, 11 interdisciplinary student teams in industry challenges</li><li><b>Visiting researcher</b>, Computer Vision Center, Barcelona (2025)</li><li><b>Research assistant</b>, Reply (2023 – 2025)</li></ul>` },
];
const CARPET_ROUTE = [[0, 8], polar(30, 40), polar(30, 66), SUMMIT];
const DOG_POS = polar(150, 34); // somewhere in the valley
const PDF_URL = '../CV_Vezzani_Printable.pdf';

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc9e8);
scene.background = new THREE.Color(0x2b3440);
let VIEW = 26; // half height of the view, in world units
const camera = new THREE.OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, -200, 600);
const CAM_OFFSET = new THREE.Vector3(0, 1, 0.9).normalize().multiplyScalar(160); // from the south, looking down ~48°
scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b3a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
scene.add(sun, sun.target);

function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); const a = w / h; camera.left = -VIEW * a; camera.right = VIEW * a; camera.top = VIEW; camera.bottom = -VIEW; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- terrain
const heights = new Float32Array(N * N); // heights[i + j*N], i along x (west→east), j along z (north→south)
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[i + j * N] = height(-HALF + i * ES, -HALF + j * ES);
function groundAt(x, z) { // bilinear on the samples, matches the meshes closely
  const fx = (x + HALF) / ES, fz = (z + HALF) / ES; const i = Math.max(0, Math.min(N - 2, Math.floor(fx))), j = Math.max(0, Math.min(N - 2, Math.floor(fz)));
  const u = fx - i, v = fz - j; const a = heights[i + j * N], b = heights[i + 1 + j * N], c = heights[i + (j + 1) * N], d = heights[i + 1 + (j + 1) * N];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
{
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), idx = [];
  const cGrass = new THREE.Color(0x7fae4e), cPlain = new THREE.Color(0x9cc05a), cHill = new THREE.Color(0x5f8f3a), cRock = new THREE.Color(0x8a8278), cSnow = new THREE.Color(0xf4f6f8), cSand = new THREE.Color(0xc8b77a), tmp = new THREE.Color();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = i + j * N, x = -HALF + i * ES, z = -HALF + j * ES, y = heights[k];
    pos.set([x, y, z], k * 3);
    const gx = (heights[Math.min(N - 1, i + 1) + j * N] - heights[Math.max(0, i - 1) + j * N]) / (2 * ES);
    const gz = (heights[i + Math.min(N - 1, j + 1) * N] - heights[i + Math.max(0, j - 1) * N]) / (2 * ES);
    const slope = Math.hypot(gx, gz);
    if (y <= OUTSIDE_Y + 0.01) tmp.set(0x4a3f35);
    else if (y < WATER_Y) tmp.set(0x3b7fc4);
    else if (y < WATER_Y + 0.25) tmp.copy(cSand);
    else if (y < 2.2) tmp.copy(cPlain).lerp(cGrass, smooth(1.3, 2.2, y));
    else if (y < 6) tmp.copy(cGrass).lerp(cHill, smooth(2.2, 6, y));
    else tmp.copy(cHill).lerp(cRock, smooth(6, 11, y));
    if (slope > 0.8 && y > OUTSIDE_Y + 0.01) tmp.lerp(cRock, smooth(0.8, 1.4, slope));
    if (y > 15) tmp.lerp(cSnow, smooth(15, 18, y));
    tmp.offsetHSL(0, 0, (hash(i, j) - 0.5) * 0.015);
    col.set([tmp.r, tmp.g, tmp.b], k * 3);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = i + j * N, b = a + 1, c = a + N, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true; scene.add(terrain);
}

// ---------------------------------------------------------------- physics world
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.3;
// The terrain has no collider: the car rides on it through groundAt() (see control()).
// Only the border cliffs below are solid.

// ---------------------------------------------------------------- border: a ring of sheer cliffs
let borderWall;
const BORDER_SEGS = BORDER.map((p, i) => [p, BORDER[(i + 1) % BORDER.length]]);
{
  // physics: one tall static box per border segment, so the car can never leave the board
  for (const [[ax, az], [bx, bz]] of BORDER_SEGS) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.01) continue;
    const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Box(new CANNON.Vec3(L / 2 + 0.8, 60, 1.5)));
    b.position.set((ax + bx) / 2, 30, (az + bz) / 2); b.quaternion.setFromEuler(0, Math.atan2(-dz, dx), 0); world.addBody(b);
  }
  // visual: a jagged rock wall standing on the border line
  const pos = [], col = [], idx = [], rock = new THREE.Color(0x7b736b), rock2 = new THREE.Color(0x5f5953), snow = new THREE.Color(0xf1f3f5), c = new THREE.Color();
  BORDER.forEach(([x, z], i) => {
    let g = -1e9; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g = Math.max(g, groundAt(x + Math.cos(a) * 4, z + Math.sin(a) * 4)); }
    const top = Math.max(g, 1) + 8 + 5 * ridge(x * 0.1, z * 0.1);
    pos.push(x, OUTSIDE_Y, z, x, top, z);
    c.copy(rock2); col.push(c.r, c.g, c.b); c.copy(top > 16 ? snow : rock); col.push(c.r, c.g, c.b);
    const j = (i + 1) % BORDER.length; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1);
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const wall = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 1 })); wall.castShadow = true; wall.receiveShadow = true; scene.add(wall);
  borderWall = wall;
}

// ---------------------------------------------------------------- the 4x4
const START = [0, 8];
const CAR_SCALE = 2;
const chassisBody = new CANNON.Body({ mass: 320, angularDamping: 0.5, linearDamping: 0.02 });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(2.0, 1.0, 3.6))); // only meets the border cliffs
chassisBody.position.set(START[0], groundAt(...START) + 4, START[1]);
chassisBody.quaternion.setFromEuler(0, Math.PI, 0); // face north
world.addBody(chassisBody);
const RIDE = 2.55; // height of the car's centre above the ground when it sits on its wheels
const WHEELS = [[2.1, 2.7], [-2.1, 2.7], [2.1, -2.7], [-2.1, -2.7]].map(([x, z]) => new CANNON.Vec3(x, -1.3, z));

const car = new THREE.Group(); car.scale.setScalar(CAR_SCALE); scene.add(car);
{
  const mat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const add = (geo, m, x, y, z, parent = car) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  add(new THREE.BoxGeometry(2.1, 0.75, 4.2), mat(0xe8590c), 0, 0.2, 0);               // body
  add(new THREE.BoxGeometry(1.85, 0.7, 2.1), mat(0xf08c00), 0, 0.9, -0.35);           // cabin
  add(new THREE.BoxGeometry(1.7, 0.5, 0.05), mat(0x9ecbe8), 0, 0.95, 0.72);           // windscreen
  add(new THREE.BoxGeometry(1.9, 0.08, 1.9), mat(0x333333), 0, 1.3, -0.4);            // roof rack
  add(new THREE.BoxGeometry(2.2, 0.25, 0.25), mat(0x333333), 0, 0.0, 2.15);           // bull bar
  for (const x of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.35, 0.22, 0.06), mat(0xfff3b0), x, 0.35, 2.12); // lights
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), mat(0x222222), 0, 0.45, -2.2).rotation.x = Math.PI / 2; // spare wheel
}
car.userData.seat = new THREE.Object3D(); car.userData.seat.position.set(0, 1.35, -0.6); car.add(car.userData.seat);
const wheelMeshes = WHEELS.map(() => {
  const g = new THREE.CylinderGeometry(1.24, 1.24, 1.0, 12); g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x1d1d1d, flatShading: true })); m.castShadow = true; scene.add(m); return m;
});

// ---------------------------------------------------------------- scenery
// Houses and trees stand in small groups and are solid; a few loose trees are not.
{
  const keepClear = [START, DOG_POS, ...CV.map(c => c.pos)];
  const free = (x, z, r) => inside(x, z) && Math.hypot(x, z) < edgeR(Math.atan2(z, x)) - 8 && keepClear.every(([px, pz]) => Math.hypot(x - px, z - pz) > r) && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.3;
  const solid = (x, y, z, hx, hy, hz, rot) => { const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz))); b.position.set(x, y + hy, z); b.quaternion.setFromEuler(0, rot, 0); world.addBody(b); };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), C = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
  // hamlets
  const HAMLETS = [[0, 30], [60, 32], [130, 24], [175, 40], [250, 30], [300, 38], [15, 62], [195, 70], [270, 64]];
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2, 2.4), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 60);
  const roofGeo = new THREE.ConeGeometry(2.1, 1.5, 4); roofGeo.rotateY(Math.PI / 4);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 60);
  const wallCols = [0xf3e6c8, 0xf6d8a8, 0xeadfcf, 0xf0c9a0], roofCols = [0xb5523b, 0xa3442f, 0x8f3b2a, 0x6d6a66];
  let n = 0, seed = 1;
  for (const [deg, r] of HAMLETS) {
    const [cx, cz] = polar(deg, r); if (!free(cx, cz, 16)) continue;
    const count = 4 + Math.floor(hash(deg, r) * 3);
    for (let k = 0, tries = 0; k < count && tries < 30 && n < 60; tries++) {
      seed++; const a = hash(seed, 3) * Math.PI * 2, d = 2.5 + hash(seed, 5) * 6, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = groundAt(x, z);
      if (!free(x, z, 12) || y < WATER_Y + 0.4) continue;
      const sc = 0.85 + hash(seed, 9) * 0.3, h = 0.8 + hash(seed, 11) * 0.4, rot = hash(seed, 13) * Math.PI;
      Q.setFromAxisAngle(Y, rot);
      M.compose(V.set(x, y + h, z), Q, S.set(sc, h, sc)); walls.setMatrixAt(n, M); walls.setColorAt(n, C.set(wallCols[seed % 4]));
      M.compose(V.set(x, y + 2 * h + 0.75 * sc, z), Q, S.set(sc, sc, sc)); roofs.setMatrixAt(n, M); roofs.setColorAt(n, C.set(roofCols[seed % 4]));
      solid(x, y, z, 1.2 * sc, h + 0.6, 1.2 * sc, rot);
      n++; k++;
    }
  }
  walls.count = roofs.count = n; walls.castShadow = roofs.castShadow = true; walls.receiveShadow = true; scene.add(walls, roofs);
  // groves (solid) and loose trees (not solid)
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x2f6b2f, flatShading: true }), 220);
  let t = 0;
  const GROVES = [[20, 18], [80, 20], [110, 45], [150, 55], [200, 18], [230, 48], [280, 22], [320, 70], [100, 72], [355, 30]];
  for (const [deg, r] of GROVES) {
    const [cx, cz] = polar(deg, r); if (!free(cx, cz, 14)) continue;
    for (let k = 0, tries = 0; k < 9 && tries < 40; tries++) {
      seed++; const a = hash(seed, 17) * Math.PI * 2, d = Math.sqrt(hash(seed, 19)) * 7, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = groundAt(x, z);
      if (!free(x, z, 11) || y < WATER_Y + 0.5) continue;
      const sc = 0.9 + hash(seed, 23) * 0.6; M.makeScale(sc, sc, sc).setPosition(x, y + 1.2 * sc, z); trees.setMatrixAt(t++, M);
      solid(x, y, z, 0.45 * sc, 1.6 * sc, 0.45 * sc, 0);
      k++;
    }
  }
  for (let k = 0, tries = 0; k < 45 && tries < 2000; tries++) {
    seed++; const x = (hash(seed, 29) - 0.5) * 2 * R_EDGE, z = (hash(seed, 31) - 0.5) * 2 * R_EDGE, y = groundAt(x, z);
    if (!free(x, z, 6) || y < WATER_Y + 0.5 || y > 12) continue;
    const sc = 0.7 + hash(seed, 37) * 0.6; M.makeScale(sc, sc, sc).setPosition(x, y + 1.2 * sc, z); trees.setMatrixAt(t++, M); k++;
  }
  trees.count = t; trees.castShadow = true; scene.add(trees);
}

// ---------------------------------------------------------------- pickups
// the last piece sits on the highest point near the summit
{ const exp = CV.find(c => c.id === 'exp'); let [bx, bz] = exp.pos, best = -1e9;
  for (let dx = -5; dx <= 5; dx += 0.5) for (let dz = -5; dz <= 5; dz += 0.5) { const h = groundAt(exp.pos[0] + dx, exp.pos[1] + dz); if (h > best) { best = h; bx = exp.pos[0] + dx; bz = exp.pos[1] + dz; } }
  exp.pos = [bx, bz]; CARPET_ROUTE[CARPET_ROUTE.length - 1] = [bx, bz]; }
const pickups = CV.map((p, k) => {
  const [x, z] = p.pos, y = groundAt(x, z);
  const g = new THREE.Group(); g.position.set(x, y, z);
  const card = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.25), new THREE.MeshLambertMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.35 }));
  card.position.y = 3; card.castShadow = true; g.add(card);
  const lines = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  for (const ly of [0.7, 0.25, -0.2, -0.65]) { const l = lines.clone(); l.position.set(0, ly, 0); l.scale.x = ly < -0.5 ? 0.6 : 1; card.add(l); }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 30, 10, 1, true), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 15; g.add(beam);
  g.visible = k < 3; scene.add(g);
  return { ...p, group: g, card, got: false };
});

// ---------------------------------------------------------------- the dog (easter egg)
const dog = new THREE.Group();
{
  const fur = new THREE.MeshLambertMaterial({ color: 0x8a5a2b, flatShading: true }), white = new THREE.MeshLambertMaterial({ color: 0xf2efe8, flatShading: true }), dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const add = (geo, m, x, y, z, p = dog) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
  add(new THREE.BoxGeometry(0.55, 0.5, 1.1), fur, 0, 0.75, 0);
  add(new THREE.BoxGeometry(0.5, 0.25, 0.9), white, 0, 0.55, 0.02);
  const head = add(new THREE.BoxGeometry(0.5, 0.48, 0.5), fur, 0, 1.15, 0.6);
  add(new THREE.BoxGeometry(0.3, 0.24, 0.32), white, 0, -0.08, 0.36, head);
  add(new THREE.BoxGeometry(0.12, 0.1, 0.06), dark, 0, 0, 0.53, head);
  for (const x of [-0.24, 0.24]) add(new THREE.BoxGeometry(0.1, 0.32, 0.22), fur, x, 0.18, -0.05, head).rotation.z = x > 0 ? -0.3 : 0.3;
  for (const [x, z] of [[-0.18, 0.38], [0.18, 0.38], [-0.18, -0.38], [0.18, -0.38]]) add(new THREE.BoxGeometry(0.15, 0.5, 0.15), white, x, 0.25, z);
  dog.userData.tail = add(new THREE.BoxGeometry(0.1, 0.1, 0.5), fur, 0, 0.95, -0.7);
  dog.userData.head = head;
  dog.position.set(DOG_POS[0], groundAt(...DOG_POS), DOG_POS[1]);
  dog.scale.setScalar(2.2);
  scene.add(dog);
}
// ---------------------------------------------------------------- optional glTF models
const mixers = [];
function fitModel(root, length, yaw) {
  root.rotation.y = yaw; root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const k = length / Math.max(size.z, size.x, 1e-6); root.scale.multiplyScalar(k); root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root), c = b2.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return root;
}
function swapIn(group, gltf, cfg, yOffset, keep = []) {
  for (const ch of [...group.children]) if (!keep.includes(ch)) ch.visible = false;
  const holder = new THREE.Group(); holder.add(fitModel(gltf.scene, cfg.length, cfg.yaw)); holder.position.y = yOffset; group.add(holder);
  if (gltf.animations?.length) { const m = new THREE.AnimationMixer(gltf.scene); m.clipAction(gltf.animations[0]).play(); mixers.push(m); }
}
const gltfLoader = new GLTFLoader();
gltfLoader.load(ASSETS.car.url, g => { swapIn(car, g, ASSETS.car, ASSETS.car.hideWheels ? -1.27 : -0.65, [car.userData.seat]); if (ASSETS.car.hideWheels) wheelMeshes.forEach(w => (w.visible = false)); }, undefined, () => {});
gltfLoader.load(ASSETS.dog.url, g => { swapIn(dog, g, ASSETS.dog, 0); dog.userData.custom = true; }, undefined, () => {});

let dogState = 'waiting', dogJumpT = 0; const dogJumpFrom = new THREE.Vector3();

// ---------------------------------------------------------------- AR carpet
const CHEVRONS = 18;
const chevGeo = (() => { const s = new THREE.Shape(); s.moveTo(-1.1, -0.5); s.lineTo(0, 0.4); s.lineTo(1.1, -0.5); s.lineTo(1.1, 0.0); s.lineTo(0, 0.9); s.lineTo(-1.1, 0.0); s.closePath(); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI); return g; })();
const chevMat = new THREE.MeshBasicMaterial({ color: 0x39d3ff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
const chevrons = Array.from({ length: CHEVRONS }, () => { const m = new THREE.Mesh(chevGeo, chevMat.clone()); m.visible = false; scene.add(m); return m; });
let carpetOn = false;
function carpetPath(px, pz) {
  const route = CARPET_ROUTE; let best = 1e9, bi = 0, bp = null;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i], [bx, bz] = route[i + 1], dx = bx - ax, dz = bz - az;
    let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz); t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qz = az + t * dz, d = Math.hypot(px - qx, pz - qz); if (d < best) { best = d; bi = i; bp = [qx, qz]; }
  }
  const pts = [[px, pz]]; if (best > 6) pts.push(bp); else pts[0] = bp;
  for (let i = bi + 1; i < route.length; i++) pts.push(route[i]);
  return pts;
}
function updateCarpet(t) {
  if (!carpetOn) return;
  const p = chassisBody.position, pts = carpetPath(p.x, p.z);
  let seg = 0, along = 3, k = 0, sx = pts[0][0], sz = pts[0][1];
  while (k < CHEVRONS && seg < pts.length - 1) {
    const [ax, az] = seg === 0 ? [sx, sz] : pts[seg], [bx, bz] = pts[seg + 1], L = Math.hypot(bx - ax, bz - az);
    if (along > L) { along -= L; seg++; continue; }
    const x = ax + (bx - ax) * along / L, z = az + (bz - az) * along / L, c = chevrons[k];
    c.visible = true; c.position.set(x, groundAt(x, z) + 0.35, z); c.rotation.y = Math.atan2(bx - ax, bz - az);
    c.material.opacity = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t * 6 - k * 0.6));
    along += 4.5; k++;
  }
  for (; k < CHEVRONS; k++) chevrons[k].visible = false;
}

// ---------------------------------------------------------------- input
const keys = {};
const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyR', 'KeyC'];
window.addEventListener('keydown', e => { if (GAME_KEYS.includes(e.code)) e.preventDefault(); if (!keys[e.code] && (e.code === 'Space' || e.code === 'KeyR') && started && !cardOpen) jump(); if (!keys[e.code] && e.code === 'KeyC') toggleMode(); keys[e.code] = true; if (cardOpen && (e.code === 'Enter' || e.code === 'Escape')) closeCard(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });
const fwd = () => keys.KeyW || keys.ArrowUp, back = () => keys.KeyS || keys.ArrowDown, left = () => keys.KeyA || keys.ArrowLeft, right = () => keys.KeyD || keys.ArrowRight;
function toggleMode() {
  driveMode = driveMode === 'map' ? 'car' : 'map';
  document.getElementById('help').textContent = HELP[driveMode];
  toast(driveMode === 'map' ? 'Map controls: arrows point the car' : 'Car controls: up = gas, left/right = steer');
}
const HELP = { map: 'Arrows: point and go · Space: jump / back on wheels · in the air, arrows: flips · C: car controls',
  car: 'Up: gas · Down: reverse · Left/Right: steer · Space: jump / back on wheels · C: map controls' };
function jump() { // Space: hop, or back on the wheels when lying on the side or the roof
  const p = chassisBody.position, up = chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
  if (crashed || up.y < 0.35) { resetCar(); chassisBody.velocity.y = 7; jumpT = 0.3; return; }
  if (p.y - groundAt(p.x, p.z) - RIDE < 0.8) { chassisBody.velocity.y += 14; jumpT = 0.3; }
}
function resetCar() {
  const p = chassisBody.position, e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...chassisBody.quaternion.toArray()), 'YXZ');
  chassisBody.position.set(p.x, groundAt(p.x, p.z) + RIDE + 0.5, p.z);
  chassisBody.quaternion.setFromEuler(0, e.y, 0, 'YXZ');
  chassisBody.velocity.setZero(); chassisBody.angularVelocity.setZero(); crashed = false;
}

// ---------------------------------------------------------------- HUD
const $ = id => document.getElementById(id);
const slots = $('slots');
CV.forEach((p, k) => { const d = document.createElement('div'); d.className = 'slot'; d.id = 'slot-' + p.id; d.textContent = k < 3 ? p.title : '???'; slots.appendChild(d); });
let toastTimer; function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.opacity = 0), 2600); }
let cardOpen = false;
function openCard(html) { $('cardBox').innerHTML = html; $('card').style.display = 'flex'; cardOpen = true; }
function closeCard() { $('card').style.display = 'none'; cardOpen = false; canvas.focus(); }
$('card').addEventListener('click', e => { if (e.target.id === 'card' || e.target.dataset.close !== undefined) closeCard(); });
const hudOn = { speed: false, alt: false, map: false };
const mm = $('minimap').getContext('2d');
const mmBase = (() => { // pre-render the minimap terrain
  const c = document.createElement('canvas'); c.width = 150; c.height = 190; const g = c.getContext('2d'); const img = g.createImageData(150, 190);
  const x0 = -122, x1 = 122, z0 = -122, z1 = 122;
  for (let py = 0; py < 190; py++) for (let px = 0; px < 150; px++) {
    const x = x0 + (x1 - x0) * px / 149, z = z0 + (z1 - z0) * py / 189, y = groundAt(x, z), o = (px + py * 150) * 4;
    if (y <= OUTSIDE_Y + 0.01) continue;
    const [r, gg, b] = y < WATER_Y ? [59, 127, 196] : y < 2.2 ? [150, 190, 95] : y < 6 ? [95, 145, 60] : y < 15 ? [140, 130, 120] : [240, 240, 240];
    img.data.set([r, gg, b, 200], o);
  }
  g.putImageData(img, 0, 0); return { c, x0, x1, z0, z1 };
})();
function drawMinimap(heading) {
  const { c, x0, x1, z0, z1 } = mmBase; mm.clearRect(0, 0, 150, 190); mm.drawImage(c, 0, 0);
  const toM = (x, z) => [(x - x0) / (x1 - x0) * 149, (z - z0) / (z1 - z0) * 189];
  for (const p of pickups) { if (p.got || !p.group.visible) continue; const [mx, my] = toM(...p.pos); mm.fillStyle = '#' + p.color.toString(16).padStart(6, '0'); mm.fillRect(mx - 3, my - 3, 6, 6); }
  const [cx, cy] = toM(chassisBody.position.x, chassisBody.position.z);
  mm.save(); mm.translate(cx, cy); mm.rotate(-heading); mm.fillStyle = '#ff3b30'; mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4, 4); mm.lineTo(-4, 4); mm.closePath(); mm.fill(); mm.restore();
}

function collect(p) {
  chassisBody.velocity.set(0, Math.min(0, chassisBody.velocity.y), 0); chassisBody.angularVelocity.setZero();
  p.got = true; p.group.visible = false;
  const slot = $('slot-' + p.id); slot.classList.add('got'); slot.textContent = p.title;
  if (p.id === 'edu') { hudOn.speed = true; $('speed').style.display = 'block'; }
  if (p.id === 'proj') { hudOn.alt = true; $('alt').style.display = 'block'; }
  if (p.id === 'pub') { hudOn.map = true; $('minimap').style.display = 'block'; }
  const firstThree = pickups.slice(0, 3).every(q => q.got);
  let extra = '';
  if (p.id !== 'exp' && firstThree && !carpetOn) { carpetOn = true; pickups[3].group.visible = true; $('slot-exp').textContent = 'Experience'; extra = '<p><b>AR navigation unlocked.</b> Follow the carpet to the last piece, on the highest summit of the ring.</p>'; }
  if (p.id === 'exp') {
    carpetOn = false; chevrons.forEach(c => (c.visible = false));
    openCard(`<h2>${p.title}</h2><div class="unlock">${p.unlock} · ${p.where}</div>${p.html}<p><b>You built the whole HUD.</b> The full CV is yours.</p><div class="btns"><a class="btn" href="${PDF_URL}" target="_blank" rel="noopener">Open the full CV (PDF)</a><button class="ghost" data-close>Keep driving</button></div>`);
    return;
  }
  openCard(`<h2>${p.title}</h2><div class="unlock">${p.unlock} · found in ${p.where}</div>${p.html}${extra}<div class="btns"><button data-close>Keep driving (Enter)</button></div>`);
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
let started = false;
camLook.set(START[0], groundAt(...START), START[1]);

// Driving is arcade: on the ground the controller sets the car's speed and turn rate directly,
// so speed is the same in every direction and on every slope. Wheels only do the suspension.
const VMAX = 16, VBACK = 8;
let jumpT = 0; // after a jump, the ground controller lets go for a moment
let driveMode = 'map'; // 'map': arrows point the car on screen · 'car': up = throttle, left/right = steer
let crashed = false; // landed on the side or the roof: Space puts it back
function control(h) {
  const live = started && !cardOpen && !crashed;
  const p = chassisBody.position, q = chassisBody.quaternion, up = q.vmult(new CANNON.Vec3(0, 1, 0)), f = q.vmult(new CANNON.Vec3(0, 0, 1));
  const g0 = groundAt(p.x, p.z), gap = p.y - (g0 + RIDE);
  const e = 1.5, nAt = (x, z) => new CANNON.Vec3(groundAt(x - e, z) - groundAt(x + e, z), 2 * e, groundAt(x, z - e) - groundAt(x, z + e)).unit();
  const dir = Math.sign(chassisBody.velocity.dot(f)) || 1;
  const nrm = nAt(p.x, p.z).vadd(nAt(p.x + f.x * 3 * dir, p.z + f.z * 3 * dir)); nrm.normalize();
  jumpT -= h;
  if (crashed) { // lying on the ground: stay there until Space
    if (p.y < g0 + 1.6) { p.y = g0 + 1.6; chassisBody.velocity.setZero(); chassisBody.angularVelocity.scale(0.8, chassisBody.angularVelocity); }
    return;
  }
  if (gap > 0.3 || jumpT > 0) { // in the air
    if (live) { // flips and barrel rolls
      const rx = q.vmult(new CANNON.Vec3(1, 0, 0)), pitch = (fwd() ? 1 : 0) - (back() ? 1 : 0), roll = (right() ? 1 : 0) - (left() ? 1 : 0);
      chassisBody.angularVelocity.vadd(rx.scale(pitch * 6 * h), chassisBody.angularVelocity);
      chassisBody.angularVelocity.vadd(f.scale(roll * 6 * h), chassisBody.angularVelocity);
    }
    return;
  }
  if (up.dot(nrm) < 0.3) { crashed = true; chassisBody.velocity.setZero(); toast('Oops! Press Space to get back on your wheels'); return; }
  // on the ground: sit on the terrain, whatever the slope
  if (gap < 0) p.y = g0 + RIDE;
  let speed = 0, yawRate = 0;
  const ft = f.vsub(nrm.scale(f.dot(nrm))); ft.normalize();
  if (live && driveMode === 'map') {
    const ix = (right() ? 1 : 0) - (left() ? 1 : 0), iz = (back() ? 1 : 0) - (fwd() ? 1 : 0);
    if (ix || iz) {
      let err = Math.atan2(ix, iz) - Math.atan2(ft.x, ft.z); while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      yawRate = Math.max(-6, Math.min(6, err * 9));                                  // spin on the spot towards the arrow…
      speed = Math.abs(err) < 0.25 ? VMAX : Math.abs(err) < 0.7 ? VMAX * 0.35 : 0;    // …then go, always at the same speed
    }
  } else if (live) {
    speed = fwd() ? VMAX : back() ? -VBACK : 0;
    yawRate = ((left() ? 1 : 0) - (right() ? 1 : 0)) * 2.6 * (speed < 0 ? -1 : 1);
  }
  // velocity along the ground only: same speed uphill, downhill and on the flat; over a crest the car takes off
  const v = chassisBody.velocity, vt = v.vsub(nrm.scale(v.dot(nrm)));
  vt.vadd(ft.scale(speed).vsub(vt).scale(Math.min(1, 12 * h)), vt); chassisBody.velocity.copy(vt);
  chassisBody.applyForce(new CANNON.Vec3(0, 20 * chassisBody.mass, 0)); // gravity is handled by sitting on the ground
  // turn rate around the ground normal, and keep the car flat on the ground
  const w = chassisBody.angularVelocity, yawNow = w.dot(nrm), tilt = w.vsub(nrm.scale(yawNow));
  const yawNew = yawNow + (yawRate - yawNow) * Math.min(1, 15 * h);
  chassisBody.angularVelocity.copy(nrm.scale(yawNew).vadd(tilt.scale(Math.exp(-8 * h))).vadd(up.cross(nrm).scale(18 * h)));
}
world.addEventListener("preStep", () => control(world.dt));

function step(dt) {
  world.step(1 / 60, dt, 4);
  const cp = chassisBody.position, onGround = !crashed && cp.y - groundAt(cp.x, cp.z) - RIDE < 0.3;
  if (onGround && cp.y > OUTSIDE_Y + 3) { safeT += dt; if (safeT > 1) { safeT = 0; lastSafe.copy(cp); } }
  if (cp.y < OUTSIDE_Y + 1) { chassisBody.position.set(lastSafe.x, groundAt(lastSafe.x, lastSafe.z) + RIDE + 1, lastSafe.z); chassisBody.velocity.setZero(); chassisBody.angularVelocity.setZero(); crashed = false; toast("That's the edge of the world. Back you go!"); }
}
let wheelSpin = 0;
let safeT = 0; const lastSafe = new CANNON.Vec3(START[0], 0, START[1]);

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  step(dt);
  // sync visuals
  car.position.copy(chassisBody.position); car.quaternion.copy(chassisBody.quaternion);
  wheelSpin += chassisBody.velocity.dot(chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1))) * dt / 1.24;
  const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), wheelSpin);
  WHEELS.forEach((loc, i) => { const wp = chassisBody.pointToLocalFrame ? chassisBody.pointToWorldFrame(loc, new CANNON.Vec3()) : loc; wheelMeshes[i].position.set(wp.x, wp.y, wp.z); wheelMeshes[i].quaternion.copy(car.quaternion).multiply(spinQ); });
  // camera: fixed isometric angle, follows the car smoothly
  camLook.lerp(car.position, 1 - Math.exp(-dt * 5));
  camera.position.copy(camLook).add(CAM_OFFSET); camera.lookAt(camLook);
  sun.position.copy(car.position).add(new THREE.Vector3(60, 110, 40)); sun.target.position.copy(car.position);
  // pickups
  for (const p of pickups) {
    if (p.got || !p.group.visible) continue;
    p.card.rotation.y = t * 1.5; p.card.position.y = 3 + Math.sin(t * 2) * 0.4;
    const d = Math.hypot(car.position.x - p.group.position.x, car.position.z - p.group.position.z);
    if (d < 7.5 && !cardOpen) collect(p);
  }
  // dog
  const dDog = Math.hypot(car.position.x - DOG_POS[0], car.position.z - DOG_POS[1]);
  if (dogState === 'waiting') {
    dog.userData.tail.rotation.y = Math.sin(t * 10) * 0.6; dog.lookAt(car.position.x, dog.position.y, car.position.z);
    if (dDog < 11 && chassisBody.velocity.length() < 8) { dogState = 'jumping'; dogJumpT = 0; dogJumpFrom.copy(dog.position); toast('Your co-pilot just jumped aboard!'); }
  } else if (dogState === 'jumping') {
    dogJumpT += dt / 0.7; const to = car.userData.seat.getWorldPosition(new THREE.Vector3());
    dog.position.lerpVectors(dogJumpFrom, to, Math.min(1, dogJumpT)); dog.position.y += Math.sin(Math.min(1, dogJumpT) * Math.PI) * 4;
    if (dogJumpT >= 1) { dogState = 'aboard'; car.userData.seat.add(dog); dog.position.set(0, 0, 0); dog.rotation.set(0, 0, 0); dog.scale.setScalar(2.2 / CAR_SCALE); } // same size as on the ground
  } else { dog.userData.tail.rotation.y = Math.sin(t * 12) * 0.7; dog.userData.head.rotation.y = Math.sin(t * 1.3) * 0.5; }
  { // fade the border cliffs when they stand between the camera (south) and the car
    const cx = car.position.x, cz = car.position.z; let hide = false;
    for (const [bx, bz] of BORDER) if (bz > cz && bz - cz < 20 && Math.abs(bx - cx) < 10) { hide = true; break; }
    const target = hide ? 0.35 : 1; borderWall.material.opacity += (target - borderWall.material.opacity) * Math.min(1, dt * 6); borderWall.material.depthWrite = borderWall.material.opacity > 0.95;
  }
  for (const m of mixers) m.update(dt);
  updateCarpet(t);
  // HUD
  const fwdV = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion), heading = Math.atan2(fwdV.x, -fwdV.z);
  if (hudOn.speed) $('speed').innerHTML = `${Math.round(chassisBody.velocity.length() * 5)}<small>km/h (oversized)</small>`;
  if (hudOn.alt) { const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']; const hdg = (heading * 180 / Math.PI + 360) % 360; $('alt').innerHTML = `ALT ${Math.round(Math.max(0, car.position.y) * 250 + 150)} m<br>HDG ${Math.round(hdg)}° ${dirs[Math.round(hdg / 45) % 8]}`; }
  if (hudOn.map) drawMinimap(heading);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

$('loading').style.display = 'none';
const startEl = $('start'); startEl.style.display = 'flex';
const begin = () => { if (started) return; started = true; startEl.style.display = 'none'; canvas.focus(); toast('Find the pieces of my CV: follow the light beams'); };
startEl.addEventListener('click', begin);
window.addEventListener('keydown', begin, { once: true });
frame();

// for automated checks
window.__coolcv = { setView(v) { VIEW = v; resize(); }, world, jump, chassisBody, pickups, groundAt, collect, keys, get dogState() { return dogState; }, get carpetOn() { return carpetOn; } };
