// Cool CV — a small off-road game in a valley ringed by mountains.
// three.js for rendering, cannon-es for physics. No build step.
import * as THREE from './vendor/three.module.min.js';
import * as CANNON from './vendor/cannon-es.min.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';

// Optional 3D models: drop .glb files in cool-cv/assets/ and they replace the box models.
// length = how long the model should be in world units; yaw = turn it so it faces +z (forward).
const ASSETS = {
  car: { url: 'assets/car.glb', length: 4.2, yaw: 0, hideWheels: true },
  dog: { url: 'assets/dog.glb', length: 1.3, yaw: 0 },
  tree: { url: 'assets/tree.glb', height: 3.4 },
  house: { url: 'assets/house.glb', length: 2.8 },
};
// Credits for the optional models (all CC BY 4.0, sketchfab.com); shown in the game once a model is in use
const CREDITS = {
  car: '“Lowpoly Offroadcar” by Pontene',
  tree: '“Stylize Tree Lowpoly” by uday',
  dog: '“Blue Heeler - Australian Cattle Dog” by DavidA3D',
  house: '“House lowpoly” by rkmorello',
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
// The map is designed in "map space" and turned 90° anticlockwise on screen into world space,
// so the final mountain stands at the back of the valley, seen from the front by the camera.
const toWorld = (mx, mz) => [mz, -mx], toMap = (x, z) => [-z, x];
const polarMap = (deg, r) => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r];
const polar = (deg, r) => toWorld(...polarMap(deg, r)); // world position of a map-space polar coordinate
const R_EDGE = 112;
const edgeR = a => R_EDGE * (1 + 0.06 * Math.sin(3 * a + 0.7) + 0.04 * Math.sin(5 * a + 2.1));
const BORDER = Array.from({ length: 120 }, (_, i) => { const a = i / 120 * Math.PI * 2, r = edgeR(a); return toWorld(Math.cos(a) * r, Math.sin(a) * r); });
const rimAt = (x, z) => { const [mx, mz] = toMap(x, z); return edgeR(Math.atan2(mz, mx)); }; // board radius in the direction of a world point
function distSegs(x, z, segs) { let best = 1e9; for (const [[ax, az], [bx, bz]] of segs) { const dx = bx - ax, dz = bz - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - ax - t * dx, z - az - t * dz); if (d < best) best = d; } return best; }
const inside = (x, z) => Math.hypot(x, z) < rimAt(x, z);
const OUTSIDE_Y = -8;
const SUMMIT_M = polarMap(30, 86), SUMMIT = toWorld(...SUMMIT_M); // the highest peak of the ring: the last CV piece sits on top
const LAKE_M = { x: -22, z: -14, r: 15 }; // a lake in the valley (map space)
const LAKE = (() => { const [x, z] = toWorld(LAKE_M.x, LAKE_M.z); return { x, z, r: LAKE_M.r }; })();
function height(wx, wz) {
  if (!inside(wx, wz)) return OUTSIDE_Y;
  const [x, z] = toMap(wx, wz); // the terrain is defined in map space
  const rr = Math.hypot(x, z) / edgeR(Math.atan2(z, x));             // 0 at the centre, 1 at the rim
  let h = 1 + fbm(x * 0.012 + 3, z * 0.012, 2) * 1.6;                  // a wide, gently rolling valley floor
  h += smooth(0.42, 0.8, rr) * (5 + 14 * Math.pow(ridge(x * 0.02, z * 0.02), 1.6)); // the mountain ring: separate peaks
  const ds = Math.hypot(x - SUMMIT_M[0], z - SUMMIT_M[1]); h += 9 * Math.exp(-(ds * ds) / (2 * 8 * 8));
  const dl = Math.hypot(x - LAKE_M.x, z - LAKE_M.z) / LAKE_M.r; if (dl < 1.4) h = Math.min(h, -1 + 2.2 * smooth(0.6, 1.4, dl) + (h - 1.2) * smooth(1, 1.4, dl));
  return h;
}

// ---------------------------------------------------------------- CV content
const CV = [
  { id: 'edu', title: 'Education & languages', where: 'the southern meadows', pos: polar(90, 52), color: 0xcf222e, unlock: 'Speedometer unlocked',
    html: `<ul><li><b>PhD, Computer Engineering</b> · Politecnico di Torino · 2022 – present</li><li><b>MSc, Cinema and Multimedia Engineering</b> · PoliTO · 2019 – 2022<br><span style="opacity:.75">Thesis: locomotion interface for VR based on seat pressure mapping</span></li><li><b>BSc, Cinema and Multimedia Engineering</b> · PoliTO · 2015 – 2019</li><li>CIFIS · 24 CFU teacher training · 2021</li></ul><p><b>Languages:</b> Italian (native) · English (C1) · French (A2) · Spanish (A1)</p>` },
  { id: 'proj', title: 'Projects & skills', where: 'the north-west slopes', pos: polar(210, 52), color: 0xcf222e, unlock: 'Altimeter & compass unlocked',
    html: `<ul><li><b>HoloACLS</b> – AR training for medical first responders (HoloLens 2)</li><li><b>Virtual Tour, Museo Paleontologico di Asti</b></li><li><b>S3lf</b> – VR storytelling with the National Film Board of Canada</li><li><b>Nexa City</b> – platform on digital rights, Nexa Center for Internet &amp; Society</li></ul><p><b>Skills:</b> experimental design, user research, prototyping, data analysis · project coordination, partnerships, teaching · Unity, Unreal Engine, CARLA, ROS2, Python · AR/VR/XR</p>` },
  { id: 'pub', title: 'Publications', where: 'the north-east foothills', pos: polar(330, 52), color: 0xcf222e, unlock: 'Minimap unlocked',
    html: `<ul><li><b>CARLA-IVR</b>: an open CARLA extension for immersive AR-HUD evaluation and reproducible experimental design – IEEE OJVT, 2026</li><li>A review of automotive AR-HUD interfaces across driver roles and automation levels – IEEE T-ITS, 2026</li><li>Towards CARLA VR: testing head-up displays in CARLA – SAI FICC, 2025</li><li>AR for warehouses: marker-based navigation and inventory – ICCSCC, 2024</li><li>The WalkingSeat: a leaning interface for VR locomotion – EuroXR, 2023</li></ul>` },
  { id: 'exp', title: 'Experience', where: 'the highest summit of the ring', pos: SUMMIT, color: 0xcf222e, unlock: 'HUD complete',
    html: `<ul><li><b>PhD researcher</b>, Politecnico di Torino (2022 – present): conceived CARLA-IVR, cutting immersive study setup from about a month to under a week; opened 8 industry and research collaborations</li><li><b>Co-lecturer &amp; thesis supervisor</b> (2023 – present): 7 master theses, 11 interdisciplinary student teams in industry challenges</li><li><b>Visiting researcher</b>, Computer Vision Center, Barcelona (2025)</li><li><b>Research assistant</b>, Reply (2023 – 2025)</li></ul>` },
];
const CARPET_ROUTE = [];
const DOG_POS = polar(150, 34); // somewhere in the valley
const PDF_URL = '../CV_Vezzani_Printable.pdf';

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
// Palette taken from the four models: olive greens (tree), mustard and cream (car), ochre and red (house),
// warm greys and slate blue (dog), cyan (house windows).
const PAL = {
  bg: 0x2e2c2d, base: 0x3a2a24, water: 0x3fb6c8, sand: 0xd2c69d, meadow: 0xa4a24c, grass: 0x858a33, olive: 0x6c6f2a,
  dirt: 0x7a5a2a, rock: 0x6e6b67, rockDark: 0x545457, rockLight: 0xaba080, snow: 0xf3f8fd, snowShade: 0xdde9f5,
  wall: 0xe7c76f, roof: 0xb4654f, tree: 0x4a4c19, ar: 0x00cfe7,
};
scene.background = new THREE.Color(PAL.bg);
// NPR: toon ramp with three hard steps, plus a soft ink darkening where surfaces turn away from the camera
const TOON_RAMP = (() => { const t = new THREE.DataTexture(new Uint8Array([95, 95, 95, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
function inkify(mat) {
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
    'float inkRim = dot(normalize(normal), normalize(vViewPosition));\n  outgoingLight *= mix(0.62, 1.0, smoothstep(0.1, 0.3, inkRim));\n  #include <opaque_fragment>'); };
  return mat;
}
const toon = (opts) => inkify(new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, ...opts }));
// NPR terrain textures, drawn in the shader in world space: two-tone patches, grass strokes, a few flowers,
// hatching on steep rock and little wave dashes on the water. They break up the flat colour fills.
function terrainToon() {
  const mat = new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, vertexColors: true });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWN;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 q = vWPos.xz; vec3 n = normalize(vWN); vec3 c = diffuseColor.rgb;
  float water = step(0.25, c.b - c.r), land = 1.0 - water;
  float green = step(0.03, c.g - c.b) * step(0.8, n.y) * land;
  float blot = vn(q * 0.05) * 0.6 + vn(q * 0.13 + 7.0) * 0.4;
  c *= 1.0 - 0.11 * step(0.63, blot) * land;                    // darker patches
  c *= 1.0 + 0.09 * step(blot, 0.3) * land;                     // lighter patches
  vec2 g = q / 2.4, cell = floor(g), fp = fract(g); float r = h21(cell);
  if (green > 0.5 && r > 0.5) {                                 // grass strokes
    vec2 d = fp - (vec2(h21(cell + 3.1), h21(cell + 7.7)) * 0.6 + 0.2);
    float stroke = max(step(abs(d.x + d.y * 0.35), 0.05) * step(abs(d.y), 0.26), step(abs(d.x - 0.12 - d.y * 0.2), 0.045) * step(abs(d.y + 0.05), 0.18));
    c = mix(c, c * 0.55, stroke);
  }
  if (green > 0.5 && r < 0.045 && blot < 0.55) {                // a few flowers
    float f = step(length(fp - 0.5), 0.1);
    c = mix(c, h21(cell + 1.3) > 0.5 ? vec3(0.86, 0.83, 0.7) : vec3(0.47, 0.14, 0.08), f);
  }
  float steep = (1.0 - smoothstep(0.5, 0.78, n.y)) * land;     // hatching on steep slopes
  c *= 1.0 - 0.32 * steep * step(0.72, fract((q.x + q.y + vWPos.y * 0.6) * 0.9));
  if (water > 0.5) {                                            // wave dashes on the lake
    vec2 w = vec2(q.x * 0.5, q.y * 1.6), wc = floor(w), wf = fract(w);
    float dash = step(0.88, h21(wc)) * step(abs(wf.y - 0.5), 0.07) * step(abs(wf.x - 0.5), 0.3);
    c = mix(c, vec3(0.75, 0.93, 0.95), dash);
  }
  diffuseColor.rgb = c;
}`)
      .replace('#include <opaque_fragment>', 'float inkRim = dot(normalize(normal), normalize(vViewPosition));\n  outgoingLight *= mix(0.62, 1.0, smoothstep(0.1, 0.3, inkRim));\n  #include <opaque_fragment>');
  };
  return mat;
}
function toonify(root) { // swap a model's PBR materials for toon ones with the same colours and textures
  root.traverse(o => { if (!o.isMesh) return;
    const conv = m => {
      const col = m.color.clone();
      if (/telhado|roof/i.test(m.name)) col.set(PAL.roof);                  // house roof: muted terracotta instead of bright orange
      else if (col.r > 0.6 && col.g < 0.05 && col.b < 0.05) col.set(0x9a4a3c); // the house's red details, muted too
      return toon({ color: col, map: m.map || null, transparent: false, opacity: 1, side: m.side }); // models are always opaque
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material); o.castShadow = true; });
  return root;
}
let VIEW = 19.5; // half height of the view, in world units
const camera = new THREE.OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, -200, 600);
const CAM_OFFSET = new THREE.Vector3(0, 1, 0.9).normalize().multiplyScalar(160); // from the south, looking down ~48°
scene.add(new THREE.HemisphereLight(0xfff6e0, 0x6c6f2a, 1.0));
const sun = new THREE.DirectionalLight(0xfff1cc, 2.0);
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
{ // NPR terrain: one flat palette colour per face (hard cartoon bands), smooth normals for clean toon shading
  const pos = new Float32Array(N * N * 3), idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = i + j * N; pos.set([-HALF + i * ES, heights[k], -HALF + j * ES], k * 3); }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = i + j * N, b = a + 1, c = a + N, d = c + 1; idx.push(a, c, b, b, c, d); }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  g = g.toNonIndexed();
  const P = g.attributes.position.array, col = new Float32Array(P.length), c = new THREE.Color(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let f = 0; f < P.length / 9; f++) {
    const o = f * 9, y = (P[o + 1] + P[o + 4] + P[o + 7]) / 3, cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
    e1.set(P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]); e2.set(P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]);
    const ny = Math.abs(e1.cross(e2).normalize().y); // 1 = flat, 0 = vertical
    const jitter = (hash(Math.floor(cx * 3), Math.floor(cz * 3)) - 0.5) * 1.2; // ragged band edges
    const ymin = Math.min(P[o + 1], P[o + 4], P[o + 7]);
    let hex;
    if (y <= OUTSIDE_Y + 1) hex = PAL.bg;
    else if (ymin <= OUTSIDE_Y + 0.5) hex = PAL.bg; // the board's cut edge, as dark as the background
    else if (y < WATER_Y) hex = PAL.water;
    else if (y < WATER_Y + 0.4) hex = PAL.sand;
    else if (y > 15.5 + jitter && ny > 0.4) hex = (hash(Math.floor(cx), Math.floor(cz)) > 0.7 ? PAL.snowShade : PAL.snow);
    else if (ny < 0.6) hex = y > 9 ? PAL.rockDark : PAL.dirt;
    else if (y > 13 + jitter) hex = PAL.rockLight;
    else if (y > 8.5 + jitter) hex = PAL.rock;
    else if (y > 4.5 + jitter) hex = PAL.olive;
    else if (y > 2.2 + jitter * 0.5) hex = PAL.grass;
    else hex = PAL.meadow;
    c.set(hex); for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], o + v * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  { // drop the faces outside the board and on its cut edge: the background shows through, the same dark everywhere
    const N0 = g.attributes.normal.array, keep = [];
    for (let f = 0; f < P.length / 9; f++) { const o = f * 9; if (Math.min(P[o + 1], P[o + 4], P[o + 7]) > OUTSIDE_Y + 0.5) keep.push(f); }
    const pk = new Float32Array(keep.length * 9), nk = new Float32Array(keep.length * 9), ck = new Float32Array(keep.length * 9);
    keep.forEach((f, i) => { pk.set(P.subarray(f * 9, f * 9 + 9), i * 9); nk.set(N0.subarray(f * 9, f * 9 + 9), i * 9); ck.set(col.subarray(f * 9, f * 9 + 9), i * 9); });
    g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pk, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nk, 3)); g.setAttribute('color', new THREE.BufferAttribute(ck, 3));
  }
  const terrain = new THREE.Mesh(g, terrainToon());
  terrain.receiveShadow = true; scene.add(terrain);
}

// ---------------------------------------------------------------- physics world
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }); // the crawler never leaves the ground
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
  const pos = [], col = [], idx = [], rock = new THREE.Color(PAL.rock), rock2 = new THREE.Color(PAL.rockDark), snow = new THREE.Color(PAL.snow), c = new THREE.Color();
  BORDER.forEach(([x, z], i) => {
    let g = -1e9; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g = Math.max(g, groundAt(x + Math.cos(a) * 4, z + Math.sin(a) * 4)); }
    const top = Math.max(g, 1) + 8 + 5 * ridge(x * 0.1, z * 0.1);
    pos.push(x, OUTSIDE_Y, z, x, top, z);
    c.copy(rock2); col.push(c.r, c.g, c.b); c.copy(top > 16 ? snow : rock); col.push(c.r, c.g, c.b);
    const j = (i + 1) % BORDER.length; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1);
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const wall = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: PAL.bg, side: THREE.DoubleSide, transparent: true, opacity: 1 })); // same colour as the background wall.castShadow = true; wall.receiveShadow = true; scene.add(wall);
  borderWall = wall;
}

// ---------------------------------------------------------------- the 4x4
const START = [0, 8];
const SIZE_K = 0.6; // crawler and dog at 60% of their former size
const CAR_SCALE = 2 * SIZE_K;
const chassisBody = new CANNON.Body({ mass: 320, angularDamping: 0.5, linearDamping: 0.02 });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(2.0 * SIZE_K, 1.0 * SIZE_K, 3.6 * SIZE_K))); // only meets the border cliffs
chassisBody.position.set(START[0], groundAt(...START) + 4, START[1]);
chassisBody.quaternion.setFromEuler(0, Math.PI, 0); // face north
chassisBody.fixedRotation = true; chassisBody.updateMassProperties(); // orientation comes from the terrain, not from collisions
world.addBody(chassisBody);
const RIDE = 2.55 * SIZE_K; // height of the car's centre above the ground when it sits on its wheels
const WHEEL_R = 1.24 * SIZE_K, AX = 2.1 * SIZE_K, AZ = 2.7 * SIZE_K;
const WHEELS = [[AX, AZ], [-AX, AZ], [AX, -AZ], [-AX, -AZ]].map(([x, z]) => new CANNON.Vec3(x, -1.3 * SIZE_K, z));

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
const carAxles = [];
{ // the driver: a small stylised person at the wheel
  const d = new THREE.Group(), m = c => toon({ color: c });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8), m(0x566c8d)); body.position.y = 0.3; d.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), m(0xe9c9a6)); head.position.y = 0.78; d.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 10), m(0xcf222e)); cap.position.y = 0.95; d.add(cap);
  d.traverse(o => { if (o.isMesh) o.castShadow = true; });
  d.position.set(0.32, 0.2, 0.15); car.add(d); car.userData.driver = d;
}
car.userData.seat = new THREE.Object3D(); car.userData.seat.position.set(0, -0.32, -1.1); car.add(car.userData.seat); // the back of the crawler
const wheelMeshes = WHEELS.map(() => {
  const g = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 1.0 * SIZE_K, 12); g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x1d1d1d, flatShading: true })); m.castShadow = true; scene.add(m); return m;
});

// ---------------------------------------------------------------- scenery
const SCENERY = { houses: [], trees: [], houseMeshes: [], treeMesh: null };
// Houses stand in small solid groups; trees (in groves and loose) can be driven through.
{
  const keepClear = [START, DOG_POS, ...CV.map(c => c.pos)];
  const free = (x, z, r) => inside(x, z) && Math.hypot(x, z) < rimAt(x, z) - 8 && keepClear.every(([px, pz]) => Math.hypot(x - px, z - pz) > r) && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.3;
  const solid = (x, y, z, hx, hy, hz, rot) => { const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz))); b.position.set(x, y + hy, z); b.quaternion.setFromEuler(0, rot, 0); world.addBody(b); };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), C = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
  // hamlets
  const HAMLETS = [[0, 30], [60, 32], [130, 24], [175, 40], [250, 30], [300, 38], [15, 62], [195, 70], [270, 64]];
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2, 2.4), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 60);
  const roofGeo = new THREE.ConeGeometry(2.1, 1.5, 4); roofGeo.rotateY(Math.PI / 4);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 60);
  const wallCols = [PAL.wall, PAL.wall, PAL.sand, PAL.wall], roofCols = [PAL.roof, PAL.roof, PAL.dirt, PAL.roof];
  let n = 0, seed = 1;
  for (const [deg, r] of HAMLETS) {
    const [cx, cz] = polar(deg, r); if (!free(cx, cz, 16)) continue;
    const count = 4 + Math.floor(hash(deg, r) * 3);
    for (let k = 0, tries = 0; k < count && tries < 30 && n < 60; tries++) {
      seed++; const a = hash(seed, 3) * Math.PI * 2, d = 3.5 + hash(seed, 5) * 9, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = groundAt(x, z);
      if (!free(x, z, 12) || y < WATER_Y + 0.4) continue;
      const scTry = (0.85 + hash(seed, 9) * 0.3) * 1.5;
      if (SCENERY.houses.some(o => Math.hypot(x - o.x, z - o.z) < 1.6 * (o.sc + scTry) + 1)) continue; // keep a gap between houses
      const HOUSE_K = 1.5; // houses at 1.5x
      const sc = (0.85 + hash(seed, 9) * 0.3) * HOUSE_K, h = (0.8 + hash(seed, 11) * 0.4) * HOUSE_K, rot = hash(seed, 13) * Math.PI;
      Q.setFromAxisAngle(Y, rot);
      M.compose(V.set(x, y + h, z), Q, S.set(sc, h, sc)); walls.setMatrixAt(n, M); walls.setColorAt(n, C.set(wallCols[seed % 4]));
      M.compose(V.set(x, y + 2 * h + 0.75 * sc, z), Q, S.set(sc, sc, sc)); roofs.setMatrixAt(n, M); roofs.setColorAt(n, C.set(roofCols[seed % 4]));
      solid(x, y, z, 1.2 * sc, h + 0.6, 1.2 * sc, rot); SCENERY.houses.push({ x, y, z, rot, sc });
      n++; k++;
    }
  }
  walls.count = roofs.count = n; walls.castShadow = roofs.castShadow = true; walls.receiveShadow = true; scene.add(walls, roofs);
  SCENERY.houseMeshes = [walls, roofs];
  // groves and loose trees, no colliders
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 2.6, 6), toon({ color: PAL.tree }), 220);
  let t = 0;
  const GROVES = [[20, 18], [80, 20], [110, 45], [150, 55], [200, 18], [230, 48], [280, 22], [320, 70], [100, 72], [355, 30]];
  for (const [deg, r] of GROVES) {
    const [cx, cz] = polar(deg, r); if (!free(cx, cz, 14)) continue;
    for (let k = 0, tries = 0; k < 9 && tries < 40; tries++) {
      seed++; const a = hash(seed, 17) * Math.PI * 2, d = Math.sqrt(hash(seed, 19)) * 7, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = groundAt(x, z);
      if (!free(x, z, 11) || y < WATER_Y + 0.5) continue;
      const sc = 0.9 + hash(seed, 23) * 0.6; M.makeScale(sc, sc, sc).setPosition(x, y + 1.2 * sc, z); trees.setMatrixAt(t++, M); SCENERY.trees.push({ x, y, z, sc, rot: hash(seed, 41) * 6.28 });
      k++;
    }
  }
  for (let k = 0, tries = 0; k < 45 && tries < 2000; tries++) {
    seed++; const x = (hash(seed, 29) - 0.5) * 2 * R_EDGE, z = (hash(seed, 31) - 0.5) * 2 * R_EDGE, y = groundAt(x, z);
    if (!free(x, z, 6) || y < WATER_Y + 0.5 || y > 12) continue;
    const sc = 0.7 + hash(seed, 37) * 0.6; M.makeScale(sc, sc, sc).setPosition(x, y + 1.2 * sc, z); trees.setMatrixAt(t++, M); SCENERY.trees.push({ x, y, z, sc, rot: hash(seed, 43) * 6.28 }); k++;
  }
  trees.count = t; trees.castShadow = true; scene.add(trees);
  SCENERY.treeMesh = trees;
}

// ---------------------------------------------------------------- pickups
// the last piece sits on the highest point near the summit
{ const exp = CV.find(c => c.id === 'exp'); let [bx, bz] = exp.pos, best = -1e9;
  for (let dx = -5; dx <= 5; dx += 0.5) for (let dz = -5; dz <= 5; dz += 0.5) { const h = groundAt(exp.pos[0] + dx, exp.pos[1] + dz); if (h > best) { best = h; bx = exp.pos[0] + dx; bz = exp.pos[1] + dz; } }
  exp.pos = [bx, bz];
  // the carpet comes in from the side: it runs along the foot of the mountain, then climbs across its face to the top
  const side = bx > 0 ? -1 : 1; // approach from the side that faces the middle of the board
  const route = [START, [bx + side * 40, bz + 26], [bx + side * 30, bz + 14], [bx + side * 20, bz + 7], [bx + side * 10, bz + 2], [bx, bz]]
    .map(([x, z]) => { const r = Math.hypot(x, z), m = rimAt(x, z) - 10; return r > m ? [x * m / r, z * m / r] : [x, z]; });
  route[route.length - 1] = [bx, bz];
  // keep the carpet out of the villages: plan the valley part on a grid (A*) around the houses,
  // then follow the side approach up the mountain
  const CELL = 2, HALFG = 122, NG = Math.ceil(2 * HALFG / CELL), CLEAR = 8;
  const blocked = new Uint8Array(NG * NG), cellXZ = i => [-HALFG + (i % NG + 0.5) * CELL, -HALFG + (Math.floor(i / NG) + 0.5) * CELL];
  for (let i = 0; i < NG * NG; i++) { const [x, z] = cellXZ(i);
    if (!inside(x, z) || Math.hypot(x, z) > rimAt(x, z) - 10) { blocked[i] = 1; continue; }
    for (const hs of SCENERY.houses) if (Math.hypot(x - hs.x, z - hs.z) < CLEAR + hs.sc * 1.5) { blocked[i] = 1; break; } }
  const idx = (x, z) => Math.max(0, Math.min(NG - 1, Math.floor((x + HALFG) / CELL))) + Math.max(0, Math.min(NG - 1, Math.floor((z + HALFG) / CELL))) * NG;
  function astar(from, to) {
    const s0 = idx(...from), g0 = idx(...to), gs = new Float32Array(NG * NG).fill(Infinity), came = new Int32Array(NG * NG).fill(-1), heap = [];
    const [tx, tz] = cellXZ(g0), hf = i => { const [x, z] = cellXZ(i); return Math.hypot(x - tx, z - tz); };
    const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    gs[s0] = 0; push(s0, hf(s0));
    while (heap.length) {
      const [, c] = pop(); if (c === g0) break;
      const cx = c % NG, cz = Math.floor(c / NG);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= NG || nz >= NG) continue; const n = nx + nz * NG; if (blocked[n] && n !== g0) continue;
        const ng = gs[c] + Math.hypot(dx, dz) * CELL; if (ng < gs[n]) { gs[n] = ng; came[n] = c; push(n, ng + hf(n)); } }
    }
    if (came[g0] < 0) return [from, to];
    const out = []; for (let c = g0; c >= 0; c = came[c]) out.push(cellXZ(c)); out.reverse(); out[0] = from; out[out.length - 1] = to; return out;
  }
  for (let w = 1; w < route.length - 1; w++) { // move any waypoint that falls next to a house to the nearest free spot
    if (!blocked[idx(...route[w])]) continue;
    let best = null; for (let r = CELL; r <= 16 && !best; r += CELL) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, x = route[w][0] + Math.cos(a) * r, z = route[w][1] + Math.sin(a) * r; if (!blocked[idx(x, z)]) { best = [x, z]; break; } }
    if (best) route[w] = best;
  }
  for (let w = route.length - 2; w >= 1; w--) { // drop a waypoint that would make the carpet double back on itself
    const a = route[w - 1], q = route[w], c = route[w + 1], v1x = q[0] - a[0], v1z = q[1] - a[1], v2x = c[0] - q[0], v2z = c[1] - q[1];
    if (Math.abs(Math.atan2(v1x * v2z - v1z * v2x, v1x * v2x + v1z * v2z)) > 1.6) route.splice(w, 1); }
  let dense = [route[0]];
  for (let w = 0; w < route.length - 1; w++) dense.push(...astar(route[w], route[w + 1]).slice(1)); // chain A* between the waypoints
  { // resample at an even step, then relax the line many times so every bend is a wide curve, never into a blocked cell
    const STEP = 1.5, even = [dense[0]]; let carry = 0;
    for (let i = 1; i < dense.length; i++) { const a = dense[i - 1], c = dense[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let d = STEP - carry; d < L; d += STEP) even.push([a[0] + (c[0] - a[0]) * d / L, a[1] + (c[1] - a[1]) * d / L]);
      carry = (carry + L) % STEP; }
    even.push([...dense[dense.length - 1]]); dense = even;
    const near = (x, z) => SCENERY.houses.some(hs => Math.hypot(x - hs.x, z - hs.z) < 5.5 + hs.sc * 1.5) || (Math.hypot(x, z) > rimAt(x, z) - 10 && Math.hypot(x - exp.pos[0], z - exp.pos[1]) > 12); // a little closer to the houses than the planner, the summit itself is outside the rim
    for (let k = 0; k < 160; k++) for (let i = 1; i < dense.length - 1; i++) {
      const a = dense[i - 1], c = dense[i + 1], q = dense[i], nx = (a[0] + q[0] + c[0]) / 3, nz = (a[1] + q[1] + c[1]) / 3;
      if (!near(nx, nz)) { q[0] = nx; q[1] = nz; } }
  }
  CARPET_ROUTE.length = 0; CARPET_ROUTE.push(...dense); }
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
  dog.scale.setScalar(3.3 * SIZE_K);
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
  toonify(root);
  return root;
}
function swapIn(group, gltf, cfg, yOffset, keep = []) {
  for (const ch of [...group.children]) if (!keep.includes(ch)) ch.visible = false;
  const holder = new THREE.Group(); holder.add(fitModel(gltf.scene, cfg.length, cfg.yaw)); holder.position.y = yOffset; group.add(holder);
  if (gltf.animations?.length) { const m = new THREE.AnimationMixer(gltf.scene); m.clipAction(gltf.animations[0]).play(); mixers.push(m); }
}
const gltfLoader = new GLTFLoader();
gltfLoader.load(ASSETS.car.url, g => {
  g.scene.traverse(o => { if (/^tire_/.test(o.name)) carAxles.push(o); }); /* the two axles spin about their own centre */
  swapIn(car, g, ASSETS.car, ASSETS.car.hideWheels ? -1.27 : -0.65, [car.userData.seat, car.userData.driver]); if (ASSETS.car.hideWheels) wheelMeshes.forEach(w => (w.visible = false)); usedCredits.add('car'); }, undefined, () => {});
gltfLoader.load(ASSETS.dog.url, g => { swapIn(dog, g, ASSETS.dog, 0); dog.userData.custom = true; usedCredits.add('dog'); }, undefined, () => {});
function fitHeight(root, height) { // scale a model to a given height, feet on the ground, centred
  root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(root), size = b.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(height / Math.max(size.y, 1e-6)); root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root), c = b2.getCenter(new THREE.Vector3()); root.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  toonify(root); return root;
}
gltfLoader.load(ASSETS.tree.url, g => {
  const proto = fitHeight(g.scene, ASSETS.tree.height);
  for (const t of SCENERY.trees) { const h = new THREE.Group(); h.add(proto.clone(true)); h.position.set(t.x, t.y, t.z); h.rotation.y = t.rot; h.scale.setScalar(t.sc); scene.add(h); }
  SCENERY.treeMesh.visible = false; usedCredits.add('tree');
}, undefined, () => {});
gltfLoader.load(ASSETS.house.url, g => {
  const proto = fitModel(g.scene, ASSETS.house.length, 0);
  for (const t of SCENERY.houses) { const h = new THREE.Group(); h.add(proto.clone(true)); h.position.set(t.x, t.y, t.z); h.rotation.y = t.rot; h.scale.setScalar(t.sc); scene.add(h); }
  SCENERY.houseMeshes.forEach(m => (m.visible = false)); usedCredits.add('house');
}, undefined, () => {});
const usedCredits = new Set();
const creditsHtml = () => usedCredits.size ? `<p style="font-size:11px;opacity:.7;margin-top:12px">3D models (CC BY 4.0, Sketchfab): ${[...usedCredits].map(k => CREDITS[k]).join(' · ')}</p>` : '';

let dogSide = 1, dogTurnT = 4;
let dogState = 'waiting', dogJumpT = 0; const dogJumpFrom = new THREE.Vector3();

// ---------------------------------------------------------------- AR carpet
const CHEVRONS = 46;
const chevGeo = (() => { const s = new THREE.Shape(); s.moveTo(-1.1, -0.5); s.lineTo(0, 0.4); s.lineTo(1.1, -0.5); s.lineTo(1.1, 0.0); s.lineTo(0, 0.9); s.lineTo(-1.1, 0.0); s.closePath(); const g = new THREE.ShapeGeometry(s); g.scale(0.75, 0.75, 0.75); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI); return g; })();
const chevMat = new THREE.MeshBasicMaterial({ color: PAL.ar, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
const chevrons = Array.from({ length: CHEVRONS }, () => { const m = new THREE.Mesh(chevGeo, chevMat.clone()); m.visible = false; scene.add(m); return m; });
let carpetOn = false;
let carpetSeg = 0; // the route segment the car has reached; the carpet only moves forward along the spiral
function carpetPath(px, pz) {
  const route = CARPET_ROUTE; let best = 1e9, bi = 0, bp = null;
  const scan = (from, to) => { for (let i = Math.max(0, from); i < Math.min(route.length - 1, to); i++) {
    const [ax, az] = route[i], [bx, bz] = route[i + 1], dx = bx - ax, dz = bz - az;
    let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz); t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qz = az + t * dz, d = Math.hypot(px - qx, pz - qz); if (d < best) { best = d; bi = i; bp = [qx, qz]; }
  } };
  scan(carpetSeg - 1, carpetSeg + 5);           // follow the spiral turn by turn…
  if (best > 18) { best = 1e9; scan(0, route.length); } // …unless the car went somewhere else entirely
  if (best < 8) carpetSeg = Math.max(carpetSeg, bi);
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
    along += 1.9; k++;
  }
  for (; k < CHEVRONS; k++) chevrons[k].visible = false;
}

// ---------------------------------------------------------------- people and animals
// Stylised walkers that wander the valley; with the 2nd fragment they get red AR bounding boxes.
const walkers = [];
{
  const mat = c => toon({ color: c });
  const boxMat = new THREE.LineBasicMaterial({ color: 0xff2d2d });
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false }); // writes depth only, so the back edges of the box are hidden
  const frame = (w, h, d) => {
    const g = new THREE.Group(); g.position.y = h / 2; g.visible = false; g.userData.isBox = true;
    const occ = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, h * 0.98, d * 0.98), occMat); occ.renderOrder = 9; g.add(occ);
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), boxMat); l.renderOrder = 10; g.add(l);
    return g;
  };
  function sheep() {
    const g = new THREE.Group(), add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    add(new THREE.BoxGeometry(1.3, 1.0, 1.9), mat(PAL.snow), 0, 1.15, 0);
    add(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat(0x353335), 0, 1.45, 1.15);
    for (const [x, z] of [[-0.4, 0.6], [0.4, 0.6], [-0.4, -0.6], [0.4, -0.6]]) add(new THREE.BoxGeometry(0.22, 0.65, 0.22), mat(0x353335), x, 0.33, z);
    g.add(frame(1.8, 2.0, 2.8)); return g;
  }
  function person(shirt) {
    const g = new THREE.Group(), add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    add(new THREE.CylinderGeometry(0.42, 0.5, 1.3, 8), mat(shirt), 0, 1.35, 0);
    add(new THREE.SphereGeometry(0.38, 10, 8), mat(0xe9c9a6), 0, 2.3, 0);
    for (const x of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.24, 0.75, 0.26), mat(0x353335), x, 0.38, 0);
    g.add(frame(1.3, 2.8, 1.3)); return g;
  }
  const spots = [[100, 30], [120, 36], [200, 30], [260, 40], [300, 26], [40, 40], [160, 20], [340, 44], [80, 44], [235, 44], [10, 28], [280, 36]];
  spots.forEach(([deg, r], i) => {
    const home = polar(deg, r), isSheep = i % 3 !== 0;
    const count = isSheep ? 3 : 1;
    for (let k = 0; k < count; k++) {
      const g = isSheep ? sheep() : person([PAL.wall, 0x566c8d, PAL.roof, PAL.olive][i % 4]);
      const x = home[0] + (k - 1) * 3, z = home[1] + (k % 2) * 3;
      if (groundAt(x, z) < WATER_Y + 0.6) continue; // never start in the lake
      g.position.set(x, groundAt(x, z), z); scene.add(g);
      walkers.push({ g, home, speed: isSheep ? 1.4 : 2.4, target: [x, z], wait: Math.random() * 2, knocked: 0, kind: isSheep ? 'sheep' : 'person' });
    }
  });
}
function showBoxes(on) { for (const w of walkers) w.g.children.forEach(c => { if (c.userData.isBox) c.visible = on; }); }
let hitToastT = 0;
function updateWalkers(dt, t) {
  const cp = chassisBody.position; hitToastT -= dt;
  for (const w of walkers) {
    const p = w.g.position;
    if (w.knocked > 0) { // tipped over by the crawler: lie down, then get back up
      w.knocked -= dt; w.g.rotation.z = Math.min(1, w.knocked) * Math.PI / 2; if (w.knocked <= 0) w.g.rotation.z = 0; continue;
    }
    const dc = Math.hypot(p.x - cp.x, p.z - cp.z);
    if (dc < 3.6 * SIZE_K + 0.8) { w.knocked = 1.8; play(w.kind === 'sheep' ? 'sheep' : 'person', 0.7); if (hitToastT <= 0) { toast(w.kind === 'sheep' ? 'Baa! Mind the sheep' : 'Hey! Watch where you drive'); hitToastT = 3; } chassisBody.velocity.scale(0.3, chassisBody.velocity); continue; }
    let speed = w.speed;
    if (w.scared > 0) { w.scared -= dt; speed *= 3; }
    else if (dc < 11) { // step aside when the crawler gets close
      const ax = p.x - cp.x, az = p.z - cp.z, l = Math.hypot(ax, az) || 1; w.target = [p.x + ax / l * 8, p.z + az / l * 8]; speed *= 2.2; w.wait = 0;
    } else if (w.wait > 0) { w.wait -= dt; continue; }
    const dx = w.target[0] - p.x, dz = w.target[1] - p.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { // pick a new spot near home, on gentle ground
      for (let k = 0; k < 8; k++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 14, tx = w.home[0] + Math.cos(a) * r, tz = w.home[1] + Math.sin(a) * r, ty = groundAt(tx, tz);
        if (ty > WATER_Y + 0.5 && ty < 7) { w.target = [tx, tz]; break; } }
      w.wait = 1 + Math.random() * 3; continue;
    }
    const step = Math.min(d, speed * dt), nx = p.x + dx / d * step, nz = p.z + dz / d * step;
    if (groundAt(nx, nz) < WATER_Y + 0.3) { w.target = [p.x, p.z]; continue; }
    p.set(nx, groundAt(nx, nz) + Math.abs(Math.sin(t * speed * 4)) * 0.18, nz); w.g.rotation.y = Math.atan2(dx, dz);
  }
}

// ---------------------------------------------------------------- dust, splashes and snow behind the wheels
const PARTS = 320, parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff }), PARTS);
parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parts.frustumCulled = false; scene.add(parts);
const pState = Array.from({ length: PARTS }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }));
let pNext = 0;
const SURF = { water: [0x9fe3ec, 0xffffff, PAL.water], snow: [0xffffff, PAL.snow, 0xdfe7ee], earth: [PAL.dirt, 0xa08a5a, 0x58421b], grass: [PAL.dirt, PAL.olive, PAL.grass], rock: [PAL.rock, PAL.rockLight, PAL.rockDark], sand: [PAL.sand, 0xe8dcb4, PAL.dirt] };
function surfaceAt(x, z) {
  const y = groundAt(x, z), e = 1, sl = Math.hypot(groundAt(x + e, z) - groundAt(x - e, z), groundAt(x, z + e) - groundAt(x, z - e)) / (2 * e);
  if (y < WATER_Y) return 'water'; if (y < WATER_Y + 0.4) return 'sand'; if (y > 15.5) return 'snow';
  if (sl > 1.3) return 'earth'; if (y > 8.5) return 'rock'; return y > 4.5 ? 'earth' : 'grass';
}
const tmpC = new THREE.Color(), tmpM = new THREE.Matrix4();
for (let i = 0; i < PARTS; i++) { parts.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); parts.setColorAt(i, tmpC.set(0xffffff)); }
function updateParticles(dt) {
  const v = chassisBody.velocity, sp = Math.hypot(v.x, v.z);
  if (sp > 3 && started && !cardOpen) {
    const fx = Math.sin(carYaw), fz = Math.cos(carYaw), n = sp > 10 ? 3 : 2;
    for (const wi of [2, 3]) for (let k = 0; k < n; k++) { // rear wheels
      const wp = chassisBody.pointToWorldFrame(WHEELS[wi], new CANNON.Vec3()), surf = surfaceAt(wp.x, wp.z), q = pState[pNext];
      q.life = 0.5 + Math.random() * 0.4; q.x = wp.x - fx * WHEEL_R; q.z = wp.z - fz * WHEEL_R; q.y = groundAt(wp.x, wp.z) + 0.3;
      const kick = surf === 'water' ? 1.6 : 1;
      q.vx = -fx * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3; q.vz = -fz * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3; q.vy = (3 + Math.random() * 4) * kick;
      q.s = (surf === 'snow' || surf === 'water' ? 1.2 : 1) * (0.7 + Math.random() * 0.6);
      const cols = SURF[surf]; parts.setColorAt(pNext, tmpC.set(cols[(Math.random() * cols.length) | 0])); pNext = (pNext + 1) % PARTS;
    }
    parts.instanceColor.needsUpdate = true;
  }
  for (let i = 0; i < PARTS; i++) {
    const q = pState[i]; if (q.life <= 0) continue;
    q.life -= dt; q.vy -= 16 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    const g = groundAt(q.x, q.z); if (q.y < g) { q.y = g; q.vy *= -0.2; q.vx *= 0.6; q.vz *= 0.6; }
    const s = Math.max(0, q.life) * 1.6 * q.s; parts.setMatrixAt(i, tmpM.makeScale(s, s, s).setPosition(q.x, q.y, q.z));
  }
  parts.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- horn (or bark) and confetti
const SFX = { honk: new Audio('assets/sfx/honk.mp3'), bark: new Audio('assets/sfx/bark.mp3'), sheep: new Audio('assets/sfx/sheep.mp3'), person: new Audio('assets/sfx/person.mp3'), fanfare: new Audio('assets/sfx/fanfare.mp3') };
Object.values(SFX).forEach(a => { a.preload = 'auto'; });
function play(name, volume = 0.8) { try { const a = SFX[name].cloneNode(); a.volume = volume; a.play().catch(() => {}); } catch (e) {} }
let audioCtx = null;
function beep(freqs, dur, type, gain) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const g = audioCtx.createGain(); g.gain.setValueAtTime(gain, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur); g.connect(audioCtx.destination);
    for (const f of freqs) { const o = audioCtx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, audioCtx.currentTime); if (type === 'sawtooth') o.frequency.exponentialRampToValueAtTime(f * 0.6, audioCtx.currentTime + dur); o.connect(g); o.start(); o.stop(audioCtx.currentTime + dur); }
  } catch (e) {}
}
const shouts = []; // comic "!" lines
const shoutMat = new THREE.MeshBasicMaterial({ color: 0x24292f, depthTest: false });
function shout(origin, dir) {
  const g = new THREE.Group(); g.position.copy(origin); g.renderOrder = 20;
  const yaw = Math.atan2(dir.x, dir.z);
  for (const a of [-0.55, 0, 0.55]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 1.6), shoutMat); bar.renderOrder = 20;
    const holder = new THREE.Group(); holder.rotation.set(-0.5, yaw + a, 0); bar.position.z = 2.2; holder.add(bar); g.add(holder);
  }
  scene.add(g); shouts.push({ g, t: 0 });
}
function honk() {
  const fwdDir = new THREE.Vector3(Math.sin(carYaw), 0, Math.cos(carYaw));
  if (dogState === 'aboard') { // the dog barks instead, and the lines come from the dog
    play('bark');
    shout(dog.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.6, 0)), fwdDir); toast('Woof! Woof!');
  } else {
    play('honk', 0.6);
    shout(car.position.clone().addScaledVector(fwdDir, 4.6 * SIZE_K).add(new THREE.Vector3(0, 1.2 * SIZE_K, 0)), fwdDir); toast('Beep beep!');
  }
  for (const w of walkers) { // everyone nearby runs off
    const p = w.g.position, d = Math.hypot(p.x - chassisBody.position.x, p.z - chassisBody.position.z);
    if (d < 30) { w.scared = 3; const ax = p.x - chassisBody.position.x, az = p.z - chassisBody.position.z, l = d || 1; w.target = [p.x + ax / l * 14, p.z + az / l * 14]; w.wait = 0; }
  }
}
function updateShouts(dt) {
  for (let i = shouts.length - 1; i >= 0; i--) {
    const s = shouts[i]; s.t += dt; const k = s.t / 0.7;
    s.g.children.forEach(h => { const bar = h.children[0]; bar.position.z = 2 + k * 2.2; bar.scale.setScalar(1 - k * 0.6); });
    s.g.visible = Math.floor(s.t * 14) % 2 === 0 || k < 0.4;
    if (k >= 1) { scene.remove(s.g); shouts.splice(i, 1); }
  }
}
// confetti for the last fragment
const CONF = 260, conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONF);
conf.instanceMatrix.setUsage(THREE.DynamicDrawUsage); conf.frustumCulled = false; scene.add(conf);
const cState = Array.from({ length: CONF }, () => ({ life: 0 }));
{ const m = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(); for (let i = 0; i < CONF; i++) { conf.setMatrixAt(i, m); conf.setColorAt(i, c.set(0xffffff)); } }
function confetti() {
  const cols = [0xcf222e, PAL.wall, PAL.ar, PAL.grass, PAL.snow, 0x566c8d, PAL.roof], c = new THREE.Color();
  cState.forEach((q, i) => {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
    Object.assign(q, { life: 2.5 + Math.random() * 1.5, x: car.position.x, y: car.position.y + 3, z: car.position.z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 14 + Math.random() * 12, rx: Math.random() * 6, ry: Math.random() * 6, wr: 4 + Math.random() * 8 });
    conf.setColorAt(i, c.set(cols[i % cols.length]));
  });
  conf.instanceColor.needsUpdate = true;
  play('fanfare', 0.8); // victory
}
const cM = new THREE.Matrix4(), cQ = new THREE.Quaternion(), cE = new THREE.Euler(), cS = new THREE.Vector3(1, 1, 1), cP = new THREE.Vector3();
function updateConfetti(dt) {
  let any = false;
  for (let i = 0; i < CONF; i++) {
    const q = cState[i]; if (q.life <= 0) continue; any = true;
    q.life -= dt; q.vy -= 9 * dt; q.vx *= 0.99; q.vz *= 0.99; if (q.vy < -4) q.vy = -4; // flutter down slowly
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.rx += q.wr * dt; q.ry += q.wr * 0.7 * dt;
    cQ.setFromEuler(cE.set(q.rx, q.ry, 0)); cS.setScalar(q.life > 0 ? Math.min(1, q.life) : 0);
    conf.setMatrixAt(i, cM.compose(cP.set(q.x, Math.max(q.y, groundAt(q.x, q.z) + 0.1), q.z), cQ, cS));
  }
  if (any) conf.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- input
const keys = {};
const EMBEDDED = new URLSearchParams(location.search).has('embedded') && window.parent !== window; // inside the CV page
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'KeyH', 'Enter'];
window.addEventListener('keydown', e => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (cardOpen) { if (!e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape')) closeCard(); return; } // keys pressed over a card never drive the crawler
  const first = !keys[e.code]; keys[e.code] = true;
  if (!started) return;
  if (first && e.code === 'KeyC') toggleMode();
  if (first && (e.code === 'KeyH' || e.code === 'Space')) honk();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
const releaseKeys = () => { for (const k in keys) keys[k] = false; }; // a key released while the page had the focus never reaches us
window.addEventListener('blur', releaseKeys); document.addEventListener('visibilitychange', releaseKeys);
const fwd = () => keys.ArrowUp, back = () => keys.ArrowDown, left = () => keys.ArrowLeft, right = () => keys.ArrowRight;
function toggleMode() {
  driveMode = driveMode === 'map' ? 'car' : 'map';
  toast(driveMode === 'map' ? 'Simplified controls: arrows point the crawler' : 'Car controls: ↑ gas, ↓ reverse, ← → steer');
}
const HELP = { map: 'Arrows: point and go · C: car controls', car: 'Up: gas · Down: reverse · Left/Right: steer · C: map controls' };


// ---------------------------------------------------------------- HUD
const $ = id => document.getElementById(id);
function updateFrags() { const got = pickups.filter(q => q.got).length; for (let i = 0; i < 4; i++) $('arc' + i).classList.toggle('got', i < got); $('fragCount').textContent = `${got} / 4`; }
let toastTimer; function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.opacity = 0), 2600); }
let cardOpen = false;
function openCard(html) { releaseKeys(); $('cardBox').innerHTML = html; $('card').style.display = 'flex'; cardOpen = true; }
function closeCard() {
  if (EMBEDDED) { window.parent.postMessage({ type: 'coolcv:close-card' }, location.origin); return; } // the page answers with coolcv:resume
  releaseKeys(); $('card').style.display = 'none'; cardOpen = false; canvas.focus();
}
window.addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.type === 'coolcv:resume') { releaseKeys(); cardOpen = false; canvas.focus(); } });
function showFragment(p, unlock, extraHtml) {
  const n = pickups.filter(q => q.got).length;
  if (EMBEDDED) { releaseKeys(); cardOpen = true; window.parent.postMessage({ type: 'coolcv:fragment', id: p.id, title: p.title, unlock, n, last: p.id === 'exp' }, location.origin); return; }
  openCard(`<h2>${p.title}</h2><div class="unlock">Fragment ${n} / 4 · ${unlock}</div>${p.html}${extraHtml}<div class="btns"><button data-close>Continue (Enter / Space)</button></div>`);
}
$('card').addEventListener('click', e => { if (e.target.id === 'card' || e.target.dataset.close !== undefined) closeCard(); });
const hudOn = { speed: false, alt: false, map: false };
const mm = $('minimap').getContext('2d');
const mmBase = (() => { // pre-render the minimap terrain
  const c = document.createElement('canvas'); c.width = 150; c.height = 190; const g = c.getContext('2d'); const img = g.createImageData(150, 190);
  const x0 = -122, x1 = 122, z0 = -122, z1 = 122;
  for (let py = 0; py < 190; py++) for (let px = 0; px < 150; px++) {
    const x = x0 + (x1 - x0) * px / 149, z = z0 + (z1 - z0) * py / 189, y = groundAt(x, z), o = (px + py * 150) * 4;
    if (!inside(x, z) || Math.hypot(x, z) > rimAt(x, z) - 2) continue;
    const [r, gg, b] = y < WATER_Y ? [59, 127, 196] : y < 2.2 ? [150, 190, 95] : y < 6 ? [95, 145, 60] : y < 15.5 ? [140, 130, 120] : [244, 248, 253];
    img.data.set([r, gg, b, 245], o);
  }
  g.putImageData(img, 0, 0); return { c, x0, x1, z0, z1 };
})();
function drawMinimap(heading) {
  const { c, x0, x1, z0, z1 } = mmBase; mm.clearRect(0, 0, 150, 190); mm.drawImage(c, 0, 0);
  const toM = (x, z) => [(x - x0) / (x1 - x0) * 149, (z - z0) / (z1 - z0) * 189];
  for (const p of pickups) { if (p.got || !p.group.visible) continue; const [mx, my] = toM(...p.pos); mm.fillStyle = '#' + p.color.toString(16).padStart(6, '0'); mm.fillRect(mx - 3, my - 3, 6, 6); }
  if (dogState === 'waiting') { const [dx, dy] = toM(dog.position.x, dog.position.z); mm.font = '13px sans-serif'; mm.textAlign = 'center'; mm.textBaseline = 'middle'; mm.fillText('🐕', dx, dy); }
  const [cx, cy] = toM(chassisBody.position.x, chassisBody.position.z);
  mm.save(); mm.translate(cx, cy); mm.rotate(heading); /* heading is clockwise from north, like canvas rotation */ mm.fillStyle = '#ff3b30'; mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4, 4); mm.lineTo(-4, 4); mm.closePath(); mm.fill(); mm.restore();
}

function collect(p) {
  chassisBody.velocity.set(0, Math.min(0, chassisBody.velocity.y), 0); chassisBody.angularVelocity.setZero(); cardOpen = true;
  p.got = true; p.group.visible = false;
  updateFrags();
  const n = pickups.slice(0, 3).filter(q => q.got).length; // how many of the first three you have
  let unlock = p.unlock, extra = '';
  if (p.id !== 'exp') {
    if (n === 1) { hudOn.speed = true; $('speed').style.display = 'block'; unlock = 'Speedometer unlocked'; }
    if (n === 2) { hudOn.map = true; $('minimap').style.display = 'block'; showBoxes(true); unlock = 'Minimap & obstacle detection unlocked'; extra = '<p>People and animals are now framed in red: steer clear of them.</p>'; }
    if (n === 3 && !carpetOn) { carpetOn = true; pickups[3].group.visible = true; unlock = 'AR navigation unlocked'; extra = '<p><b>Follow the AR carpet</b> to the last piece, on the highest summit of the ring.</p>'; }
  }
  if (p.id === 'exp') {
    carpetOn = false; chevrons.forEach(c => (c.visible = false));
    confetti();
    setTimeout(() => showFragment(p, 'HUD complete: the whole CV is yours', `<p><a class="btn" href="${PDF_URL}" target="_blank" rel="noopener">Open the full CV (PDF)</a></p>${creditsHtml()}`), 1400);
    return;
  }
  showFragment(p, unlock, extra);
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
let started = false;
camLook.set(START[0], groundAt(...START), START[1]);

// Driving is arcade: on the ground the controller sets the car's speed and turn rate directly,
// so speed is the same in every direction and on every slope. Wheels only do the suspension.
const VMAX = 16 * 1.35, VBACK = 8 * 1.35; // 35% faster
let driveMode = 'car'; // 'car' (default): up = throttle, left/right = steer · 'map': simplified, arrows point the car on screen
// The crawler: it always sits on its four wheels. Input sets a heading and a ground speed; the body's height,
// pitch and roll come from the terrain under the wheels. Physics only stops it at houses and the border cliffs.
let carYaw = Math.PI; // facing north
function control(h) {
  const live = started && !cardOpen;
  let speed = 0, yawRate = 0;
  if (live && driveMode === 'map') {
    const ix = (right() ? 1 : 0) - (left() ? 1 : 0), iz = (back() ? 1 : 0) - (fwd() ? 1 : 0);
    if (ix || iz) {
      let err = Math.atan2(ix, iz) - carYaw; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      yawRate = Math.max(-4, Math.min(4, err * 8));                                   // turn on the spot towards the arrow…
      speed = Math.abs(err) < 0.25 ? VMAX : Math.abs(err) < 0.7 ? VMAX * 0.35 : 0;     // …then crawl, always at the same speed
    }
  } else if (live) {
    speed = fwd() ? VMAX : back() ? -VBACK : 0;
    yawRate = ((left() ? 1 : 0) - (right() ? 1 : 0)) * 2.2 * (speed < 0 ? -1 : 1);
  }
  carYaw += yawRate * h;
  const v = chassisBody.velocity, k = Math.min(1, 14 * h);
  v.x += (Math.sin(carYaw) * speed - v.x) * k; v.z += (Math.cos(carYaw) * speed - v.z) * k; v.y = 0;
  chassisBody.angularVelocity.setZero();
}
function settleOnWheels() { // height, pitch and roll from the ground under the four wheels
  const p = chassisBody.position, c = Math.cos(carYaw), sn = Math.sin(carYaw);
  const at = (lx, lz) => groundAt(p.x + lx * c + lz * sn, p.z - lx * sn + lz * c);
  const fl = at(AX, AZ), fr = at(-AX, AZ), bl = at(AX, -AZ), br = at(-AX, -AZ);
  p.y = (fl + fr + bl + br) / 4 + RIDE;
  const pitch = Math.atan2((bl + br) / 2 - (fl + fr) / 2, 2 * AZ), roll = Math.atan2((fl + bl) / 2 - (fr + br) / 2, 2 * AX);
  chassisBody.quaternion.setFromEuler(pitch, carYaw, roll, 'YXZ');
  return [fl, fr, bl, br];
}
let wheelGround = [0, 0, 0, 0];
world.addEventListener("preStep", () => control(world.dt));

function step(dt) {
  world.step(1 / 60, dt, 4);
  wheelGround = settleOnWheels();
}
let wheelSpin = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  step(dt);
  // sync visuals
  car.position.copy(chassisBody.position); car.quaternion.copy(chassisBody.quaternion);
  wheelSpin += chassisBody.velocity.dot(chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1))) * dt / WHEEL_R;
  for (const a of carAxles) a.rotation.x = wheelSpin;
  const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), wheelSpin);
  WHEELS.forEach((loc, i) => { const wp = chassisBody.pointToWorldFrame(loc, new CANNON.Vec3()); wheelMeshes[i].position.set(wp.x, wheelGround[i] + WHEEL_R, wp.z); wheelMeshes[i].quaternion.copy(car.quaternion).multiply(spinQ); }); // each wheel sits on the ground under it
  // camera: fixed isometric angle, follows the car smoothly
  camLook.lerp(car.position, 1 - Math.exp(-dt * 5));
  camera.position.copy(camLook).add(CAM_OFFSET); camera.lookAt(camLook);
  sun.position.copy(car.position).add(new THREE.Vector3(60, 110, 40)); sun.target.position.copy(car.position);
  // pickups
  for (const p of pickups) {
    if (p.got || !p.group.visible) continue;
    p.card.rotation.y = t * 1.5; p.card.position.y = 3 + Math.sin(t * 2) * 0.4;
    const d = Math.hypot(car.position.x - p.group.position.x, car.position.z - p.group.position.z);
    if (d < 6.5 && !cardOpen) collect(p);
  }
  // dog
  const dDog = Math.hypot(car.position.x - DOG_POS[0], car.position.z - DOG_POS[1]);
  if (dogState === 'waiting') {
    dog.userData.tail.rotation.y = Math.sin(t * 10) * 0.6; dog.lookAt(car.position.x, dog.position.y, car.position.z);
    if (dDog < 10 && chassisBody.velocity.length() < 8) { dogState = 'jumping'; dogJumpT = 0; dogJumpFrom.copy(dog.position); toast('Your co-pilot just jumped aboard!'); }
  } else if (dogState === 'jumping') {
    dogJumpT += dt / 0.7; const to = car.userData.seat.getWorldPosition(new THREE.Vector3());
    dog.position.lerpVectors(dogJumpFrom, to, Math.min(1, dogJumpT)); dog.position.y += Math.sin(Math.min(1, dogJumpT) * Math.PI) * 4;
    if (dogJumpT >= 1) { dogState = 'aboard'; car.userData.seat.add(dog); dog.position.set(0, 0, 0); dog.rotation.set(0, Math.PI / 2, 0); dog.scale.setScalar(3.3 * SIZE_K / CAR_SCALE); } // same size as on the ground, standing across the rear bed
  } else { dog.userData.tail.rotation.y = Math.sin(t * 12) * 0.7; dog.userData.head.rotation.y = Math.sin(t * 1.3) * 0.5; dog.rotation.y += ((dogSide > 0 ? Math.PI / 2 : -Math.PI / 2) - dog.rotation.y) * Math.min(1, dt * 3); dogTurnT -= dt; if (dogTurnT <= 0) { dogSide = -dogSide; dogTurnT = 3 + Math.random() * 4; } }
  { // fade the border cliffs when they stand between the camera (south) and the car
    const cx = car.position.x, cz = car.position.z; let hide = false;
    for (const [bx, bz] of BORDER) if (bz > cz && bz - cz < 20 && Math.abs(bx - cx) < 10) { hide = true; break; }
    const target = hide ? 0.35 : 1; borderWall.material.opacity += (target - borderWall.material.opacity) * Math.min(1, dt * 6); borderWall.material.depthWrite = borderWall.material.opacity > 0.95;
  }
  updateWalkers(dt, t); updateParticles(dt); updateShouts(dt); updateConfetti(dt);
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
const begin = () => { if (started) return; started = true; startEl.style.display = 'none'; canvas.focus(); toast('Follow the red beams to the fragments'); };
startEl.addEventListener('click', begin); $('startBtn').addEventListener('click', begin);
window.addEventListener('keydown', begin, { once: true });
frame();

// for automated checks
window.__coolcv = { setView(v) { VIEW = v; resize(); }, world, CARPET_ROUTE, SCENERY, chassisBody, car, dog, pickups, groundAt, collect, keys, get dogState() { return dogState; }, get carpetOn() { return carpetOn; } };
