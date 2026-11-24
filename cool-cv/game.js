// Jobride, A trip to Hire Ground — a small off-road game in a valley ringed by mountains.
// three.js for rendering, cannon-es for physics. No build step.
import * as THREE from './vendor/three.module.min.js';
import * as CANNON from './vendor/cannon-es.min.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from './vendor/addons/utils/BufferGeometryUtils.js';

// 3D models in cool-cv/assets/. length = how long the model should be in world units; yaw = turn it so it faces +z (forward).
const ASSETS = {
  car: { url: 'assets/car.glb', length: 4.2, yaw: 0 },
  dog: { url: 'assets/dog.glb', length: 1.3, yaw: 0 },
  tree: { url: 'assets/tree.glb', height: 3.4 },
  house: { url: 'assets/house.glb', length: 2.8 },
};
// Credits for the models (all CC BY 4.0, sketchfab.com), shown on the last card
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
const PAGE_BLUE = 0x2f6fb5; // the CV pages, their beams, markers and sparkles
const CV = [ // the four CV pages hidden in the valley; their content is the CV page itself, revealed as you find them
  { id: 'edu', pos: polar(90, 52), color: PAGE_BLUE },
  { id: 'proj', pos: polar(210, 52), color: PAGE_BLUE },
  { id: 'pub', pos: polar(330, 52), color: PAGE_BLUE },
  { id: 'exp', pos: SUMMIT, color: PAGE_BLUE }, // the last one, on the highest summit of the ring
];
const CARPET_ROUTE = [];
const DOG_POS = (() => { // somewhere new every game: up on the mountains, at least a screen away from every CV page and from the start
  const ok = (x, z) => { const h = height(x, z), sl = Math.hypot(height(x + 1, z) - height(x - 1, z), height(x, z + 1) - height(x, z - 1)) / 2;
    return h > 7 && h < 15 && sl < 1.2 && Math.hypot(x, z) < rimAt(x, z) - 14 && Math.hypot(x, z - 8) > 30 && CV.every(c => Math.hypot(x - c.pos[0], z - c.pos[1]) > 40); };
  for (let k = 0; k < 800; k++) { const [x, z] = polar(Math.random() * 360, R_EDGE * (0.55 + Math.random() * 0.3)); if (ok(x, z)) return [x, z]; }
  return polar(225, 84);
})();
const DOG_WAIT_K = 1.3; // the waiting dog is 30% bigger
const dogRing = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.6, 40, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })); // orange ring around the waiting dog; it follows the slope (see below)
dogRing.renderOrder = 2;

// ---------------------------------------------------------------- phones
// Phones get a lighter game: fewer particles and figures, cheaper shadows and pixels, and a slightly wider view.
const MOBILE = (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) && Math.min(screen.width, screen.height) < 820;
const FX = MOBILE ? 0.6 : 1; // particle budget
const ZOOM = MOBILE ? 1.15 : 1; // 15% zoom out
// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.25 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
if (MOBILE) renderer.shadowMap.autoUpdate = false; // phones redraw the shadows every other frame (see frame())
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
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
scene.add(sun, sun.target);

function resize() { const w = window.innerWidth, h = window.innerHeight, v = VIEW * ZOOM; renderer.setSize(w, h, false); const a = w / h; camera.left = -v * a; camera.right = v * a; camera.top = v; camera.bottom = -v; camera.updateProjectionMatrix(); }
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
// Only the border walls below and the houses are solid.

// ---------------------------------------------------------------- border: invisible walls, so the car can never leave the board
const BORDER_SEGS = BORDER.map((p, i) => [p, BORDER[(i + 1) % BORDER.length]]);
{
  for (const [[ax, az], [bx, bz]] of BORDER_SEGS) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.01) continue;
    const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Box(new CANNON.Vec3(L / 2 + 0.8, 60, 1.5)));
    b.position.set((ax + bx) / 2, 30, (az + bz) / 2); b.quaternion.setFromEuler(0, Math.atan2(-dz, dx), 0); world.addBody(b);
  }
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

const car = new THREE.Group(); car.scale.setScalar(CAR_SCALE); scene.add(car); // the model is added when it loads
const carAxles = [];
{ // the driver: a small stylised person at the wheel
  const d = new THREE.Group(), m = c => toon({ color: c });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8), m(0x566c8d)); body.position.y = 0.3; d.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), m(0xe9c9a6)); head.position.y = 0.78; d.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 10), m(0xcf222e)); cap.position.y = 0.95; d.add(cap);
  d.traverse(o => { if (o.isMesh) o.castShadow = true; });
  d.position.set(0.32, -0.1, 0.15); car.add(d); car.userData.driver = d;
}
car.userData.seat = new THREE.Object3D(); car.userData.seat.position.set(0, -0.32, -1.1); car.add(car.userData.seat); // the back of the crawler

// ---------------------------------------------------------------- scenery
const SCENERY = { houses: [], trees: [] }; // placements; the models are instanced once loaded
// Houses stand in small solid groups; trees (in groves and loose) can be driven through.
{
  const keepClear = [START, DOG_POS, ...CV.map(c => c.pos)];
  const free = (x, z, r) => inside(x, z) && Math.hypot(x, z) < rimAt(x, z) - 8 && keepClear.every(([px, pz]) => Math.hypot(x - px, z - pz) > r) && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.3;
  const solid = (x, y, z, hx, hy, hz, rot) => { const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz))); b.position.set(x, y + hy, z); b.quaternion.setFromEuler(0, rot, 0); world.addBody(b); return b; };
  // hamlets
  const HAMLETS = [[0, 30], [60, 32], [130, 24], [175, 40], [250, 30], [300, 38], [15, 62], [195, 70], [270, 64]];
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
      const body = solid(x, y, z, 1.2 * sc, h + 0.6, 1.2 * sc, rot); SCENERY.houses.push({ x, y, z, rot, sc, body, hy: h + 0.6 });
      n++; k++;
    }
  }
  // groves and loose trees, no colliders
  const GROVES = [[20, 18], [80, 20], [110, 45], [150, 55], [200, 18], [230, 48], [280, 22], [320, 70], [100, 72], [355, 30]];
  for (const [deg, r] of GROVES) {
    const [cx, cz] = polar(deg, r); if (!free(cx, cz, 14)) continue;
    for (let k = 0, tries = 0; k < 9 && tries < 40; tries++) {
      seed++; const a = hash(seed, 17) * Math.PI * 2, d = Math.sqrt(hash(seed, 19)) * 7, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = groundAt(x, z);
      if (!free(x, z, 11) || y < WATER_Y + 0.5) continue;
      const sc = 0.9 + hash(seed, 23) * 0.6; SCENERY.trees.push({ x, y, z, sc, rot: hash(seed, 41) * 6.28 });
      k++;
    }
  }
  for (let k = 0, tries = 0; k < 45 && tries < 2000; tries++) {
    seed++; const x = (hash(seed, 29) - 0.5) * 2 * R_EDGE, z = (hash(seed, 31) - 0.5) * 2 * R_EDGE, y = groundAt(x, z);
    if (!free(x, z, 6) || y < WATER_Y + 0.5 || y > 12) continue;
    const sc = 0.7 + hash(seed, 37) * 0.6; SCENERY.trees.push({ x, y, z, sc, rot: hash(seed, 43) * 6.28 }); k++;
  }
}

// ---------------------------------------------------------------- pickups
// the last piece sits on the highest point near the summit
{ const exp = CV.find(c => c.id === 'exp'); let [bx, bz] = exp.pos, best = -1e9;
  for (let dx = -5; dx <= 5; dx += 0.5) for (let dz = -5; dz <= 5; dz += 0.5) { const h = groundAt(exp.pos[0] + dx, exp.pos[1] + dz); if (h > best) { best = h; bx = exp.pos[0] + dx; bz = exp.pos[1] + dz; } }
  exp.pos = [bx, bz];
  // the carpet comes in from the side: it runs along the foot of the mountain, then climbs across its face to the top
  const side = bx > 0 ? -1 : 1; // approach from the side that faces the middle of the board
  // through the valley it slaloms between the houses: it visits the hamlets that lie along the way
  const hamlets = []; for (const h of SCENERY.houses) { const c = hamlets.find(c => c.some(q => Math.hypot(q.x - h.x, q.z - h.z) < 16)); c ? c.push(h) : hamlets.push([h]); }
  const A = START, Bp = [bx + side * 30, bz + 14], ab = [Bp[0] - A[0], Bp[1] - A[1]], L2 = ab[0] ** 2 + ab[1] ** 2;
  const along = (x, z) => ((x - A[0]) * ab[0] + (z - A[1]) * ab[1]) / L2, across = (x, z) => ((x - A[0]) * ab[1] - (z - A[1]) * ab[0]) / Math.sqrt(L2);
  const visits = []; let sideSign = 1;
  hamlets.filter(c => c.length >= 3).map(c => ({ c, x: c.reduce((s, q) => s + q.x, 0) / c.length, z: c.reduce((s, q) => s + q.z, 0) / c.length }))
    .filter(v => along(v.x, v.z) > 0.05 && along(v.x, v.z) < 0.95 && Math.abs(across(v.x, v.z)) < 30).sort((a, b) => along(a.x, a.z) - along(b.x, b.z))
    .forEach(v => { // inside each hamlet, pass the houses one side then the other
      const dir = [ab[0], ab[1]].map(q => q / Math.sqrt(L2)), perp = [dir[1], -dir[0]];
      for (const h of [...v.c].sort((a, b) => along(a.x, a.z) - along(b.x, b.z))) {
        const d = 1.7 * h.sc + 2.8; visits.push([h.x + perp[0] * d * sideSign, h.z + perp[1] * d * sideSign]); sideSign = -sideSign;
      }
    });
  const route = [START, ...visits, Bp, [bx + side * 20, bz + 7], [bx + side * 10, bz + 2], [bx, bz]]
    .map(([x, z]) => { const r = Math.hypot(x, z), m = rimAt(x, z) - 10; return r > m ? [x * m / r, z * m / r] : [x, z]; });
  route[route.length - 1] = [bx, bz];
  // plan on a grid (A*): close enough to the houses to thread between them, never over the lake
  const CELL = 1.5, HALFG = 122, NG = Math.ceil(2 * HALFG / CELL), CLEAR = 2.6;
  const blocked = new Uint8Array(NG * NG), cellXZ = i => [-HALFG + (i % NG + 0.5) * CELL, -HALFG + (Math.floor(i / NG) + 0.5) * CELL];
  for (let i = 0; i < NG * NG; i++) { const [x, z] = cellXZ(i);
    if (!inside(x, z) || Math.hypot(x, z) > rimAt(x, z) - 10 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.25) { blocked[i] = 1; continue; } // off the board, near the rim or over the lake
    for (const hs of SCENERY.houses) if (Math.hypot(x - hs.x, z - hs.z) < CLEAR + hs.sc * 1.3) { blocked[i] = 1; break; } }
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
    const near = (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.2 || SCENERY.houses.some(hs => Math.hypot(x - hs.x, z - hs.z) < 2.4 + hs.sc * 1.3) || (Math.hypot(x, z) > rimAt(x, z) - 10 && Math.hypot(x - exp.pos[0], z - exp.pos[1]) > 12); // as close to the houses as the planner, the summit itself is outside the rim
    for (let k = 0; k < 120; k++) for (let i = 1; i < dense.length - 1; i++) { // fewer passes: keep the slalom, round off the corners
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
const dog = new THREE.Group(); // the model is added when it loads
{
  dog.position.set(DOG_POS[0], groundAt(...DOG_POS), DOG_POS[1]);
  dog.scale.setScalar(3.3 * SIZE_K * DOG_WAIT_K); // bigger while waiting, so it is easy to spot
  scene.add(dog);
  { const pa = dogRing.geometry.attributes.position; for (let k = 0; k < pa.count; k++) { const x = DOG_POS[0] + pa.getX(k), z = DOG_POS[1] + pa.getZ(k); pa.setXYZ(k, x, groundAt(x, z) + 0.12, z); } pa.needsUpdate = true; dogRing.geometry.computeBoundingSphere(); scene.add(dogRing); } // drape the disc over the terrain
}
// ---------------------------------------------------------------- 3D models
function fitModel(root, length, yaw) {
  root.rotation.y = yaw; root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const k = length / Math.max(size.z, size.x, 1e-6); root.scale.multiplyScalar(k); root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root), c = b2.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  toonify(root);
  return root;
}
function swapIn(group, gltf, cfg, yOffset) {
  const holder = new THREE.Group(); holder.add(fitModel(gltf.scene, cfg.length, cfg.yaw)); holder.position.y = yOffset; group.add(holder);
}
const gltfLoader = new GLTFLoader();
gltfLoader.load(ASSETS.car.url, g => {
  g.scene.traverse(o => { if (/^tire_/.test(o.name)) carAxles.push(o); }); /* the two axles spin about their own centre */
  swapIn(car, g, ASSETS.car, -1.27); usedCredits.add('car'); }, undefined, () => {});
gltfLoader.load(ASSETS.dog.url, g => { swapIn(dog, g, ASSETS.dog, 0); usedCredits.add('dog'); }, undefined, () => {});
function fitHeight(root, height) { // scale a model to a given height, feet on the ground, centred
  root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(root), size = b.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(height / Math.max(size.y, 1e-6)); root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root), c = b2.getCenter(new THREE.Vector3()); root.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  toonify(root); return root;
}
// Many copies of one model: bake it into a single geometry (vertex colours for untextured models)
// and draw every copy with one InstancedMesh, instead of one mesh per part per copy.
function bakeModel(root) {
  root.updateMatrixWorld(true); const parts = [];
  root.traverse(o => { if (o.isMesh) parts.push(o); });
  const textured = parts.length === 1 && parts[0].material.map;
  const geos = parts.map(o => {
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld); if (g.index) g = g.toNonIndexed();
    if (!textured) { const c = o.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  return { geometry: mergeGeometries(geos), material: textured ? parts[0].material : toon({ vertexColors: true }) };
}
function instance(model, places, CHUNK = 50) { // one InstancedMesh per map chunk, so off-screen chunks are culled
  const { geometry, material } = bakeModel(model), chunks = new Map();
  for (const t of places) { const k = Math.floor(t.x / CHUNK) + ',' + Math.floor(t.z / CHUNK); if (!chunks.has(k)) chunks.set(k, []); chunks.get(k).push(t); }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  for (const list of chunks.values()) {
    const im = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((t, i) => { im.setMatrixAt(i, M.compose(V.set(t.x, t.y, t.z), Q.setFromAxisAngle(Y, t.rot), S.setScalar(t.sc))); t.im = im; t.idx = i; });
    im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im);
  }
}
gltfLoader.load(ASSETS.tree.url, g => { instance(fitHeight(g.scene, ASSETS.tree.height), SCENERY.trees); usedCredits.add('tree'); }, undefined, () => {});
gltfLoader.load(ASSETS.house.url, g => { instance(fitModel(g.scene, ASSETS.house.length, 0), SCENERY.houses); usedCredits.add('house'); }, undefined, () => {});
const usedCredits = new Set();
const creditsHtml = () => `<p>3D models (CC BY 4.0, Sketchfab):</p><ul>${[...usedCredits].map(k => `<li>${CREDITS[k]}</li>`).join('')}</ul><p>Libraries: three.js, cannon-es (MIT)</p>`;

let dogSide = 1, dogTurnT = 4;
let dogState = 'waiting', dogJumpT = 0; const dogJumpFrom = new THREE.Vector3();

// ---------------------------------------------------------------- AR carpet
const CHEVRONS = 46;
const chevGeo = (() => { const s = new THREE.Shape(); s.moveTo(-1.1, -0.5); s.lineTo(0, 0.4); s.lineTo(1.1, -0.5); s.lineTo(1.1, 0.0); s.lineTo(0, 0.9); s.lineTo(-1.1, 0.0); s.closePath(); const g = new THREE.ShapeGeometry(s); g.scale(0.75, 0.75, 0.75); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI); return g; })();
// one InstancedMesh for the whole carpet; each chevron's pulsing opacity is a per-instance attribute
const chevAlpha = new THREE.InstancedBufferAttribute(new Float32Array(CHEVRONS), 1); chevGeo.setAttribute('iAlpha', chevAlpha);
const chevMat = new THREE.MeshBasicMaterial({ color: PAL.ar, transparent: true, depthWrite: false, fog: false });
chevMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iAlpha; varying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = iAlpha;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>');
};
const chevrons = new THREE.InstancedMesh(chevGeo, chevMat, CHEVRONS); chevrons.count = 0; chevrons.frustumCulled = false; scene.add(chevrons);
const chevM = new THREE.Matrix4(), chevQ = new THREE.Quaternion(), chevP = new THREE.Vector3(), chevS = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
let carpetOn = false, carpetT0 = 0;
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
    const x = ax + (bx - ax) * along / L, z = az + (bz - az) * along / L;
    chevS.setScalar(Math.max(0, bounce(Math.max(0, (t - carpetT0 - k * 0.05) / 0.5)))); // pop in one after the other
    chevrons.setMatrixAt(k, chevM.compose(chevP.set(x, groundAt(x, z) + 0.35, z), chevQ.setFromAxisAngle(UP, Math.atan2(bx - ax, bz - az)), chevS));
    chevAlpha.array[k] = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t * 6 - k * 0.6));
    along += 1.9; k++;
  }
  chevrons.count = k; chevrons.instanceMatrix.needsUpdate = true; chevAlpha.needsUpdate = true;
}

// ---------------------------------------------------------------- people and animals
// Stylised walkers that wander the valley; with the 2nd fragment they get red AR bounding boxes.
const walkers = [];
{
  const bodyMat = toon({ vertexColors: true });
  const solidBody = parts => { // all the boxes of a figure merged into one mesh, coloured per vertex: one draw call per figure
    const geos = parts.map(([geo, hex, x, y, z]) => { const g = geo.toNonIndexed().translate(x, y, z), c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); return g; });
    const m = new THREE.Mesh(mergeGeometries(geos), bodyMat); m.castShadow = true; return m;
  };
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false }); // writes depth only, so the back edges of the box are hidden
  const frameGeos = {}, T = 0.11; // edges are thin bars (WebGL lines are always 1 px), shared by every frame of a size
  const frameGeo = (w, h, d) => frameGeos[[w, h, d]] ||= (() => {
    const bars = [];
    for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) bars.push(new THREE.BoxGeometry(w + T, T, T).translate(0, y, z));
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) bars.push(new THREE.BoxGeometry(T, h + T, T).translate(x, 0, z));
    for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) bars.push(new THREE.BoxGeometry(T, T, d + T).translate(x, y, 0));
    return { occ: new THREE.BoxGeometry(w * 0.98, h * 0.98, d * 0.98), bars: mergeGeometries(bars) };
  })();
  const frame = (w, h, d) => {
    const g = new THREE.Group(); g.position.y = h / 2; g.visible = false; g.userData.isBox = true; const fg = frameGeo(w, h, d);
    const occ = new THREE.Mesh(fg.occ, occMat); occ.renderOrder = 9; g.add(occ);
    const l = new THREE.Mesh(fg.bars, boxMat); l.renderOrder = 10; g.add(l);
    return g;
  };
  function sheep() {
    const g = new THREE.Group(), legs = [[-0.4, 0.6], [0.4, 0.6], [-0.4, -0.6], [0.4, -0.6]].map(([x, z]) => [new THREE.BoxGeometry(0.22, 0.65, 0.22), 0x353335, x, 0.33, z]);
    g.add(solidBody([[new THREE.BoxGeometry(1.3, 1.0, 1.9), PAL.snow, 0, 1.15, 0], [new THREE.BoxGeometry(0.6, 0.6, 0.6), 0x353335, 0, 1.45, 1.15], ...legs]));
    g.add(frame(1.8, 2.0, 2.8)); return g;
  }
  // people: bodies of different shapes, different skin tones; some get about in a wheelchair
  const SKINS = [0xf3d6bd, 0xe9c19c, 0xd29a6f, 0xae7448, 0x8a5634, 0x5f3a22, 0x40271a];
  const TROUSERS = [0x353335, 0x2c3b55, 0x4a3b2c, 0x3d4a3a];
  const BODIES = { // the torso: [geometry, its height]
    cylinder: () => new THREE.CylinderGeometry(0.42, 0.5, 1.3, 8),
    coneUp: () => new THREE.CylinderGeometry(0.08, 0.66, 1.4, 10),   // apex up
    prism3: () => new THREE.CylinderGeometry(0.62, 0.62, 1.3, 3),
    prism4: () => new THREE.BoxGeometry(0.85, 1.3, 0.62),
    prism6: () => new THREE.CylinderGeometry(0.5, 0.5, 1.3, 6),
    spheres: () => mergeGeometries([new THREE.SphereGeometry(0.5, 12, 9).translate(0, -0.15, 0), new THREE.SphereGeometry(0.38, 12, 9).translate(0, 0.27, 0)]), // two stacked balls
  };
  const SHAPES = Object.keys(BODIES);
  function person(shirt, skin, shape, legs) {
    const g = new THREE.Group(), tall = shape.startsWith('cone') ? 1.4 : 1.3, top = 0.72 + tall;
    g.add(solidBody([[BODIES[shape](), shirt, 0, 0.72 + tall / 2, 0], [new THREE.SphereGeometry(0.38, 10, 8), skin, 0, top + 0.3, 0],
      ...[-0.2, 0.2].map(x => [new THREE.BoxGeometry(0.24, 0.75, 0.26), legs, x, 0.38, 0])]));
    g.add(frame(1.4, top + 0.75, 1.4)); return g;
  }
  function wheelchair(shirt, skin, legs) { // seated, facing +z like everyone else; big rear wheels, small casters in front
    const g = new THREE.Group(), metal = 0x4a4f57, tyre = 0x232325, seat = 0x2f6fb5;
    const wheel = x => [new THREE.TorusGeometry(0.55, 0.09, 6, 16).rotateY(Math.PI / 2), tyre, x, 0.62, -0.15];
    const hub = x => [new THREE.CylinderGeometry(0.12, 0.12, 0.1, 8).rotateZ(Math.PI / 2), metal, x, 0.62, -0.15];
    const caster = x => [new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8).rotateZ(Math.PI / 2), tyre, x, 0.16, 0.62];
    g.add(solidBody([
      wheel(-0.62), wheel(0.62), hub(-0.62), hub(0.62), caster(-0.42), caster(0.42),
      [new THREE.BoxGeometry(1.0, 0.12, 0.9), seat, 0, 0.78, 0],                 // seat
      [new THREE.BoxGeometry(1.0, 0.85, 0.1), seat, 0, 1.25, -0.48],             // backrest
      [new THREE.BoxGeometry(0.08, 0.6, 0.08), metal, -0.46, 0.45, 0.42], [new THREE.BoxGeometry(0.08, 0.6, 0.08), metal, 0.46, 0.45, 0.42], // front legs of the frame
      [new THREE.BoxGeometry(0.8, 0.06, 0.25), metal, 0, 0.18, 0.78],            // footrest
      [new THREE.CylinderGeometry(0.4, 0.44, 0.95, 8), shirt, 0, 1.33, -0.12],   // torso
      [new THREE.SphereGeometry(0.36, 10, 8), skin, 0, 2.12, -0.12],             // head
      ...[-0.2, 0.2].flatMap(x => [[new THREE.BoxGeometry(0.24, 0.24, 0.7), legs, x, 0.95, 0.3], [new THREE.BoxGeometry(0.24, 0.62, 0.24), legs, x, 0.55, 0.62]]), // thighs, shins
    ]));
    g.add(frame(1.7, 2.6, 1.9)); return g;
  }
  const SHIRTS = [PAL.wall, 0x566c8d, PAL.roof, PAL.olive, 0x8e5b8f, 0x3f8f7a, 0xd98c3a, 0xe8e2d0];
  const flocks = CV.map(c => [c.pos[0] + 7, c.pos[1] + 6]); // a few sheep near every CV page
  const spots = [[100, 30], [120, 36], [200, 30], [260, 40], [300, 26], [40, 40], [160, 20], [340, 44], [80, 44], [235, 44], [10, 28], [280, 36], [60, 24], [180, 38], [320, 34], [140, 28]];
  const CHAIR_SPOTS = new Set([0, 6, 12]); // a wheelchair user in these groups (on gentle ground near the villages)
  let popCount = 0, n = 0;
  [...spots.map(([deg, r]) => polar(deg, r)), ...flocks].forEach((home, i) => {
    const isSheep = i >= spots.length || i % 4 === 1; // sheep near the CV pages and in a quarter of the spots, people everywhere else
    const count = isSheep ? 3 : 2 + (i % 2);
    for (let k = 0; k < count; k++) {
      const rolls = !isSheep && k === 0 && CHAIR_SPOTS.has(i);
      n++;
      const shirt = SHIRTS[(i * 3 + k) % SHIRTS.length], skin = SKINS[(i * 5 + k * 3) % SKINS.length], legs = TROUSERS[(i + k) % TROUSERS.length];
      const g = isSheep ? sheep() : rolls ? wheelchair(shirt, skin, legs) : person(shirt, skin, SHAPES[(i + k * 2) % SHAPES.length], legs);
      const x = home[0] + (k - 1) * 3, z = home[1] + (k % 2) * 3;
      if (groundAt(x, z) < WATER_Y + 0.6) continue; // never start in the lake
      if (MOBILE && !rolls && ++popCount % 10 === 0) continue; // phones: one figure in ten fewer (never a wheelchair)
      g.position.set(x, groundAt(x, z), z); scene.add(g);
      walkers.push({ g, home, homeY: groundAt(...home), speed: isSheep ? 1.4 : rolls ? 2.0 : 2.1 + (n % 5) * 0.15, target: [x, z], wait: Math.random() * 2, knocked: 0, kind: isSheep ? 'sheep' : 'person', rolls });
    }
  });
}
const boxes = []; for (const w of walkers) w.g.children.forEach(c => { if (c.userData.isBox) { c.userData.base = c.scale.clone(); boxes.push(c); } });
function showBoxes(at) { // the boxes pop in one by one, from the nearest figure to the farthest
  const cp = chassisBody.position, d = b => Math.hypot(b.parent.position.x - cp.x, b.parent.position.z - cp.z);
  [...boxes].sort((a, b) => d(a) - d(b)).forEach((b, i) => { b.userData.popAt = at + i * 0.07; b.userData.sound = i < 7; }); // only the 7 nearest make a sound
}
const bounce = k => k >= 1 ? 1 : 1 - Math.exp(-6 * k) * Math.cos(11 * k); // 0 → overshoot → settles at 1
function updateBoxes(t) {
  for (const b of boxes) {
    const at = b.userData.popAt; if (at === undefined || t < at) continue;
    if (!b.visible) { b.visible = true; if (b.userData.sound && onCamera(b.parent.position)) bubblePop(); } // …and only if they are on screen
    const k = (t - at) / 0.6, B = b.userData.base, g = bounce(k), w = k >= 1 ? 0 : Math.exp(-5 * k) * Math.sin(14 * k) * 0.35; // grow, then stretch and squash
    b.scale.set(B.x * g * (1 - w * 0.6), B.y * g * (1 + w), B.z * g * (1 - w * 0.6));
    if (k >= 1) { b.scale.copy(B); delete b.userData.popAt; }
  }
}
// comic hits: a starburst at the point of contact and a speech balloon from whoever got bumped
const SHEEP_LINES = ['Baaaah!', 'Beeeh!'], PEOPLE_LINES = ['Aiah!', 'Ocio!', 'Maremma serpente!', 'Boia deh!', 'O bischero!', 'Icché tu fai?!', 'Bada lì!'];
const BANGS = ['SBAM!', 'BONK!', 'TUMP!', 'POF!'];
let sheepN = 0, lastLine = '';
const comicLayer = document.createElement('div'); comicLayer.className = 'hud'; comicLayer.style.inset = '0'; document.body.appendChild(comicLayer);
const BURST = (() => { let d = ''; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, r = i % 2 ? 26 : 48 + (i % 4 ? 0 : 6); d += (i ? 'L' : 'M') + (50 + Math.cos(a) * r).toFixed(1) + ' ' + (50 + Math.sin(a) * r).toFixed(1); } return d + 'Z'; })();
const BANG_T = 0.5, BALLOON_T = 1.5; // seconds on screen
const bangs = new Map(), balloons = new Map(); // walker → its one bang and its one balloon (a new hit replaces them)
const now = () => performance.now() / 1000; // real seconds, not the clamped game clock
function comicHit(w, cp) {
  const wp = w.g.position;
  // the bang: fixed at the point of contact
  const bang = document.createElement('div'); bang.className = 'comic';
  bang.innerHTML = `<svg class="burst" viewBox="0 0 100 100" style="--r:${(Math.random() * 40 - 20).toFixed(0)}deg"><path d="${BURST}"/><text x="50" y="57" text-anchor="middle">${BANGS[Math.random() * BANGS.length | 0]}</text></svg>`;
  const oldBang = bangs.get(w); if (oldBang) oldBang.el.remove();
  comicLayer.appendChild(bang); bangs.set(w, { el: bang, at: new THREE.Vector3((wp.x + cp.x) / 2, wp.y + 1.2, (wp.z + cp.z) / 2), t0: now() });
  // the balloon: one per walker, a new hit replaces the old one
  let line;
  if (w.kind === 'sheep') line = SHEEP_LINES[sheepN++ % 2];
  else { do line = PEOPLE_LINES[Math.random() * PEOPLE_LINES.length | 0]; while (line === lastLine); lastLine = line; }
  const old = balloons.get(w); if (old) old.el.remove();
  const el = document.createElement('div'); el.className = 'comic';
  el.innerHTML = `<div class="balloon ${w.kind}" style="--fx:${Math.random() < 0.5 ? -1 : 1};--tilt:${(Math.random() * 10 - 5).toFixed(1)}deg"><span>${line}</span></div>`;
  comicLayer.appendChild(el); balloons.set(w, { el, t0: now() });
}
function comicBang(key, x, y, z, word) { // a starburst on its own, e.g. where the crawler rams a house
  const old = bangs.get(key); if (old) old.el.remove();
  const el = document.createElement('div'); el.className = 'comic big';
  el.innerHTML = `<svg class="burst" viewBox="0 0 100 100" style="--r:${(Math.random() * 30 - 15).toFixed(0)}deg"><path d="${BURST}"/><text x="50" y="56" text-anchor="middle">${word}</text></svg>`;
  comicLayer.appendChild(el); bangs.set(key, { el, at: new THREE.Vector3(x, y, z), t0: now() });
}
const cProj = new THREE.Vector3();
function placeAt(el, v) { cProj.copy(v).project(camera); el.style.left = ((cProj.x + 1) / 2 * 100) + '%'; el.style.top = ((1 - cProj.y) / 2 * 100) + '%'; }
const fade = (t, life, f) => String(Math.max(0, Math.min(1, (life - t) / f)));
function updateComics() {
  const tn = now();
  for (const [w, c] of bangs) {
    const life = c.el.classList.contains('big') ? 0.9 : BANG_T, t = tn - c.t0; if (t > life) { c.el.remove(); bangs.delete(w); continue; }
    placeAt(c.el, c.at); c.el.style.opacity = fade(t, life, 0.15);
  }
  for (const [w, c] of balloons) {
    const t = tn - c.t0; if (t > BALLOON_T) { c.el.remove(); balloons.delete(w); continue; }
    cProj.copy(w.g.position); cProj.y += 1.6; placeAt(c.el, cProj); c.el.style.opacity = fade(t, BALLOON_T, 0.25); // rides on the walker's head
  }
}
function updateWalkers(dt, t) {
  const cp = chassisBody.position; 
  for (const w of walkers) {
    const p = w.g.position;
    if (w.knocked > 0) { // tipped over by the crawler: lie down, then get back up
      w.knocked -= dt; w.g.rotation.z = Math.min(1, w.knocked) * Math.PI / 2; if (w.knocked <= 0) w.g.rotation.z = 0; continue;
    }
    const dc = Math.hypot(p.x - cp.x, p.z - cp.z);
    if (dc < 3.6 * SIZE_K + 0.8) { w.knocked = 1.8; play(w.kind === 'sheep' ? 'sheep' : 'person'); comicHit(w, cp); slap(0.8); chassisBody.velocity.scale(0.3, chassisBody.velocity); continue; }
    let speed = w.speed;
    if (w.scared > 0) { w.scared -= dt; speed *= 3; }
    else if (dc < 11) { // step aside when the crawler gets close
      const ax = p.x - cp.x, az = p.z - cp.z, l = Math.hypot(ax, az) || 1; w.target = [p.x + ax / l * 8, p.z + az / l * 8]; speed *= 2.2; w.wait = 0;
    } else if (w.wait > 0) { w.wait -= dt; continue; }
    const dx = w.target[0] - p.x, dz = w.target[1] - p.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { // pick a new spot near home, on gentle ground
      for (let k = 0; k < 8; k++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 14, tx = w.home[0] + Math.cos(a) * r, tz = w.home[1] + Math.sin(a) * r, ty = groundAt(tx, tz);
        if (ty > WATER_Y + 0.5 && Math.abs(ty - w.homeY) < 4) { w.target = [tx, tz]; break; } }
      w.wait = 1 + Math.random() * 3; continue;
    }
    const step = Math.min(d, speed * dt), nx = p.x + dx / d * step, nz = p.z + dz / d * step;
    if (groundAt(nx, nz) < WATER_Y + 0.3) { w.target = [p.x, p.z]; continue; }
    p.set(nx, groundAt(nx, nz) + (w.rolls ? 0 : Math.abs(Math.sin(t * speed * 4)) * 0.18), nz); w.g.rotation.y = Math.atan2(dx, dz);
  }
}

// ---------------------------------------------------------------- dust, splashes and snow behind the wheels
const PARTS = Math.round(320 * FX), parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff }), PARTS);
parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parts.frustumCulled = false; scene.add(parts);
const pState = Array.from({ length: PARTS }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }));
let pNext = 0, partsWasAlive = false; const wheelW = new CANNON.Vec3();
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
  if (sp > 3 && started) {
    const fx = Math.sin(carYaw), fz = Math.cos(carYaw), n = Math.random() < FX ? (sp > 10 ? 3 : 2) : 1;
    for (const wi of [2, 3]) for (let k = 0; k < n; k++) { // rear wheels
      const wp = chassisBody.pointToWorldFrame(WHEELS[wi], wheelW), surf = surfaceAt(wp.x, wp.z), q = pState[pNext];
      q.life = 0.5 + Math.random() * 0.4; q.x = wp.x - fx * WHEEL_R; q.z = wp.z - fz * WHEEL_R; q.y = groundAt(wp.x, wp.z) + 0.3;
      const kick = surf === 'water' ? 1.6 : 1;
      q.vx = -fx * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3; q.vz = -fz * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3; q.vy = (3 + Math.random() * 4) * kick;
      q.s = (surf === 'snow' || surf === 'water' ? 1.2 : 1) * (0.7 + Math.random() * 0.6);
      const cols = SURF[surf]; parts.setColorAt(pNext, tmpC.set(cols[(Math.random() * cols.length) | 0])); pNext = (pNext + 1) % PARTS;
    }
    parts.instanceColor.needsUpdate = true;
  }
  let alive = false;
  for (let i = 0; i < PARTS; i++) {
    const q = pState[i]; if (q.life <= 0) continue; alive = true;
    q.life -= dt; q.vy -= 16 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    const g = groundAt(q.x, q.z); if (q.y < g) { q.y = g; q.vy *= -0.2; q.vx *= 0.6; q.vz *= 0.6; }
    const s = Math.max(0, q.life) * 1.6 * q.s; parts.setMatrixAt(i, tmpM.makeScale(s, s, s).setPosition(q.x, q.y, q.z));
  }
  if (alive || partsWasAlive) parts.instanceMatrix.needsUpdate = true; partsWasAlive = alive;
}

function burst(x, y, z, n = Math.round(46 * FX)) { // the little blue explosion when a CV page is picked up
  const cols = [PAGE_BLUE, 0x5b9be0, 0x9cc4f0, 0xffffff];
  for (let k = 0; k < n; k++) {
    const q = pState[pNext], a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6;
    Object.assign(q, { life: 0.7 + Math.random() * 0.6, x, y: y + 3, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 5 + Math.random() * 8, s: 0.6 + Math.random() * 0.6 });
    parts.setColorAt(pNext, tmpC.set(cols[k % cols.length])); pNext = (pNext + 1) % PARTS;
  }
  parts.instanceColor.needsUpdate = true;
}
function dust(x, y, z, n = Math.round(40 * FX)) { // a puff of earth where something heavy lands
  const cols = SURF.earth.concat(SURF.grass);
  for (let k = 0; k < n; k++) {
    const q = pState[pNext], a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 7;
    Object.assign(q, { life: 0.6 + Math.random() * 0.5, x: x + Math.cos(a) * 1.5, y: y + 0.3, z: z + Math.sin(a) * 1.5, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 2 + Math.random() * 5, s: 0.8 + Math.random() * 0.8 });
    parts.setColorAt(pNext, tmpC.set(cols[k % cols.length])); pNext = (pNext + 1) % PARTS;
  }
  parts.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- springy trees and flying houses
const instM = new THREE.Matrix4(), instT = new THREE.Matrix4(), instQ = new THREE.Quaternion(), instY = new THREE.Quaternion(), instA = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
function placeInstance(t, x, y, z, tilt, pivotY = 0, sy = 1) { // M = T(base + pivot) · R(tilt · yaw) · Squash · T(-pivot) · S: squash and stretch about the pivot, keeping the volume
  if (!t.im) return;
  instQ.copy(tilt).multiply(instY.setFromAxisAngle(UPV, t.rot)); const sxz = 1 / Math.sqrt(sy);
  instM.makeScale(t.sc, t.sc, t.sc).premultiply(instT.makeTranslation(0, -pivotY, 0)).premultiply(instT.makeScale(sxz, sy, sxz)).premultiply(instT.makeRotationFromQuaternion(instQ)).premultiply(instT.makeTranslation(x, y + pivotY, z));
  t.im.setMatrixAt(t.idx, instM); t.im.instanceMatrix.needsUpdate = true;
}
// pine needles: shed by a tree while it moves, they flutter slowly down and fade on the ground
const NEEDLES = Math.round(500 * FX), needleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.55), new THREE.MeshBasicMaterial({ color: 0xffffff }), NEEDLES);
needleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); needleMesh.frustumCulled = false; scene.add(needleMesh);
const nState = Array.from({ length: NEEDLES }, () => ({ life: 0 })), NEEDLE_COLS = [0x6f7a2a, 0x8a9a3a, PAL.olive, 0x56601f];
let nNext = 0, needlesWasAlive = false; const nM = new THREE.Matrix4(), nQ = new THREE.Quaternion(), nE = new THREE.Euler(), nP = new THREE.Vector3(), nS = new THREE.Vector3();
for (let i = 0; i < NEEDLES; i++) { needleMesh.setMatrixAt(i, nM.makeScale(0, 0, 0)); needleMesh.setColorAt(i, tmpC.set(NEEDLE_COLS[i % 4])); }
function shedNeedles(t, n) { // from the canopy of the tree as it is bent right now
  const h = ASSETS.tree.height * t.sc, th = t.th || 0, bx = t.bx || 0, bz = t.bz || 0;
  for (let k = 0; k < n; k++) {
    const q = nState[nNext], up = 0.45 + Math.random() * 0.55, r = (1 - up) * 0.9 * t.sc + 0.2, a = Math.random() * Math.PI * 2;
    Object.assign(q, { life: 3 + Math.random() * 1.5, x: t.x + Math.sin(th) * bx * h * up + Math.cos(a) * r, y: t.y + Math.cos(th) * h * up, z: t.z + Math.sin(th) * bz * h * up + Math.sin(a) * r,
      vx: (Math.random() - 0.5) * 1.2 + (t.om || 0) * bx * 0.4, vz: (Math.random() - 0.5) * 1.2 + (t.om || 0) * bz * 0.4, vy: 0.6 + Math.random() * 0.8,
      ph: Math.random() * 6.28, fr: 2 + Math.random() * 2, rx: Math.random() * 6.28, ry: Math.random() * 6.28, sr: (Math.random() - 0.5) * 6, landed: false });
    needleMesh.setColorAt(nNext, tmpC.set(NEEDLE_COLS[(Math.random() * 4) | 0])); nNext = (nNext + 1) % NEEDLES;
  }
  needleMesh.instanceColor.needsUpdate = true;
}
function updateNeedles(dt, t) {
  let alive = false;
  for (let i = 0; i < NEEDLES; i++) {
    const q = nState[i]; if (q.life <= 0) continue; alive = true; q.life -= dt;
    if (!q.landed) { // falls slowly (air drag), swinging side to side like a leaf, spinning
      q.vy += (-1.1 - q.vy) * Math.min(1, dt * 2.5); q.vx *= 1 - Math.min(1, dt * 1.5); q.vz *= 1 - Math.min(1, dt * 1.5);
      const sw = Math.sin(t * q.fr + q.ph) * 0.9;
      q.x += (q.vx + sw * Math.cos(q.ph)) * dt; q.z += (q.vz + sw * Math.sin(q.ph)) * dt; q.y += q.vy * dt; q.rx += q.sr * dt; q.ry += q.sr * 0.7 * dt;
      const g = groundAt(q.x, q.z) + 0.05; if (q.y <= g) { q.y = g; q.landed = true; q.rx = Math.PI / 2; q.life = Math.min(q.life, 1.2); }
    }
    const s = Math.min(1, q.life / 0.6);
    needleMesh.setMatrixAt(i, nM.compose(nP.set(q.x, q.y, q.z), nQ.setFromEuler(nE.set(q.landed ? 0 : q.rx, q.ry, 0)), nS.set(s, s, s)));
  }
  if (alive || needlesWasAlive) needleMesh.instanceMatrix.needsUpdate = true; needlesWasAlive = alive;
}
// exhaust: small black puffs from the pipe at the rear right, two a second; they grow from 1/4 to 2/3 of a wheel and thin out over ~3.5 s
const PUFF_LIFE = 3.5, PUFF_RATE = 2, PUFF_N = 10, WHEEL_D = 2 * WHEEL_R;
const EXHAUST = new CANNON.Vec3(-AX * 0.72, -1.3 * SIZE_K + WHEEL_R * 0.35, -AZ - WHEEL_R * 1.3), exW = new CANNON.Vec3();
const puffGeo = new THREE.IcosahedronGeometry(0.5, 0), puffs = [];
for (let i = 0; i < PUFF_N; i++) { const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0x1a1817, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; m.renderOrder = 4; scene.add(m); puffs.push({ m, life: 0 }); }
let puffNext = 0, puffAcc = 0;
function updateExhaust(dt) {
  if (!started) return;
  puffAcc += dt * PUFF_RATE;
  while (puffAcc >= 1) { // a new puff, each a little different in shape, angle and size
    puffAcc -= 1; const p = puffs[puffNext]; puffNext = (puffNext + 1) % PUFF_N;
    chassisBody.pointToWorldFrame(EXHAUST, exW); const back = chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, -1));
    p.life = PUFF_LIFE * (0.9 + Math.random() * 0.2); p.max = p.life; p.m.visible = true;
    p.m.position.set(exW.x, exW.y, exW.z); p.vx = back.x * 1.2 + (Math.random() - 0.5) * 0.4; p.vz = back.z * 1.2 + (Math.random() - 0.5) * 0.4; p.vy = 0.35 + Math.random() * 0.25;
    p.m.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3); p.spin = (Math.random() - 0.5) * 0.8;
    p.shape = [0.8 + Math.random() * 0.45, 0.75 + Math.random() * 0.4, 0.8 + Math.random() * 0.45]; p.s0 = (0.85 + Math.random() * 0.3) * WHEEL_D / 4;
  }
  for (const p of puffs) {
    if (p.life <= 0) { if (p.m.visible) p.m.visible = false; continue; }
    p.life -= dt; const k = 1 - p.life / p.max, e = 1 - Math.pow(1 - k, 2); // grows fast, then slowly
    p.vx *= 1 - Math.min(1, dt * 1.2); p.vz *= 1 - Math.min(1, dt * 1.2);
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt; p.m.rotation.y += p.spin * dt;
    const s = p.s0 + (WHEEL_D * 2 / 3 - p.s0) * e; p.m.scale.set(s * p.shape[0], s * p.shape[1], s * p.shape[2]);
    p.m.material.opacity = 0.55 * (1 - k) * (1 - k * 0.4);
  }
}
// a big, thin dust cloud where a house lands
const clouds = [], cloudGeo = new THREE.IcosahedronGeometry(1, 1);
function dustCloud(x, y, z, size) {
  const N = 18, mat = new THREE.MeshBasicMaterial({ color: 0xcdbb8c, transparent: true, opacity: 0.3, depthWrite: false }), im = new THREE.InstancedMesh(cloudGeo, mat, N);
  im.frustumCulled = false; im.renderOrder = 3; scene.add(im);
  const puffs = Array.from({ length: N }, (_, i) => { const a = i / N * Math.PI * 2 + Math.random() * 0.4, r = size * (0.6 + Math.random() * 0.7); return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, y: y + Math.random() * 0.8, ox: Math.cos(a), oz: Math.sin(a), s: size * (0.6 + Math.random() * 0.5) }; });
  clouds.push({ im, mat, puffs, t: 0 });
}
function updateClouds(dt) {
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i]; c.t += dt; const k = c.t / 2.4;
    if (k >= 1) { scene.remove(c.im); c.im.dispose(); c.mat.dispose(); clouds.splice(i, 1); continue; }
    const grow = 1 - Math.pow(1 - k, 3); // billows out fast, then drifts
    c.mat.opacity = 0.3 * (1 - k) * (1 - k);
    c.puffs.forEach((p, j) => c.im.setMatrixAt(j, nM.compose(nP.set(p.x + p.ox * grow * 3.5, p.y + grow * 2.2, p.z + p.oz * grow * 3.5), nQ.identity(), nS.setScalar(p.s * (0.6 + grow * 1.6)))));
    c.im.instanceMatrix.needsUpdate = true;
  }
}
// trees bend away from the crawler like springs: pressed nearly flat while you are over them, then they straighten with a soft wobble
const TREE_K = 20, TREE_C = 4.4, TREE_MAX = 1.35; // spring stiffness, damping (ζ ≈ 0.5), deepest bend in radians
const treeQ = new THREE.Quaternion();
function updateTrees(dt) {
  const cp = car.position, v = chassisBody.velocity, sp = Math.hypot(v.x, v.z);
  for (const t of SCENERY.trees) {
    if (!t.im) return; // not loaded yet
    const dx = t.x - cp.x, dz = t.z - cp.z, d = Math.hypot(dx, dz), R = 3.1 + 0.5 * t.sc;
    let th = t.th || 0, om = t.om || 0;
    if (d < R) { // pressed: bend away from the crawler, mostly along its direction of travel
      let bx = dx / (d || 1) * 0.6, bz = dz / (d || 1) * 0.6; if (sp > 1) { bx += v.x / sp; bz += v.z / sp; } const bl = Math.hypot(bx, bz) || 1;
      t.bx = bx / bl; t.bz = bz / bl;
      const k = 1 - d / R, target = TREE_MAX * Math.min(1, k * k * (3 - 2 * k) * 1.6), nth = th + (target - th) * Math.min(1, dt * 14);
      om = (nth - th) / Math.max(dt, 1e-3); th = nth;
    } else if (Math.abs(th) > 0.002 || Math.abs(om) > 0.01) { // released: a damped spring back to upright
      om += (-TREE_K * th - TREE_C * om) * dt; th += om * dt;
    } else { if (t.th) { t.th = 0; t.om = 0; placeInstance(t, t.x, t.y, t.z, treeQ.identity()); } continue; }
    t.th = th; t.om = om;
    t.shed = (t.shed || 0) + Math.abs(om) * dt * 11 * FX; if (t.shed >= 1) { const n = Math.min(6, t.shed | 0); t.shed -= n; shedNeedles(t, n); } // needles fly off while it moves
    placeInstance(t, t.x, t.y, t.z, treeQ.setFromAxisAngle(instA.set(t.bz, 0, -t.bx), th));
  }
}
// houses: hit one at SUPER FAST and it is sent tumbling, two full rolls, and lands upright a little further on
const HOUSE_FLIGHT = 1.05, flying = [], houseByBody = new Map();
for (const h of SCENERY.houses) houseByBody.set(h.body, h);
let houseHitQueue = [];
chassisBody.addEventListener('collide', e => {
  const h = houseByBody.get(e.body); if (!h || h.flying) return;
  const r = chassisBody.velocity.length() / VMAX; if (r > 0.25) slap(r); // a bump into a house
  if (r < 1.35) return; // flying only at SUPER FAST
  h.flying = true; houseHitQueue.push({ h, v: chassisBody.velocity.clone() });
});
function landingSpot(h, dirx, dirz) { // a free spot ahead, on dry ground, away from the other houses
  for (const D of [14, 12, 16, 10, 18, 8]) for (const turn of [0, 0.35, -0.35, 0.7, -0.7]) {
    const c = Math.cos(turn), sn = Math.sin(turn), ux = dirx * c - dirz * sn, uz = dirx * sn + dirz * c, x = h.x + ux * D, z = h.z + uz * D, y = groundAt(x, z);
    if (!inside(x, z) || Math.hypot(x, z) > rimAt(x, z) - 8 || y < WATER_Y + 0.4) continue;
    if (SCENERY.houses.some(o => o !== h && Math.hypot(x - o.x, z - o.z) < 1.6 * (o.sc + h.sc) + 1)) continue;
    return [x, y, z, ux, uz];
  }
  return null;
}
function launchHouses(t) { // after the physics step: take the house out of the world and send it flying
  for (const { h, v } of houseHitQueue) {
    const s = Math.hypot(v.x, v.z) || 1, spot = landingSpot(h, v.x / s, v.z / s);
    if (!spot) { h.flying = false; continue; }
    world.removeBody(h.body); h.im.frustumCulled = false;
    const [x1, y1, z1, ux, uz] = spot;
    flying.push({ h, t0: t, x0: h.x, y0: h.y, z0: h.z, x1, y1, z1, ax: uz, az: -ux, spin: (Math.random() < 0.5 ? -1 : 1) * Math.PI * (0.5 + Math.random()) });
    chassisBody.velocity.copy(v).scale(0.85, chassisBody.velocity); // the crawler ploughs on
    play('honk'); comicBang(h, h.x - ux * 1.6 * h.sc, h.y + 2.2, h.z - uz * 1.6 * h.sc, 'KABOOM!');
  }
  houseHitQueue = [];
}
const houseQ = new THREE.Quaternion(), houseQ2 = new THREE.Quaternion();
const ANTIC = 0.14; // the house crouches for a moment before it goes
function updateHouses(t) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i], h = f.h, el = t - f.t0, pivot = 1.3 * h.sc;
    if (el < ANTIC) { const a = el / ANTIC; placeInstance(h, f.x0, f.y0, f.z0, houseQ.identity(), 0, 1 - 0.32 * Math.sin(a * Math.PI / 2)); continue; } // squash: anticipation
    const k = Math.min(1, (el - ANTIC) / HOUSE_FLIGHT);
    if (k < 1) { // an arc, rolling over twice about the axis across the flight, and a lazy turn about the vertical
      const x = f.x0 + (f.x1 - f.x0) * k, z = f.z0 + (f.z1 - f.z0) * k, y = f.y0 + (f.y1 - f.y0) * k + 9 * 4 * k * (1 - k);
      // stretch as it leaves the ground (from the crouch), round in the air, stretch again as it falls
      const sy = k < 0.4 ? 0.68 + 0.62 * Math.sin(Math.min(1, k / 0.2) * Math.PI / 2) - 0.3 * Math.max(0, (k - 0.2) / 0.2) : k > 0.7 ? 1 + 0.28 * (k - 0.7) / 0.3 : 1;
      houseQ.setFromAxisAngle(instA.set(f.ax, 0, f.az), k * Math.PI * 4).multiply(houseQ2.setFromAxisAngle(UPV, f.spin * k));
      placeInstance(h, x, y, z, houseQ, pivot, sy);
    } else { // landed: a hard squash, wobble back up, a big thin cloud, solid again where it stands
      const kk = (el - ANTIC - HOUSE_FLIGHT) / 0.7;
      if (!f.landed) {
        f.landed = true; h.x = f.x1; h.y = f.y1; h.z = f.z1; h.rot += f.spin;
        h.body.position.set(h.x, h.y + h.hy, h.z); h.body.quaternion.setFromEuler(0, h.rot, 0); world.addBody(h.body);
        dust(h.x, h.y, h.z); dustCloud(h.x, h.y, h.z, 2.2 * h.sc); tone(130, 45, 0.35, 0.35); slap(1);
      }
      const sy = kk >= 1 ? 1 : 1 - Math.exp(-4.5 * kk) * Math.cos(13 * kk) * 0.45; // from 0.55 (flat) through a stretch back to 1
      placeInstance(h, h.x, h.y, h.z, houseQ.identity(), 0, sy);
      if (kk >= 1) { h.flying = false; h.im.computeBoundingSphere(); h.im.frustumCulled = true; flying.splice(i, 1); }
    }
  }
}
// ---------------------------------------------------------------- horn (or bark) and confetti
const SFX = { honk: new Audio('assets/sfx/honk.mp3'), bark: new Audio('assets/sfx/bark.mp3'), sheep: new Audio('assets/sfx/sheep.mp3'), person: new Audio('assets/sfx/person.mp3'), fanfare: new Audio('assets/sfx/fanfare.mp3') };
Object.values(SFX).forEach(a => { a.preload = 'auto'; });
let actx = null; // small synthesised sounds: the notification chime and the bubble pops
function tone(f0, f1, dur, gain, type = 'sine', when = 0) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime + when, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) {}
}
const chime = () => { tone(784, 784, 0.22, 0.16, 'triangle'); tone(1175, 1175, 0.45, 0.16, 'triangle', 0.14); }; // pum-pim
const bubblePop = () => tone(380 + Math.random() * 220, 1500 + Math.random() * 700, 0.07, 0.2);
const ndc = new THREE.Vector3(), onCamera = p => { ndc.copy(p).project(camera); return Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1; };
// Web Audio sounds: the slap (a different pitch, speed, loudness and tone every time) and the engine loop, which follows the speed
const BUFS = {}; const bufFetch = { slap: fetch('assets/sfx/slap.mp3').then(r => r.arrayBuffer()).catch(() => null), engine: fetch('assets/sfx/engine.wav').then(r => r.arrayBuffer()).catch(() => null) };
function audioCtx() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch (e) { return null; } }
async function buffer(name) { if (BUFS[name] !== undefined) return BUFS[name]; const ab = await bufFetch[name], ctx = audioCtx(); BUFS[name] = ab && ctx ? await ctx.decodeAudioData(ab.slice(0)).catch(() => null) : null; return BUFS[name]; }
let lastSlap = 0;
async function slap(strength = 1) { // thump! never quite the same twice
  const now = performance.now(); if (now - lastSlap < 70) return; lastSlap = now;
  const ctx = audioCtx(), buf = await buffer('slap'); if (!ctx || !buf) return;
  const src = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  src.buffer = buf; src.playbackRate.value = 0.72 + Math.random() * 0.6; // lower and slower, or higher and snappier
  lp.type = 'lowpass'; lp.frequency.value = 1600 + Math.random() * 7000; lp.Q.value = 0.5 + Math.random() * 2; // duller or brighter
  g.gain.value = SFX_VOL * Math.min(1, strength) * (0.55 + Math.random() * 0.45);
  src.connect(lp).connect(g).connect(ctx.destination); src.start(ctx.currentTime, Math.random() * 0.015);
}
const ENGINE_VOL = 0.06; // very low under everything else
let engine = null;
async function startEngine() {
  const ctx = audioCtx(), buf = await buffer('engine'); if (!ctx || !buf || engine) return;
  const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.loop = true; g.gain.value = 0;
  src.connect(g).connect(ctx.destination); src.start(); engine = { src, g };
}
function updateEngine(r, audible) { // r: speed / fast. Idle rumble at rest, revving up to SUPER FAST
  if (!engine) return; const ctx = actx, k = Math.min(1.5, r) / 1.5;
  engine.src.playbackRate.setTargetAtTime(0.7 + 0.75 * k, ctx.currentTime, 0.25);
  engine.g.gain.setTargetAtTime(audible ? ENGINE_VOL * (0.6 + 0.7 * k) : 0, ctx.currentTime, 0.15);
}
const SFX_VOL = 0.75; // the files are all normalised to the same loudness (-16 LUFS), so they all play at one volume
function play(name) { try { const a = SFX[name].cloneNode(); a.volume = SFX_VOL; a.play().catch(() => {}); } catch (e) {} }
const shouts = []; // comic "!" lines
const shoutMats = { car: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), dog: new THREE.MeshBasicMaterial({ color: 0xff8a1f, depthTest: false }) }; // white for the horn, orange for the dog
function shout(origin, dir, who = 'car') { const shoutMat = shoutMats[who];
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
    shout(dog.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.6, 0)), fwdDir, 'dog'); toast('Woof! Woof!');
  } else {
    play('honk');
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
const CONF = Math.round(260 * FX), conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONF);
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
  play('fanfare'); // victory
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
  const first = !keys[e.code]; keys[e.code] = true;
  if (!started) return;
  if (first && e.code === 'KeyC') toggleMode();
  if (first && (e.code === 'KeyH' || e.code === 'Space')) honk();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
const releaseKeys = () => { for (const k in keys) keys[k] = false; touchHeld = false; }; // a key released while the page had the focus never reaches us
window.addEventListener('blur', releaseKeys); document.addEventListener('visibilitychange', releaseKeys);
const fwd = () => keys.ArrowUp, back = () => keys.ArrowDown, left = () => keys.ArrowLeft, right = () => keys.ArrowRight;
// touch (and mouse): press outside the crawler to drive there, tap the crawler to honk
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let touchGoal = null, touchHeld = false;
const tRay = new THREE.Raycaster(), tPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tHit = new THREE.Vector3(), tNdc = new THREE.Vector2(), tCar = new THREE.Vector3();
function groundUnder(cx, cy) {
  const r = canvas.getBoundingClientRect(); tNdc.set((cx - r.left) / r.width * 2 - 1, 1 - (cy - r.top) / r.height * 2);
  tRay.setFromCamera(tNdc, camera); tPlane.constant = -car.position.y; return tRay.ray.intersectPlane(tPlane, tHit) ? [tHit.x, tHit.z] : null;
}
function onCrawler(cx, cy) {
  const r = canvas.getBoundingClientRect(); tCar.copy(car.position).project(camera);
  return Math.hypot(cx - (r.left + (tCar.x + 1) / 2 * r.width), cy - (r.top + (1 - tCar.y) / 2 * r.height)) < Math.max(30, r.width * 0.08);
}
canvas.addEventListener('pointerdown', e => {
  if (!started) return; e.preventDefault(); canvas.focus();
  if (onCrawler(e.clientX, e.clientY)) { honk(); return; }
  touchHeld = true; touchGoal = groundUnder(e.clientX, e.clientY); try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', e => { if (touchHeld) touchGoal = groundUnder(e.clientX, e.clientY) || touchGoal; });
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { touchHeld = false; });
if (TOUCH) { // the start panel explains the touch controls
  document.querySelector('#start table').innerHTML = '<tr><td class="keys">Tap / hold</td><td>drive towards that point</td></tr><tr><td class="keys">Tap the crawler</td><td>horn: people and sheep run off</td></tr>';
  document.getElementById('startBtn').textContent = 'Start';
}
function toggleMode() {
  driveMode = driveMode === 'map' ? 'car' : 'map';
  toast(driveMode === 'map' ? 'Simplified controls: arrows point the crawler' : 'Car controls: ↑ gas, ↓ reverse, ← → steer');
}


// ---------------------------------------------------------------- HUD
const $ = id => document.getElementById(id);
let fragsShown = 0;
const reboom = el => { el.classList.remove('boom'); void el.getBoundingClientRect(); el.classList.add('boom'); };
function updateFrags() { // the new quarter (and the counter) crouch and burst like SUPER FAST!; the whole badge does it for the last one
  const got = pickups.filter(q => q.got).length;
  for (let i = 0; i < 4; i++) { const q = $('arc' + i); q.classList.toggle('got', i < got); if (i >= fragsShown && i < got) reboom(q); }
  $('fragCount').textContent = `${got} / 4`; if (got > fragsShown) { reboom($('fragCount')); if (got === 4) reboom($('frags').querySelector('svg')); }
  fragsShown = got;
}
let toastTimer; function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.opacity = 0), 2600); }
let achTimer; function achievement(top, msg) { // Xbox-style banner, top right
  const a = $('ach'); $('achTop').textContent = top; $('achMsg').textContent = msg;
  a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
  clearTimeout(achTimer); achTimer = setTimeout(() => a.classList.remove('show'), ACH_SECS * 1000);
}
const popIn = el => { el.style.display = 'block'; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }; // stretch-and-bounce entrance
const hudOn = { speed: false, map: false };
const mm = $('minimap').getContext('2d');
const mmBase = (() => { // pre-render the minimap terrain
  const c = document.createElement('canvas'); c.width = 150; c.height = 190; const g = c.getContext('2d'); const img = g.createImageData(150, 190);
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9; // the valley's own extent, so the map is centred in its frame
  for (let x = -160; x <= 160; x += 1) for (let z = -160; z <= 160; z += 1) if (inside(x, z) && Math.hypot(x, z) <= rimAt(x, z) - 2) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); }
  const M = 6, x0 = mnx - M, x1 = mxx + M, z0 = mnz - M, z1 = mxz + M;
  for (let py = 0; py < 190; py++) for (let px = 0; px < 150; px++) {
    const x = x0 + (x1 - x0) * px / 149, z = z0 + (z1 - z0) * py / 189, y = groundAt(x, z), o = (px + py * 150) * 4;
    if (!inside(x, z) || Math.hypot(x, z) > rimAt(x, z) - 2) continue;
    const [r, gg, b] = y < WATER_Y ? [63, 182, 200] : y < 2.2 ? [164, 162, 76] : y < 6 ? [133, 138, 51] : y < 8.5 ? [108, 111, 42] : y < 15.5 ? [110, 107, 103] : [243, 248, 253]; // the terrain's own colours
    img.data.set([r, gg, b, 245], o);
  }
  g.putImageData(img, 0, 0); return { c, x0, x1, z0, z1 };
})();
function drawMinimap(heading) {
  const { c, x0, x1, z0, z1 } = mmBase; mm.clearRect(0, 0, 150, 190); mm.drawImage(c, 0, 0);
  const toM = (x, z) => [(x - x0) / (x1 - x0) * 149, (z - z0) / (z1 - z0) * 189];
  for (const p of pickups) { if (p.got || !p.group.visible) continue; const [mx, my] = toM(...p.pos); mm.fillStyle = '#' + p.color.toString(16).padStart(6, '0'); mm.fillRect(mx - 3, my - 3, 6, 6); }
  if (dogState === 'waiting') { const [dx, dy] = toM(dog.position.x, dog.position.z); mm.fillStyle = '#ff8a1f'; mm.strokeStyle = '#ffffff'; mm.lineWidth = 2; mm.beginPath(); mm.arc(dx, dy, 4.5, 0, Math.PI * 2); mm.fill(); mm.stroke(); } // the dog: an orange dot, like its ring
  const [cx, cy] = toM(chassisBody.position.x, chassisBody.position.z);
  mm.save(); mm.translate(cx, cy); mm.rotate(heading); /* heading is clockwise from north, like canvas rotation */ mm.fillStyle = '#e7c76f'; mm.strokeStyle = '#3a2a24'; mm.lineWidth = 1.5; mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 5); mm.lineTo(-5, 5); mm.closePath(); mm.fill(); mm.stroke(); mm.restore(); // the crawler, mustard like the car
}

const SECTION_NAMES = { edu: 'Education and Languages', proj: 'Projects and Skills', pub: 'Publications', exp: 'Work Experience and Interests' };
const UNLOCKS = ['Minimap', 'Obstacle detection', 'AR navigation']; // what the 1st, 2nd and 3rd page unlock
function collect(p) {
  p.got = true; p.group.visible = false; updateFrags();
  burst(p.group.position.x, p.group.position.y, p.group.position.z); chime();
  const last = p.id === 'exp', n = last ? 4 : pickups.slice(0, 3).filter(q => q.got).length; // 1st, 2nd or 3rd page, whatever the order
  achievement(`Fragment ${n} / 4 · ${last ? 'HUD complete' : UNLOCKS[n - 1] + ' unlocked'}`, `${SECTION_NAMES[p.id]} added to the CV${EMBEDDED ? '. Scroll down to read them' : ''}`);
  if (EMBEDDED) window.parent.postMessage({ type: 'coolcv:reveal', id: p.id, last }, location.origin); // the page shows those sections
  if (last) { // confetti, a trophy rising from the summit, then the closing message
    carpetOn = false; chevrons.count = 0; confetti(); raiseTrophy(p.group.position);
    setTimeout(() => {
      $('finaleCredits').innerHTML = creditsHtml(); $('finaleCredits').hidden = true;
      if (!EMBEDDED) { $('finaleMsg').textContent = 'Head back to the CV page to read it all.'; $('finaleClose').textContent = 'Back to the CV'; }
      $('finale').style.display = 'flex';
    }, 3000);
    return;
  }
  pendingUnlock = { n, at: clock.elapsedTime + ACH_SECS }; // it arrives once the banner has gone and the crawler is moving
}
const ACH_SECS = 4.2, NEW_NAMES = ['Map and speedometer', 'Pedestrian highlight', 'Directions'];
let pendingUnlock = null;
function updateUnlocks(t) {
  if (!pendingUnlock) return;
  const u = pendingUnlock;
  if (!u.bubble && t >= u.at + 0.3) { u.bubble = true; newAddition(NEW_NAMES[u.n - 1]); } // 0.3 s after the banner has gone
  if (!u.done && u.bubble && chassisBody.velocity.length() > 1) { // …and the unlock itself once the crawler moves
    u.done = t;
    if (u.n === 1) { hudOn.speed = hudOn.map = true; popIn($('minimap')); popIn(speedEl); }
    if (u.n === 2) showBoxes(t);
    if (u.n === 3) { carpetOn = true; carpetT0 = t; pickups[3].group.visible = true; }
  }
  if (u.done && t >= u.done + 0.5) { $('newAdd').style.display = 'none'; newShown = false; pendingUnlock = null; } // the bubble stays 0.5 s more
}
let newShown = false; // the blue bubble above the crawler: "New addition!" and what is about to arrive
function newAddition(name) { $('newName').textContent = name; newShown = true; popIn($('newAdd')); }
const nAbove = new THREE.Vector3();
function placeNewAddition() {
  if (!newShown) return;
  nAbove.copy(car.position); nAbove.y += 4.2; nAbove.project(camera);
  const el = $('newAdd'); el.style.left = ((nAbove.x + 1) / 2 * 100) + '%'; el.style.top = ((1 - nAbove.y) / 2 * 100) + '%';
}
function closeGame() {
  if (!EMBEDDED) { location.href = '../'; return; }
  try { if (window.parent.coolCvClose) { window.parent.coolCvClose(); return; } } catch (e) {}
  window.parent.postMessage({ type: 'coolcv:close' }, location.origin);
  setTimeout(() => { try { window.parent.location.reload(); } catch (e) {} }, 800); // still here? the page did not answer: reload it
}
$('finaleClose').addEventListener('click', closeGame);
$('finaleCreditsBtn').addEventListener('click', () => { const c = $('finaleCredits'); c.hidden = !c.hidden; $('finaleCreditsBtn').textContent = c.hidden ? 'credits ▸' : 'credits ▾'; });

// the trophy: rises from the summit and floats in the air
const trophy = new THREE.Group(); trophy.visible = false; scene.add(trophy);
{
  const gold = toon({ color: 0xe3b341 }), dark = toon({ color: 0x6b4f1d });
  const cup = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.55, 0], [0.55, 0.12], [0.18, 0.25], [0.14, 0.75], [0.3, 0.95], [0.85, 1.25], [0.95, 2.05], [0.88, 2.1], [0.75, 1.4], [0, 1.25]].map(([x, y]) => new THREE.Vector2(x, y)), 20), gold);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.4), dark); base.position.y = -0.17;
  for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 16, Math.PI), gold); h.position.set(sx * 0.95, 1.6, 0); h.rotation.z = sx * -Math.PI / 2; trophy.add(h); }
  trophy.add(cup, base); trophy.traverse(o => { if (o.isMesh) o.castShadow = true; }); trophy.scale.setScalar(1.8);
}
let trophyT0 = -1, trophyFrom = new THREE.Vector3();
function raiseTrophy(at) { trophyFrom.copy(at); trophyT0 = clock.elapsedTime; trophy.visible = true; }
function updateTrophy(t) {
  if (trophyT0 < 0) return;
  const k = Math.min(1, (t - trophyT0) / 2), e = 1 - Math.pow(1 - k, 3); // rise for two seconds, easing out…
  trophy.position.set(trophyFrom.x, trophyFrom.y + e * 8 + (k >= 1 ? Math.sin((t - trophyT0 - 2) * 1.6) * 0.5 : 0), trophyFrom.z); // …then bob
  trophy.rotation.y = (t - trophyT0) * 0.9; trophy.scale.setScalar(1.8 * Math.max(0.05, bounce(Math.min(1, (t - trophyT0) / 0.8))));
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const camLook = new THREE.Vector3();
let started = false;
camLook.set(START[0], groundAt(...START), START[1]);

// Driving is arcade: on the ground the controller sets the car's speed and turn rate directly,
// so speed is the same in every direction and on every slope. Wheels only do the suspension.
const VMAX = 16 * 1.35, VBACK = 8 * 1.35; // 'fast'; slow is half of it, super fast 1.5 times
let holdT = 0; // how long the throttle has been held
const rampSpeed = () => VMAX * (holdT < 2 ? 0.5 + 0.5 * holdT / 2 : 1 + 0.5 * Math.min(1, (holdT - 2) / 4));
let driveMode = 'car'; // 'car' (default): up = throttle, left/right = steer · 'map': simplified, arrows point the car on screen
// The crawler: it always sits on its four wheels. Input sets a heading and a ground speed; the body's height,
// pitch and roll come from the terrain under the wheels. Physics only stops it at houses and the border cliffs.
let carYaw = Math.PI; // facing north
function control(h) {
  const live = started;
  let speed = 0, yawRate = 0;
  if (touchGoal && Math.hypot(touchGoal[0] - chassisBody.position.x, touchGoal[1] - chassisBody.position.z) < 2.5 && !touchHeld) touchGoal = null; // arrived
  const throttle = live && (touchGoal || (driveMode === 'map' ? (left() || right() || fwd() || back()) : fwd()));
  holdT = throttle ? holdT + h : 0;
  if (live && touchGoal) { // touch: head for the point under the finger (or the last one tapped)
    let err = Math.atan2(touchGoal[0] - chassisBody.position.x, touchGoal[1] - chassisBody.position.z) - carYaw; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    yawRate = Math.max(-4, Math.min(4, err * 6));
    speed = Math.abs(err) < 0.35 ? rampSpeed() : Math.abs(err) < 1.2 ? VMAX * 0.4 : VMAX * 0.15; // keep rolling while it turns
  } else if (live && driveMode === 'map') {
    const ix = (right() ? 1 : 0) - (left() ? 1 : 0), iz = (back() ? 1 : 0) - (fwd() ? 1 : 0);
    if (ix || iz) {
      let err = Math.atan2(ix, iz) - carYaw; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      yawRate = Math.max(-4, Math.min(4, err * 8));                                   // turn on the spot towards the arrow…
      speed = Math.abs(err) < 0.25 ? rampSpeed() : Math.abs(err) < 0.7 ? VMAX * 0.35 : 0; // …then go, faster the longer you hold
    }
  } else if (live) {
    speed = fwd() ? rampSpeed() : back() ? -VBACK : 0;
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
}
world.addEventListener("preStep", () => control(world.dt));

// fixed 60 Hz physics; the crawler is drawn interpolated between the last two steps, so it glides on any screen (120/144 Hz, uneven frames)
const STEP = 1 / 60, prevPos = chassisBody.position.clone(), prevQuat = chassisBody.quaternion.clone(), qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
let stepAcc = 0;
function step(dt) {
  stepAcc = Math.min(stepAcc + dt, STEP * 4);
  while (stepAcc >= STEP) {
    prevPos.copy(chassisBody.position); prevQuat.copy(chassisBody.quaternion);
    world.step(STEP); settleOnWheels(); stepAcc -= STEP;
  }
  launchHouses(clock.elapsedTime);
}
function syncCar() { // position and orientation a fraction of the way from the previous step to the current one
  const k = stepAcc / STEP, p = chassisBody.position, q = chassisBody.quaternion;
  car.position.set(prevPos.x + (p.x - prevPos.x) * k, prevPos.y + (p.y - prevPos.y) * k, prevPos.z + (p.z - prevPos.z) * k);
  qA.set(prevQuat.x, prevQuat.y, prevQuat.z, prevQuat.w); qB.set(q.x, q.y, q.z, q.w); car.quaternion.slerpQuaternions(qA, qB, k);
}
let wheelSpin = 0;
const ZF = new CANNON.Vec3(0, 0, 1), zfW = new CANNON.Vec3(), SUN_OFF = new THREE.Vector3(60, 110, 40), fwdV = new THREE.Vector3(), seatW = new THREE.Vector3(); // reused every frame
const speedEl = $('speed'), needleEl = $('needle'); let speedShown = -999, needleJ = 0, lastCarY = 0;
const superEl = $('superTxt'), shakeEl = $('superShake'); let superOn = false; // the SUPER FAST! label bursts when the needle enters the red

// tyre tracks: two strips behind the rear wheels, laid on the ground in short segments that fade out in a few seconds
const TRACK_LIFE = 4.5, TRACK_N = 600, TRACK_W = 0.55 * SIZE_K / 0.6, TRACK_STEP = 0.45, TRACK_ALPHA = 0.42;
const trackGeo = new THREE.BufferGeometry(), trackPos = new Float32Array(2 * TRACK_N * 6 * 3), trackCol = new Float32Array(2 * TRACK_N * 6 * 4);
{ const c = new THREE.Color(0x2e2217); for (let i = 0; i < trackCol.length; i += 4) trackCol.set([c.r, c.g, c.b, 0], i); }
trackGeo.setAttribute('position', new THREE.BufferAttribute(trackPos, 3)); trackGeo.setAttribute('color', new THREE.BufferAttribute(trackCol, 4));
const tracks = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
tracks.frustumCulled = false; tracks.renderOrder = 2; scene.add(tracks);
const trackBorn = new Float32Array(2 * TRACK_N).fill(-1e9), trackHead = [0, 0];
const trackLast = [null, null]; // per wheel: the last point laid and its two edges
function layTrack(w, x, z, t) {
  const y = groundAt(x, z);
  if (y < WATER_Y + 0.05) { trackLast[w] = null; return; } // no tracks in the water
  const last = trackLast[w];
  if (!last) { trackLast[w] = { x, z, y, l: null, r: null }; return; }
  const dx = x - last.x, dz = z - last.z, d = Math.hypot(dx, dz);
  if (d < TRACK_STEP) return;
  if (d > 3) { trackLast[w] = { x, z, y, l: null, r: null }; return; } // a jump: start a new strip
  const nx = -dz / d * TRACK_W / 2, nz = dx / d * TRACK_W / 2, h = 0.07;
  const l = [x + nx, y + h, z + nz], r = [x - nx, y + h, z - nz];
  const pl = last.l || [last.x + nx, last.y + h, last.z + nz], pr = last.r || [last.x - nx, last.y + h, last.z - nz];
  const seg = w * TRACK_N + trackHead[w]; trackHead[w] = (trackHead[w] + 1) % TRACK_N;
  trackPos.set([...pl, ...pr, ...l, ...pr, ...r, ...l], seg * 18); trackBorn[seg] = t;
  trackLast[w] = { x, z, y, l, r };
  trackGeo.attributes.position.needsUpdate = true;
}
function updateTracks(t) {
  const p = car.position, c = Math.cos(carYaw), sn = Math.sin(carYaw);
  [AX, -AX].forEach((lx, w) => layTrack(w, p.x + lx * c - AZ * sn, p.z - lx * sn - AZ * c, t)); // the two rear wheels
  for (let i = 0; i < 2 * TRACK_N; i++) {
    const k = (t - trackBorn[i]) / TRACK_LIFE, a = k >= 1 ? 0 : TRACK_ALPHA * (1 - k * k); // stays dark, then fades quicker at the end
    const o = i * 24 + 3; if (trackCol[o] === a) continue;
    for (let v = 0; v < 6; v++) trackCol[o + v * 4] = a;
  }
  trackGeo.attributes.color.needsUpdate = true;
}

document.addEventListener('visibilitychange', () => { if (document.hidden) updateEngine(0, false); }); // no engine noise from a hidden tab
let onScreen = true; // skip the work while the game is scrolled out of view (or its tab is hidden)
new IntersectionObserver(e => { onScreen = e[0].isIntersecting; }).observe(canvas);
function frame() {
  requestAnimationFrame(frame);
  if (!onScreen) { clock.getDelta(); updateEngine(0, false); return; }
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  step(dt);
  // sync visuals
  syncCar(); updateTracks(t); updateEngine(chassisBody.velocity.length() / VMAX, !document.hidden);
  wheelSpin += chassisBody.velocity.dot(chassisBody.quaternion.vmult(ZF, zfW)) * dt / WHEEL_R;
  for (const a of carAxles) a.rotation.x = wheelSpin;
  // camera: fixed isometric angle, follows the car smoothly
  camLook.lerp(car.position, 1 - Math.exp(-dt * 5));
  camera.position.copy(camLook).add(CAM_OFFSET); camera.lookAt(camLook);
  sun.position.copy(car.position).add(SUN_OFF); sun.target.position.copy(car.position);
  // pickups
  for (const p of pickups) {
    if (p.got || !p.group.visible) continue;
    p.card.rotation.y = t * 1.5; p.card.position.y = 3 + Math.sin(t * 2) * 0.4;
    const d = Math.hypot(car.position.x - p.group.position.x, car.position.z - p.group.position.z);
    if (d < 6.5) collect(p);
  }
  // dog
  const dDog = Math.hypot(car.position.x - DOG_POS[0], car.position.z - DOG_POS[1]);
  if (dogState === 'waiting') {
    dog.lookAt(car.position.x, dog.position.y, car.position.z);
    if (dDog < 10 && chassisBody.velocity.length() < 8) { dogState = 'jumping'; dogJumpT = 0; dogJumpFrom.copy(dog.position); dogRing.visible = false; toast('Your co-pilot just jumped aboard!'); }
  } else if (dogState === 'jumping') {
    dogJumpT += dt / 0.7; const to = car.userData.seat.getWorldPosition(seatW);
    dog.position.lerpVectors(dogJumpFrom, to, Math.min(1, dogJumpT)); dog.scale.setScalar(3.3 * SIZE_K * (DOG_WAIT_K + (1 - DOG_WAIT_K) * Math.min(1, dogJumpT))); dog.position.y += Math.sin(Math.min(1, dogJumpT) * Math.PI) * 4;
    if (dogJumpT >= 1) { dogState = 'aboard'; car.userData.seat.add(dog); dog.position.set(0, 0, 0); dog.rotation.set(0, Math.PI / 2, 0); dog.scale.setScalar(3.3 * SIZE_K / CAR_SCALE); } // same size as on the ground, standing across the rear bed
  } else { dog.rotation.y += ((dogSide > 0 ? Math.PI / 2 : -Math.PI / 2) - dog.rotation.y) * Math.min(1, dt * 3); dogTurnT -= dt; if (dogTurnT <= 0) { dogSide = -dogSide; dogTurnT = 3 + Math.random() * 4; } }
  updateUnlocks(t); placeNewAddition(); updateBoxes(t); updateTrophy(t); updateWalkers(dt, t); updateTrees(dt); updateNeedles(dt, t); updateHouses(t); updateClouds(dt); updateExhaust(dt); updateParticles(dt); updateShouts(dt); updateComics(); updateConfetti(dt);
  updateCarpet(t);
  // HUD
  fwdV.set(0, 0, 1).applyQuaternion(car.quaternion); const heading = Math.atan2(fwdV.x, -fwdV.z);
  if (hudOn.speed) { // needle: 0 → slow → fast → super fast, shaking with the bumps of the ground and a little at random
    const r = chassisBody.velocity.length() / VMAX;
    if (!superOn && r >= 1.35) { superOn = true; superEl.classList.remove('boom'); void superEl.getBoundingClientRect(); superEl.classList.add('boom'); shakeEl.classList.add('shake'); }
    else if (superOn && r < 1.15) { superOn = false; shakeEl.classList.remove('shake'); } // re-arm once well below the red
    const base = r <= 0.5 ? -90 + r / 0.5 * 30 : r <= 1 ? -60 + (r - 0.5) / 0.5 * 60 : (Math.min(1.5, r) - 1) / 0.5 * 60;
    const bump = Math.min(14, Math.abs(car.position.y - lastCarY) / Math.max(dt, 1e-3) * 2.5); lastCarY = car.position.y;
    needleJ += ((Math.random() - 0.5) * (superOn ? 26 : r > 0.1 ? 10 : 1) + (Math.random() < 0.5 ? -bump : bump) - needleJ) * Math.min(1, dt * 12);
    const wob = superOn ? Math.sin(t * 47) * 3.5 + Math.sin(t * 29) * 2.5 : 0; // at SUPER FAST the needle shudders against the stop
    const a = Math.round((base + needleJ + wob) * 2) / 2; if (a !== speedShown) { speedShown = a; needleEl.setAttribute('transform', `rotate(${a} 55.14 65)`); }
  }
  if (hudOn.map) drawMinimap(heading);
  if (MOBILE) renderer.shadowMap.needsUpdate = (frameNo++ & 1) === 0;
  renderer.render(scene, camera);
}
let frameNo = 0;

$('loading').style.display = 'none';
const startEl = $('start'); startEl.style.display = 'flex';
const begin = () => { if (started) return; started = true; startEngine(); startEl.style.display = 'none'; canvas.focus(); toast('Follow the blue beams to the fragments'); };
startEl.addEventListener('click', begin); $('startBtn').addEventListener('click', begin);
window.addEventListener('keydown', begin, { once: true });
frame();

// for automated checks
window.__coolcv = { setView(v) { VIEW = v; resize(); }, forceCarpet() { carpetOn = true; carpetT0 = clock.elapsedTime; }, camera, get trophyY() { return trophy.visible ? trophy.position.y : -1; }, get speedRatio() { return chassisBody.velocity.length() / VMAX; }, get holdT() { return holdT; }, renderer, scene, get shouts() { return shouts.length; }, get chevronsOn() { return chevrons.count; }, get confettiOn() { return cState.filter(q => q.life > 0).length; }, get axleSpin() { return wheelSpin; }, get driveMode() { return driveMode; }, walkers, world, CARPET_ROUTE, SCENERY, chassisBody, car, dog, pickups, groundAt, collect, keys, get dogState() { return dogState; }, get carpetOn() { return carpetOn; } };
