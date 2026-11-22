// Cool CV — a small off-road game across a stylized Piemonte.
// three.js for rendering, cannon-es for physics. No build step.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ---------------------------------------------------------------- map projection
// 1 world unit ≈ 0.5 km. x grows east, z grows south.
const LON0 = 7.9, LAT0 = 45.25;
const toXZ = (lon, lat) => [(lon - LON0) * 157.2, -(lat - LAT0) * 222];

const SIZE = 560;          // world size (square)
const N = 257;             // samples per side
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
const P = pts => pts.map(([lo, la]) => toXZ(lo, la));
function distToPolyline(x, z, pl) {
  let best = 1e9, bestT = 0, acc = 0, total = 0;
  for (let i = 0; i < pl.length - 1; i++) total += Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]);
  for (let i = 0; i < pl.length - 1; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) { best = d; bestT = (acc + t * L) / total; }
    acc += L;
  }
  return [best, bestT];
}

const ALPS = P([[7.75, 44.12], [7.3, 44.14], [6.95, 44.3], [6.98, 44.62], [6.75, 44.95], [6.85, 45.1], [6.95, 45.27], [7.05, 45.42], [7.55, 45.55], [7.8, 45.75], [7.87, 45.93], [8.15, 46.15], [8.4, 46.45], [8.75, 46.15]]);
const APENNINES = P([[7.95, 44.22], [8.4, 44.42], [8.8, 44.55], [9.25, 44.65]]);
// valleys: polyline, floor height at mouth and at head, half width
const VALLEYS = [
  { name: 'Val di Susa', pl: P([[7.55, 45.08], [7.4, 45.08], [7.25, 45.11], [7.05, 45.14], [6.93, 45.25]]), f0: 1.2, f1: 20, w: 15 },
  { name: 'Alta Val di Susa', pl: P([[7.05, 45.14], [6.88, 45.03], [6.75, 44.94]]), f0: 6, f1: 22, w: 11 },
  { name: 'Valli di Lanzo', pl: P([[7.6, 45.2], [7.48, 45.27], [7.39, 45.31]]), f0: 1.2, f1: 5, w: 12 },
  { name: 'Val Grande', pl: P([[7.39, 45.31], [7.3, 45.35], [7.2, 45.37]]), f0: 5, f1: 16, w: 9 },
  { name: "Val d'Ala", pl: P([[7.39, 45.31], [7.3, 45.30], [7.2, 45.30], [7.13, 45.31]]), f0: 5, f1: 14, w: 9 },
  { name: 'Val di Viù', pl: P([[7.47, 45.27], [7.36, 45.25], [7.22, 45.23]]), f0: 3, f1: 14, w: 9 },
  { name: 'Valle Po', pl: P([[7.4, 44.68], [7.2, 44.69], [7.1, 44.69]]), f0: 1.2, f1: 16, w: 10 },
  { name: 'Valle Stura', pl: P([[7.55, 44.38], [7.3, 44.32], [7.0, 44.36]]), f0: 1.4, f1: 16, w: 10 },
  { name: 'Valle Dora', pl: P([[7.88, 45.45], [7.75, 45.6], [7.55, 45.72], [7.3, 45.75]]), f0: 1.4, f1: 12, w: 13 },
  { name: 'Val Sesia', pl: P([[8.25, 45.6], [8.15, 45.78], [7.95, 45.88]]), f0: 1.6, f1: 14, w: 10 },
  { name: "Val d'Ossola", pl: P([[8.5, 45.92], [8.35, 46.05], [8.28, 46.2]]), f0: 1.2, f1: 10, w: 13 },
];
const PEAKS = [[7.093, 44.667, 22, 9], [7.867, 45.937, 24, 11], [7.077, 45.203, 10, 6], [7.10, 45.335, 9, 5], [6.95, 44.45, 10, 9]].map(([lo, la, h, r]) => { const [x, z] = toXZ(lo, la); return { x, z, h, r }; });
const PO = P([[7.1, 44.7], [7.4, 44.76], [7.6, 44.95], [7.69, 45.05], [7.95, 45.15], [8.4, 45.15], [8.7, 45.05], [9.3, 45.1]]);
const LAKE = (() => { const [x, z] = toXZ(8.58, 45.95); return { x, z, rx: 9, rz: 38 }; })();
const HILLS = [[8.05, 44.6, 55, 7], [8.3, 45.05, 45, 6], [7.78, 45.08, 12, 5]].map(([lo, la, r, h]) => { const [x, z] = toXZ(lo, la); return { x, z, r, h }; });

function height(x, z) {
  let h = 1.0 + fbm(x * 0.02, z * 0.02, 3) * 0.8;
  // Alps
  const [dA] = distToPolyline(x, z, ALPS);
  const alp = Math.pow(1 - smooth(0, 105, dA), 1.35);
  h += alp * (24 + 18 * ridge(x * 0.018, z * 0.018));
  // Apennines
  const [dP] = distToPolyline(x, z, APENNINES);
  h += Math.pow(1 - smooth(0, 60, dP), 1.4) * (8 + 7 * ridge(x * 0.03 + 7, z * 0.03));
  // hills: Langhe, Monferrato, Collina di Torino
  for (const H of HILLS) { const d = Math.hypot(x - H.x, z - H.z); const m = 1 - smooth(H.r * 0.4, H.r, d); h += m * H.h * (0.45 + fbm(x * 0.07, z * 0.07, 3)); }
  // map edge walls
  const edge = Math.min(HALF - Math.abs(x), HALF - Math.abs(z));
  h += Math.pow(1 - smooth(0, 45, edge), 2) * 40;
  // valleys
  for (const V of VALLEYS) {
    const [d, t] = distToPolyline(x, z, V.pl);
    if (d < V.w) { const floor = V.f0 + (V.f1 - V.f0) * t + fbm(x * 0.05, z * 0.05, 2) * 0.6; const s = smooth(V.w * 0.35, V.w, d); h = Math.min(h, floor + (h - floor) * s); }
  }
  // peaks
  for (const K of PEAKS) { const d = Math.hypot(x - K.x, z - K.z); h += K.h * Math.exp(-(d * d) / (2 * K.r * K.r)); }
  // Po and Lago Maggiore
  const [dPo] = distToPolyline(x, z, PO);
  if (dPo < 4 && h < 4) h -= (1 - smooth(1.2, 4, dPo)) * 0.9;
  const lk = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  if (lk < 1.3) h = Math.min(h, -1.5 + 3 * smooth(0.7, 1.3, lk) + (h > 3 ? (h - 3) * smooth(1, 1.3, lk) : 0));
  return h;
}

// ---------------------------------------------------------------- places
const PLACES = {
  Torino: [7.686, 45.07], Susa: [7.05, 45.137], Lanzo: [7.479, 45.274], Balme: [7.22, 45.302], Asti: [8.207, 44.9],
  Cuneo: [7.551, 44.384], Alba: [8.035, 44.7], Alessandria: [8.615, 44.913], Novara: [8.622, 45.446], Vercelli: [8.423, 45.323],
  Biella: [8.052, 45.566], Ivrea: [7.876, 45.467], Monviso: [7.093, 44.667], 'Monte Rosa': [7.867, 45.937], Domodossola: [8.29, 46.115],
  'Lago Maggiore': [8.58, 45.95], Ceres: [7.39, 45.31],
};
const XZ = name => toXZ(...PLACES[name]);

// ---------------------------------------------------------------- CV content
const CV = [
  { id: 'edu', title: 'Education & languages', where: 'Politecnico di Torino', pos: toXZ(7.66, 45.062), color: 0x2f81f7, unlock: 'Speedometer unlocked',
    html: `<ul><li><b>PhD, Computer Engineering</b> · Politecnico di Torino · 2022 – present</li><li><b>MSc, Cinema and Multimedia Engineering</b> · PoliTO · 2019 – 2022<br><span style="opacity:.75">Thesis: locomotion interface for VR based on seat pressure mapping</span></li><li><b>BSc, Cinema and Multimedia Engineering</b> · PoliTO · 2015 – 2019</li><li>CIFIS · 24 CFU teacher training · 2021</li></ul><p><b>Languages:</b> Italian (native) · English (C1) · French (A2) · Spanish (A1)</p>` },
  { id: 'proj', title: 'Projects & skills', where: 'Asti', pos: XZ('Asti'), color: 0xd29922, unlock: 'Altimeter & compass unlocked',
    html: `<ul><li><b>HoloACLS</b> – AR training for medical first responders (HoloLens 2)</li><li><b>Virtual Tour, Museo Paleontologico di Asti</b> – yes, this one is right here</li><li><b>S3lf</b> – VR storytelling with the National Film Board of Canada</li><li><b>Nexa City</b> – platform on digital rights, Nexa Center for Internet &amp; Society</li></ul><p><b>Skills:</b> experimental design, user research, prototyping, data analysis · project coordination, partnerships, teaching · Unity, Unreal Engine, CARLA, ROS2, Python · AR/VR/XR</p>` },
  { id: 'pub', title: 'Publications', where: 'Susa', pos: XZ('Susa'), color: 0xa371f7, unlock: 'Minimap unlocked',
    html: `<ul><li><b>CARLA-IVR</b>: an open CARLA extension for immersive AR-HUD evaluation and reproducible experimental design – IEEE OJVT, 2026</li><li>A review of automotive AR-HUD interfaces across driver roles and automation levels – IEEE T-ITS, 2026</li><li>Towards CARLA VR: testing head-up displays in CARLA – SAI FICC, 2025</li><li>AR for warehouses: marker-based navigation and inventory – ICCSCC, 2024</li><li>The WalkingSeat: a leaning interface for VR locomotion – EuroXR, 2023</li></ul>` },
  { id: 'exp', title: 'Experience', where: "Balme, Val d'Ala", pos: XZ('Balme'), color: 0x3fb950, unlock: 'HUD complete',
    html: `<ul><li><b>PhD researcher</b>, Politecnico di Torino (2022 – present): conceived CARLA-IVR, cutting immersive study setup from about a month to under a week; opened 8 industry and research collaborations</li><li><b>Co-lecturer &amp; thesis supervisor</b> (2023 – present): 7 master theses, 11 interdisciplinary student teams in industry challenges</li><li><b>Visiting researcher</b>, Computer Vision Center, Barcelona (2025)</li><li><b>Research assistant</b>, Reply (2023 – 2025)</li></ul>` },
];
const CARPET_ROUTE = [XZ('Torino'), toXZ(7.6, 45.2), XZ('Lanzo'), XZ('Ceres'), toXZ(7.3, 45.30), XZ('Balme')];
const DOG_POS = toXZ(8.06, 44.66); // a hill in the Langhe, near Alba
const PDF_URL = '../CV_Vezzani_Printable.pdf';

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc9e8);
scene.fog = new THREE.Fog(0x9cc9e8, 140, 420);
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 900);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b3a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
scene.add(sun, sun.target);

function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
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
    if (y < WATER_Y + 0.25) tmp.copy(cSand);
    else if (y < 3) tmp.copy(cPlain).lerp(cGrass, smooth(1.5, 3, y));
    else if (y < 14) tmp.copy(cGrass).lerp(cHill, smooth(3, 14, y));
    else tmp.copy(cHill).lerp(cRock, smooth(14, 24, y));
    if (slope > 0.8) tmp.lerp(cRock, smooth(0.8, 1.4, slope));
    if (y > 32) tmp.lerp(cSnow, smooth(32, 38, y));
    tmp.offsetHSL(0, 0, (hash(i, j) - 0.5) * 0.04);
    col.set([tmp.r, tmp.g, tmp.b], k * 3);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = i + j * N, b = a + 1, c = a + N, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true; scene.add(terrain);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshLambertMaterial({ color: 0x3b7fc4, transparent: true, opacity: 0.8 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; scene.add(water);
}

// ---------------------------------------------------------------- physics world
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.3;
{
  // cannon Heightfield: data[i][j], local x = i*ES, local y = j*ES, height = local z.
  // Rotated -90° about X: local y → world -z. Body sits at (-HALF, 0, +HALF), so j counts from the south edge.
  const data = [];
  for (let i = 0; i < N; i++) { const row = []; for (let j = 0; j < N; j++) row.push(heights[i + (N - 1 - j) * N]); data.push(row); }
  const hf = new CANNON.Heightfield(data, { elementSize: ES });
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(hf);
  body.position.set(-HALF, 0, HALF);
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(body);
}

// ---------------------------------------------------------------- the 4x4
const START = (() => { const [x, z] = XZ('Torino'); return [x - 1, z + 24]; })();
const chassisBody = new CANNON.Body({ mass: 160, angularDamping: 0.35, linearDamping: 0.05 });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(1.05, 0.45, 2.1)), new CANNON.Vec3(0, 0.15, 0));
chassisBody.position.set(START[0], groundAt(...START) + 3, START[1]);
chassisBody.quaternion.setFromEuler(0, Math.PI, 0); // face north, towards Torino
const vehicle = new CANNON.RaycastVehicle({ chassisBody, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
const wheelOpts = { radius: 0.62, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: 28, suspensionRestLength: 0.55, frictionSlip: 2.2,
  dampingRelaxation: 2.4, dampingCompression: 4.2, maxSuspensionForce: 1e5, rollInfluence: 0.04, axleLocal: new CANNON.Vec3(-1, 0, 0),
  chassisConnectionPointLocal: new CANNON.Vec3(), maxSuspensionTravel: 0.45, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true };
for (const [x, z] of [[1.05, 1.35], [-1.05, 1.35], [1.05, -1.35], [-1.05, -1.35]]) { wheelOpts.chassisConnectionPointLocal.set(x, -0.1, z); vehicle.addWheel({ ...wheelOpts }); }
vehicle.addToWorld(world);

const car = new THREE.Group(); scene.add(car);
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
const wheelMeshes = vehicle.wheelInfos.map(() => {
  const g = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 12); g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x1d1d1d, flatShading: true })); m.castShadow = true; scene.add(m); return m;
});

// ---------------------------------------------------------------- landmarks & labels
function label(text, x, z, lift = 10, scale = 1) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  let fs = 54; do { g.font = `bold ${fs}px JetBrains Mono, monospace`; fs -= 2; } while (g.measureText(text).width > 440 && fs > 20); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(text, 256, 64); g.fillStyle = '#fff'; g.fillText(text, 256, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  s.scale.set(24 * scale, 6 * scale, 1); s.position.set(x, groundAt(x, z) + lift, z); scene.add(s); return s;
}
for (const name of ['Torino', 'Susa', 'Lanzo', 'Asti', 'Cuneo', 'Alba', 'Alessandria', 'Novara', 'Vercelli', 'Biella', 'Ivrea', 'Domodossola', 'Balme']) { const [x, z] = XZ(name); label(name, x, z, 16, 0.75); }
for (const name of ['Monviso', 'Monte Rosa', 'Lago Maggiore']) { const [x, z] = XZ(name); label(name, x, z, 12, 1.3); }
{ const [x, z] = toXZ(7.2, 45.17); label('Val di Susa', x, z, 10, 0.8); }
{ const [x, z] = toXZ(7.38, 45.36); label('Valli di Lanzo', x, z, 14, 0.8); }
{ // Mole Antonelliana, very much not to scale
  const [x, z] = toXZ(7.693, 45.069), y = groundAt(x, z), m = new THREE.MeshLambertMaterial({ color: 0xd8cfc0, flatShading: true }), g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 3), m); base.position.y = 1.25; g.add(base);
  const dome = new THREE.Mesh(new THREE.ConeGeometry(2.1, 5, 4), m); dome.position.y = 5; dome.rotation.y = Math.PI / 4; g.add(dome);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 8, 6), m); spire.position.y = 11; g.add(spire);
  g.position.set(x, y, z); g.traverse(o => { o.castShadow = true; }); scene.add(g);
  const shape = new CANNON.Body({ mass: 0 }); shape.addShape(new CANNON.Box(new CANNON.Vec3(1.5, 4, 1.5))); shape.position.set(x, y + 4, z); world.addBody(shape);
}
{ // a few trees and vineyards-ish dots
  const tg = new THREE.ConeGeometry(0.9, 2.6, 6), tm = new THREE.MeshLambertMaterial({ color: 0x2f6b2f, flatShading: true });
  const trees = new THREE.InstancedMesh(tg, tm, 1400); let n = 0; const M = new THREE.Matrix4();
  for (let t = 0; t < 6000 && n < 1400; t++) {
    const x = (hash(t, 7) - 0.5) * (SIZE - 70), z = (hash(t, 13) - 0.5) * (SIZE - 70), y = groundAt(x, z);
    if (y < 2.5 || y > 26 || fbm(x * 0.04, z * 0.04, 2) < 0.52) continue;
    const s = 0.7 + hash(t, 3) * 0.8; M.makeScale(s, s, s).setPosition(x, y + 1.2 * s, z); trees.setMatrixAt(n++, M);
  }
  trees.count = n; trees.castShadow = true; scene.add(trees);
}

// ---------------------------------------------------------------- pickups
const pickups = CV.map((p, k) => {
  const [x, z] = p.pos, y = groundAt(x, z);
  const g = new THREE.Group(); g.position.set(x, y, z);
  const card = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.25), new THREE.MeshLambertMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.35 }));
  card.position.y = 3; card.castShadow = true; g.add(card);
  const lines = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  for (const ly of [0.7, 0.25, -0.2, -0.65]) { const l = lines.clone(); l.position.set(0, ly, 0); l.scale.x = ly < -0.5 ? 0.6 : 1; card.add(l); }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 140, 10, 1, true), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 70; g.add(beam);
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
  dog.scale.setScalar(1.25);
  scene.add(dog);
}
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
const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyR'];
window.addEventListener('keydown', e => { if (GAME_KEYS.includes(e.code)) e.preventDefault(); keys[e.code] = true; if (e.code === 'KeyR') resetCar(); if (cardOpen && (e.code === 'Enter' || e.code === 'Escape')) closeCard(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });
const fwd = () => keys.KeyW || keys.ArrowUp, back = () => keys.KeyS || keys.ArrowDown, left = () => keys.KeyA || keys.ArrowLeft, right = () => keys.KeyD || keys.ArrowRight;
function resetCar() {
  const p = chassisBody.position, e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...chassisBody.quaternion.toArray()), 'YXZ');
  chassisBody.position.set(p.x, groundAt(p.x, p.z) + 3, p.z);
  chassisBody.quaternion.setFromEuler(0, e.y, 0, 'YXZ');
  chassisBody.velocity.setZero(); chassisBody.angularVelocity.setZero();
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
  const x0 = -215, x1 = 215, z0 = -275, z1 = 275;
  for (let py = 0; py < 190; py++) for (let px = 0; px < 150; px++) {
    const x = x0 + (x1 - x0) * px / 149, z = z0 + (z1 - z0) * py / 189, y = groundAt(x, z), o = (px + py * 150) * 4;
    const [r, gg, b] = y < WATER_Y ? [59, 127, 196] : y < 3 ? [150, 190, 95] : y < 14 ? [95, 145, 60] : y < 30 ? [140, 130, 120] : [240, 240, 240];
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
  p.got = true; p.group.visible = false;
  const slot = $('slot-' + p.id); slot.classList.add('got'); slot.textContent = p.title;
  if (p.id === 'edu') { hudOn.speed = true; $('speed').style.display = 'block'; }
  if (p.id === 'proj') { hudOn.alt = true; $('alt').style.display = 'block'; }
  if (p.id === 'pub') { hudOn.map = true; $('minimap').style.display = 'block'; }
  const firstThree = pickups.slice(0, 3).every(q => q.got);
  let extra = '';
  if (p.id !== 'exp' && firstThree && !carpetOn) { carpetOn = true; pickups[3].group.visible = true; $('slot-exp').textContent = 'Experience'; extra = '<p><b>AR navigation unlocked.</b> Follow the carpet to the last piece, up in the Valli di Lanzo.</p>'; }
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
camPos.set(START[0], groundAt(...START) + 8, START[1] + 12);

function step(dt) {
  const inAir = vehicle.wheelInfos.every(w => !w.isInContact);
  const speed = chassisBody.velocity.length();
  const engine = started && !cardOpen ? (fwd() ? 1 : back() ? -0.6 : 0) : 0;
  const steerTarget = started && !cardOpen ? (left() ? 1 : right() ? -1 : 0) * (0.55 - Math.min(0.3, speed * 0.008)) : 0;
  for (const i of [2, 3]) vehicle.applyEngineForce(-engine * 650, i);
  for (const i of [0, 1]) vehicle.applyEngineForce(-engine * 300, i);
  for (const i of [0, 1]) vehicle.setSteeringValue(steerTarget, i);
  const brake = keys.Space ? 14 : engine === 0 ? 0.6 : 0;
  for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i);
  if (inAir && started && !cardOpen) { // air control: flips and barrel rolls
    const q = chassisBody.quaternion, right = q.vmult(new CANNON.Vec3(1, 0, 0)), fwdAx = q.vmult(new CANNON.Vec3(0, 0, 1));
    const pitch = (fwd() ? 1 : 0) - (back() ? 1 : 0), roll = (right_() ? 1 : 0) - (left() ? 1 : 0);
    chassisBody.angularVelocity.vadd(right.scale(pitch * 6 * dt), chassisBody.angularVelocity);
    chassisBody.angularVelocity.vadd(fwdAx.scale(roll * 6 * dt), chassisBody.angularVelocity);
  }
  world.step(1 / 60, dt, 4);
}
const right_ = right;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  step(dt);
  // sync visuals
  car.position.copy(chassisBody.position); car.quaternion.copy(chassisBody.quaternion);
  vehicle.wheelInfos.forEach((w, i) => { vehicle.updateWheelTransform(i); wheelMeshes[i].position.copy(w.worldTransform.position); wheelMeshes[i].quaternion.copy(w.worldTransform.quaternion); });
  // camera: chase from behind, smoothed, never under the ground
  tmpQ.copy(car.quaternion); const back = tmpV.set(0, 0, -1).applyQuaternion(tmpQ); back.y = 0; if (back.lengthSq() < 1e-3) back.set(0, 0, -1); back.normalize();
  const want = car.position.clone().addScaledVector(back, 11).add(new THREE.Vector3(0, 5, 0));
  want.y = Math.max(want.y, groundAt(want.x, want.z) + 2);
  camPos.lerp(want, 1 - Math.exp(-dt * 4)); camLook.lerp(car.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 1 - Math.exp(-dt * 8));
  camera.position.copy(camPos); camera.lookAt(camLook);
  sun.position.copy(car.position).add(new THREE.Vector3(60, 110, 40)); sun.target.position.copy(car.position);
  // pickups
  for (const p of pickups) {
    if (p.got || !p.group.visible) continue;
    p.card.rotation.y = t * 1.5; p.card.position.y = 3 + Math.sin(t * 2) * 0.4;
    const d = Math.hypot(car.position.x - p.group.position.x, car.position.z - p.group.position.z);
    if (d < 4.5 && !cardOpen) collect(p);
  }
  // dog
  const dDog = Math.hypot(car.position.x - DOG_POS[0], car.position.z - DOG_POS[1]);
  if (dogState === 'waiting') {
    dog.userData.tail.rotation.y = Math.sin(t * 10) * 0.6; dog.lookAt(car.position.x, dog.position.y, car.position.z);
    if (dDog < 7 && chassisBody.velocity.length() < 6) { dogState = 'jumping'; dogJumpT = 0; dogJumpFrom.copy(dog.position); toast('Your co-pilot just jumped aboard!'); }
  } else if (dogState === 'jumping') {
    dogJumpT += dt / 0.7; const to = car.userData.seat.getWorldPosition(new THREE.Vector3());
    dog.position.lerpVectors(dogJumpFrom, to, Math.min(1, dogJumpT)); dog.position.y += Math.sin(Math.min(1, dogJumpT) * Math.PI) * 4;
    if (dogJumpT >= 1) { dogState = 'aboard'; car.userData.seat.add(dog); dog.position.set(0, 0, 0); dog.rotation.set(0, 0, 0); dog.scale.setScalar(0.85); }
  } else { dog.userData.tail.rotation.y = Math.sin(t * 12) * 0.7; dog.userData.head.rotation.y = Math.sin(t * 1.3) * 0.5; }
  updateCarpet(t);
  // HUD
  const fwdV = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion), heading = Math.atan2(fwdV.x, -fwdV.z);
  if (hudOn.speed) $('speed').innerHTML = `${Math.round(chassisBody.velocity.length() * 9)}<small>km/h (oversized)</small>`;
  if (hudOn.alt) { const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']; const hdg = (heading * 180 / Math.PI + 360) % 360; $('alt').innerHTML = `ALT ${Math.round(Math.max(0, car.position.y) * 95 + 150)} m<br>HDG ${Math.round(hdg)}° ${dirs[Math.round(hdg / 45) % 8]}`; }
  if (hudOn.map) drawMinimap(heading);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

$('loading').style.display = 'none';
const startEl = $('start'); startEl.style.display = 'flex';
const begin = () => { if (started) return; started = true; startEl.style.display = 'none'; canvas.focus(); toast('Start: the first piece is at the Politecnico, right ahead'); };
startEl.addEventListener('click', begin);
window.addEventListener('keydown', begin, { once: true });
frame();

// for automated checks
window.__coolcv = { chassisBody, pickups, groundAt, collect, keys, get dogState() { return dogState; }, get carpetOn() { return carpetOn; } };
