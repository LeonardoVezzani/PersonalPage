// Cool CV — a small off-road game across a stylized Piemonte.
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

// ---------------------------------------------------------------- map projection
// 1 world unit ≈ 0.5 km. x grows east, z grows south.
const LON0 = 7.9, LAT0 = 45.25;
const MS = 0.5; // map scale: the region is drawn at half its original game size
const toXZraw = (lon, lat) => [(lon - LON0) * 157.2, -(lat - LAT0) * 222];
const toXZ = (lon, lat) => { const [x, z] = toXZraw(lon, lat); return [x * MS, z * MS]; };

const SIZE = 280;          // world size (square)
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
const P = pts => pts.map(([lo, la]) => toXZraw(lo, la));
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
const PEAKS = [[7.093, 44.667, 22, 9], [7.867, 45.937, 24, 11], [7.077, 45.203, 10, 6], [7.10, 45.335, 9, 5], [6.95, 44.45, 10, 9]].map(([lo, la, h, r]) => { const [x, z] = toXZraw(lo, la); return { x, z, h, r }; });
const PO = P([[7.1, 44.7], [7.4, 44.76], [7.6, 44.95], [7.69, 45.05], [7.95, 45.15], [8.4, 45.15], [8.7, 45.05], [9.3, 45.1]]);
const LAKE = (() => { const [x, z] = toXZraw(8.58, 45.95); return { x, z, rx: 9, rz: 38 }; })();
const HILLS = [[8.05, 44.6, 55, 7], [8.3, 45.05, 45, 6], [7.78, 45.08, 12, 5]].map(([lo, la, r, h]) => { const [x, z] = toXZraw(lo, la); return { x, z, r, h }; });

// Piemonte border (openpolis/geojson-italy, ISTAT 2024, simplified), lon/lat
const BORDER_LL = [[7.136,45.28],[7.121,45.3],[7.109,45.32],[7.128,45.328],[7.134,45.348],[7.155,45.356],[7.163,45.382],[7.178,45.396],[7.164,45.413],[7.142,45.425],[7.121,45.432],[7.106,45.45],[7.11,45.47],[7.117,45.491],[7.125,45.51],[7.143,45.499],[7.143,45.478],[7.162,45.486],[7.185,45.483],[7.207,45.476],[7.228,45.475],[7.248,45.494],[7.266,45.503],[7.29,45.515],[7.312,45.515],[7.334,45.521],[7.355,45.524],[7.374,45.516],[7.394,45.527],[7.416,45.541],[7.443,45.554],[7.459,45.569],[7.485,45.582],[7.506,45.582],[7.526,45.577],[7.547,45.588],[7.568,45.591],[7.586,45.582],[7.605,45.574],[7.63,45.569],[7.657,45.563],[7.675,45.552],[7.696,45.556],[7.716,45.559],[7.736,45.551],[7.757,45.565],[7.777,45.571],[7.794,45.582],[7.816,45.593],[7.837,45.598],[7.862,45.597],[7.888,45.598],[7.901,45.617],[7.915,45.633],[7.936,45.636],[7.926,45.655],[7.912,45.671],[7.907,45.691],[7.924,45.706],[7.937,45.724],[7.926,45.742],[7.905,45.748],[7.885,45.76],[7.874,45.777],[7.864,45.795],[7.862,45.82],[7.864,45.84],[7.876,45.862],[7.864,45.893],[7.862,45.914],[7.871,45.933],[7.877,45.955],[7.88,45.975],[7.902,45.988],[7.922,45.997],[7.955,45.997],[7.982,45.998],[8.006,46.012],[8.014,46.033],[8.033,46.047],[8.023,46.068],[8.032,46.093],[8.059,46.103],[8.084,46.106],[8.106,46.112],[8.115,46.13],[8.135,46.137],[8.153,46.146],[8.157,46.171],[8.152,46.197],[8.142,46.218],[8.125,46.23],[8.107,46.25],[8.088,46.254],[8.104,46.277],[8.12,46.29],[8.138,46.302],[8.164,46.296],[8.184,46.3],[8.204,46.305],[8.216,46.321],[8.234,46.34],[8.258,46.346],[8.266,46.365],[8.289,46.368],[8.315,46.381],[8.31,46.403],[8.291,46.407],[8.303,46.424],[8.33,46.429],[8.348,46.44],[8.37,46.452],[8.391,46.452],[8.413,46.459],[8.435,46.464],[8.462,46.448],[8.458,46.426],[8.467,46.4],[8.467,46.374],[8.462,46.354],[8.465,46.334],[8.45,46.321],[8.434,46.302],[8.439,46.283],[8.455,46.266],[8.464,46.245],[8.479,46.23],[8.501,46.226],[8.533,46.217],[8.541,46.198],[8.562,46.185],[8.573,46.166],[8.599,46.156],[8.61,46.133],[8.632,46.122],[8.66,46.112],[8.681,46.107],[8.703,46.101],[8.706,46.08],[8.716,46.062],[8.72,46.042],[8.729,46.023],[8.715,46.008],[8.691,45.993],[8.654,45.966],[8.617,45.938],[8.6,45.926],[8.583,45.912],[8.57,45.891],[8.584,45.865],[8.595,45.845],[8.592,45.824],[8.574,45.811],[8.556,45.801],[8.556,45.775],[8.572,45.759],[8.587,45.743],[8.6,45.727],[8.623,45.724],[8.644,45.723],[8.647,45.694],[8.653,45.675],[8.673,45.677],[8.681,45.651],[8.662,45.643],[8.663,45.623],[8.683,45.619],[8.695,45.603],[8.696,45.582],[8.707,45.559],[8.719,45.531],[8.72,45.51],[8.739,45.498],[8.76,45.497],[8.777,45.484],[8.79,45.466],[8.805,45.45],[8.819,45.435],[8.829,45.415],[8.842,45.399],[8.823,45.392],[8.804,45.38],[8.779,45.383],[8.76,45.376],[8.736,45.376],[8.744,45.357],[8.743,45.337],[8.723,45.322],[8.716,45.303],[8.697,45.295],[8.676,45.293],[8.659,45.304],[8.656,45.326],[8.634,45.337],[8.619,45.353],[8.599,45.349],[8.578,45.348],[8.557,45.353],[8.532,45.345],[8.538,45.32],[8.52,45.312],[8.501,45.295],[8.513,45.275],[8.534,45.278],[8.533,45.258],[8.546,45.242],[8.53,45.23],[8.545,45.209],[8.525,45.2],[8.546,45.195],[8.572,45.206],[8.546,45.183],[8.555,45.164],[8.577,45.153],[8.59,45.133],[8.612,45.128],[8.609,45.108],[8.622,45.091],[8.64,45.078],[8.645,45.057],[8.644,45.036],[8.657,45.019],[8.682,45.029],[8.702,45.028],[8.728,45.023],[8.75,45.021],[8.767,45.01],[8.782,45.023],[8.802,45.026],[8.822,45.04],[8.841,45.047],[8.861,45.051],[8.88,45.06],[8.9,45.044],[8.904,45.02],[8.908,44.998],[8.925,44.985],[8.952,44.988],[8.973,44.973],[8.977,44.953],[8.998,44.918],[9.015,44.901],[9.035,44.888],[9.055,44.889],[9.067,44.869],[9.055,44.852],[9.064,44.833],[9.077,44.815],[9.098,44.817],[9.116,44.807],[9.147,44.809],[9.165,44.8],[9.172,44.781],[9.189,44.759],[9.209,44.754],[9.206,44.728],[9.206,44.707],[9.2,44.686],[9.206,44.661],[9.199,44.639],[9.2,44.616],[9.203,44.596],[9.183,44.591],[9.164,44.581],[9.145,44.574],[9.122,44.58],[9.104,44.591],[9.099,44.612],[9.08,44.621],[9.058,44.622],[9.039,44.641],[9.023,44.654],[9.007,44.668],[8.986,44.664],[8.967,44.67],[8.938,44.676],[8.921,44.663],[8.902,44.645],[8.883,44.639],[8.899,44.624],[8.906,44.603],[8.912,44.583],[8.92,44.565],[8.901,44.555],[8.88,44.555],[8.854,44.56],[8.833,44.562],[8.828,44.542],[8.808,44.535],[8.795,44.519],[8.793,44.498],[8.771,44.489],[8.768,44.519],[8.757,44.536],[8.738,44.552],[8.731,44.571],[8.714,44.581],[8.693,44.581],[8.671,44.581],[8.646,44.582],[8.625,44.585],[8.611,44.571],[8.612,44.548],[8.593,44.535],[8.574,44.523],[8.563,44.506],[8.544,44.512],[8.516,44.51],[8.482,44.511],[8.458,44.515],[8.449,44.497],[8.429,44.503],[8.41,44.51],[8.399,44.491],[8.383,44.476],[8.365,44.467],[8.351,44.482],[8.329,44.488],[8.305,44.503],[8.276,44.507],[8.253,44.529],[8.233,44.518],[8.218,44.502],[8.219,44.482],[8.198,44.471],[8.207,44.448],[8.222,44.433],[8.208,44.416],[8.194,44.4],[8.171,44.395],[8.152,44.386],[8.141,44.369],[8.145,44.347],[8.125,44.333],[8.105,44.329],[8.104,44.307],[8.083,44.308],[8.061,44.3],[8.077,44.287],[8.087,44.27],[8.068,44.256],[8.081,44.241],[8.067,44.225],[8.075,44.206],[8.095,44.197],[8.092,44.175],[8.074,44.155],[8.054,44.143],[8.035,44.15],[8.012,44.156],[7.989,44.145],[8.003,44.126],[8.012,44.105],[7.99,44.109],[7.965,44.111],[7.946,44.102],[7.926,44.11],[7.902,44.108],[7.877,44.114],[7.856,44.12],[7.83,44.121],[7.789,44.134],[7.769,44.14],[7.746,44.135],[7.726,44.126],[7.718,44.104],[7.732,44.084],[7.754,44.085],[7.736,44.075],[7.714,44.062],[7.718,44.082],[7.696,44.1],[7.681,44.114],[7.667,44.13],[7.679,44.147],[7.682,44.167],[7.657,44.177],[7.637,44.177],[7.626,44.157],[7.6,44.152],[7.566,44.155],[7.548,44.146],[7.526,44.14],[7.504,44.144],[7.484,44.134],[7.458,44.127],[7.432,44.13],[7.397,44.123],[7.376,44.121],[7.355,44.118],[7.345,44.139],[7.321,44.143],[7.292,44.146],[7.265,44.149],[7.248,44.159],[7.229,44.169],[7.206,44.182],[7.19,44.195],[7.167,44.205],[7.147,44.2],[7.127,44.21],[7.103,44.22],[7.077,44.232],[7.057,44.229],[7.037,44.224],[7.019,44.233],[7.001,44.243],[6.996,44.271],[6.982,44.287],[6.962,44.294],[6.957,44.314],[6.932,44.331],[6.919,44.353],[6.898,44.359],[6.896,44.387],[6.896,44.408],[6.911,44.424],[6.933,44.427],[6.917,44.449],[6.897,44.471],[6.878,44.48],[6.865,44.497],[6.857,44.518],[6.865,44.537],[6.881,44.554],[6.904,44.556],[6.921,44.57],[6.933,44.592],[6.95,44.614],[6.969,44.626],[6.952,44.638],[6.953,44.66],[6.965,44.678],[6.987,44.69],[7.012,44.689],[7.036,44.69],[7.061,44.68],[7.071,44.699],[7.054,44.715],[7.031,44.729],[7.022,44.748],[7.021,44.772],[7.002,44.791],[7.02,44.816],[7.008,44.833],[6.977,44.846],[6.956,44.854],[6.932,44.863],[6.913,44.845],[6.881,44.849],[6.842,44.86],[6.821,44.871],[6.802,44.88],[6.781,44.893],[6.763,44.902],[6.749,44.922],[6.753,44.943],[6.765,44.959],[6.751,44.978],[6.751,44.998],[6.74,45.017],[6.72,45.021],[6.694,45.02],[6.671,45.024],[6.665,45.048],[6.663,45.069],[6.646,45.082],[6.627,45.102],[6.642,45.116],[6.665,45.122],[6.68,45.14],[6.702,45.143],[6.728,45.139],[6.751,45.143],[6.768,45.16],[6.799,45.151],[6.823,45.144],[6.845,45.131],[6.87,45.134],[6.891,45.137],[6.888,45.16],[6.911,45.167],[6.932,45.171],[6.953,45.18],[6.967,45.195],[6.989,45.21],[7.017,45.215],[7.041,45.225],[7.061,45.216],[7.084,45.223],[7.103,45.236],[7.123,45.244],[7.133,45.264]];
const BORDER_RAW = BORDER_LL.map(([lo, la]) => toXZraw(lo, la));
const BORDER = BORDER_LL.map(([lo, la]) => toXZ(lo, la));
// border stretches that are mountains: Alps (west, north), Maritime Alps and Apennines (south)
const ALP_SEGS = [], APP_SEGS = [];
for (let i = 0; i < BORDER_LL.length; i++) {
  const [lo1, la1] = BORDER_LL[i], [lo2, la2] = BORDER_LL[(i + 1) % BORDER_LL.length];
  const seg = [BORDER_RAW[i], BORDER_RAW[(i + 1) % BORDER_RAW.length]];
  const alpine = (p, q) => (p < 7.95 && q > 44.25) || q > 45.7 || (q < 44.45 && p < 7.95);
  const apen = (p, q) => q < 44.62 && p >= 7.95;
  if (alpine(lo1, la1) && alpine(lo2, la2)) ALP_SEGS.push(seg); else if (apen(lo1, la1) && apen(lo2, la2)) APP_SEGS.push(seg);
}
function distSegs(x, z, segs) { let best = 1e9; for (const [[ax, az], [bx, bz]] of segs) { const dx = bx - ax, dz = bz - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - ax - t * dx, z - az - t * dz); if (d < best) best = d; } return best; }
function inside(x, z) { let c = false; for (let i = 0, j = BORDER_RAW.length - 1; i < BORDER_RAW.length; j = i++) { const [xi, zi] = BORDER_RAW[i], [xj, zj] = BORDER_RAW[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
const OUTSIDE_Y = -8;
const RIVER = new Set(); // vertex flags for coloring, filled while sampling

function height(x, z) { return heightRaw(x / MS, z / MS); }
function heightRaw(x, z) {
  if (!inside(x, z)) return OUTSIDE_Y;
  let h = 1.0 + fbm(x * 0.02, z * 0.02, 3) * 0.8;
  const dA = distSegs(x, z, ALP_SEGS), dP = distSegs(x, z, APP_SEGS);
  h += Math.pow(1 - smooth(0, 95, dA), 1.35) * (24 + 18 * ridge(x * 0.018, z * 0.018));
  h += Math.pow(1 - smooth(0, 50, dP), 1.4) * (8 + 7 * ridge(x * 0.03 + 7, z * 0.03));
  for (const H of HILLS) { const d = Math.hypot(x - H.x, z - H.z); const m = 1 - smooth(H.r * 0.4, H.r, d); h += m * H.h * (0.45 + fbm(x * 0.07, z * 0.07, 3)); }
  for (const V of VALLEYS) {
    const [d, t] = distToPolyline(x, z, V.pl);
    if (d < V.w) { const floor = V.f0 + (V.f1 - V.f0) * t + fbm(x * 0.05, z * 0.05, 2) * 0.6; const s = smooth(V.w * 0.35, V.w, d); h = Math.min(h, floor + (h - floor) * s); }
  }
  for (const K of PEAKS) { const d = Math.hypot(x - K.x, z - K.z); h += K.h * Math.exp(-(d * d) / (2 * K.r * K.r)); }
  const [dPo] = distToPolyline(x, z, PO);
  if (dPo < 4 && h < 4) h -= (1 - smooth(1.2, 4, dPo)) * 0.9;
  const lk = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  if (lk < 1.3) h = Math.min(h, -1.5 + 3 * smooth(0.7, 1.3, lk) + (h > 3 ? (h - 3) * smooth(1, 1.3, lk) : 0));
  return h > 1 ? 1 + (h - 1) * RELIEF : h;
}
const RELIEF = 0.55 * 2 / 3; // flatter relief reads better from the fixed top-down camera

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
    else tmp.copy(cHill).lerp(cRock, smooth(6, 10, y));
    if (slope > 0.8 && y > OUTSIDE_Y + 0.01) tmp.lerp(cRock, smooth(0.8, 1.4, slope));
    if (y > 12.5) tmp.lerp(cSnow, smooth(12.5, 15.5, y));
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
  // physics: one tall static box per border segment, so the car can never leave Piemonte
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
const START = (() => { const [x, z] = XZ('Torino'); return [x - 1, z + 12]; })();
const CAR_SCALE = 2;
const chassisBody = new CANNON.Body({ mass: 320, angularDamping: 0.5, linearDamping: 0.02 });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(2.0, 1.0, 3.6))); // only meets the border cliffs
chassisBody.position.set(START[0], groundAt(...START) + 4, START[1]);
chassisBody.quaternion.setFromEuler(0, Math.PI, 0); // face north, towards Torino
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

// ---------------------------------------------------------------- landmarks & labels
function label(text, x, z, lift = 10, scale = 1) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  let fs = 54; do { g.font = `bold ${fs}px JetBrains Mono, monospace`; fs -= 2; } while (g.measureText(text).width > 440 && fs > 20); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(text, 256, 64); g.fillStyle = '#fff'; g.fillText(text, 256, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  s.scale.set(13 * scale, 3.25 * scale, 1); s.position.set(x, groundAt(x, z) + lift, z); scene.add(s); return s;
}
{ // towns: little houses, no names (and no colliders)
  const TOWNS = { Torino: 34, Novara: 14, Alessandria: 14, Asti: 12, Cuneo: 12, Vercelli: 10, Biella: 10, Ivrea: 9, Alba: 9, Domodossola: 8, Susa: 7, Lanzo: 7, Ceres: 5, Balme: 5 };
  const SCATTER = 160, total = Object.values(TOWNS).reduce((a, b) => a + b, 0) + SCATTER;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2, 2.4), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), total);
  const roofGeo = new THREE.ConeGeometry(2.1, 1.5, 4); roofGeo.rotateY(Math.PI / 4);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), total);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), C = new THREE.Color();
  const wallCols = [0xf3e6c8, 0xf6d8a8, 0xeadfcf, 0xf0c9a0], roofCols = [0xb5523b, 0xa3442f, 0x8f3b2a, 0x6d6a66];
  let n = 0, seed = 1;
  for (const [name, count] of Object.entries(TOWNS)) {
    const [cx, cz] = XZ(name), r = 3 + Math.sqrt(count) * 1.9;
    for (let k = 0, tries = 0; k < count && tries < count * 8; tries++) {
      seed++; const a = hash(seed, 3) * Math.PI * 2, d = Math.sqrt(hash(seed, 5)) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = groundAt(x, z);
      if (y < WATER_Y + 0.3) continue;
      const sc = 0.8 + hash(seed, 9) * 0.5, h = 0.8 + hash(seed, 11) * (name === 'Torino' ? 1.2 : 0.5);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(seed, 13) * Math.PI);
      M.compose(V.set(x, y + h, z), Q, S.set(sc, h, sc)); walls.setMatrixAt(n, M); walls.setColorAt(n, C.set(wallCols[seed % 4]));
      M.compose(V.set(x, y + 2 * h + 0.75 * sc, z), Q, S.set(sc, sc, sc)); roofs.setMatrixAt(n, M); roofs.setColorAt(n, C.set(roofCols[seed % 4]));
      n++; k++;
    }
  }
  for (let k = 0, tries = 0; k < SCATTER && tries < SCATTER * 20; tries++) { // farmhouses here and there
    seed++; const x = (hash(seed, 21) - 0.5) * 215, z = (hash(seed, 23) - 0.5) * 270, y = groundAt(x, z);
    if (y < WATER_Y + 0.5 || y > 7 || distSegs(x, z, BORDER_SEGS) < 6) continue;
    const sc = 0.75 + hash(seed, 9) * 0.4, h = 0.7 + hash(seed, 11) * 0.4;
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(seed, 13) * Math.PI);
    M.compose(V.set(x, y + h, z), Q, S.set(sc, h, sc)); walls.setMatrixAt(n, M); walls.setColorAt(n, C.set(wallCols[seed % 4]));
    M.compose(V.set(x, y + 2 * h + 0.75 * sc, z), Q, S.set(sc, sc, sc)); roofs.setMatrixAt(n, M); roofs.setColorAt(n, C.set(roofCols[seed % 4]));
    n++; k++;
  }
  walls.count = roofs.count = n; walls.castShadow = roofs.castShadow = true; walls.receiveShadow = true; scene.add(walls, roofs);
}
for (const name of ['Monviso', 'Monte Rosa', 'Lago Maggiore']) { const [x, z] = XZ(name); label(name, x, z, 9, 1.1); }
{ const [x, z] = toXZ(7.2, 45.17); label('Val di Susa', x, z, 6, 0.8); }
{ const [x, z] = toXZ(7.38, 45.36); label('Valli di Lanzo', x, z, 6, 0.8); }
{ // Mole Antonelliana, very much not to scale (no collider, like trees and houses)
  const [x, z] = toXZ(7.693, 45.069), y = groundAt(x, z), m = new THREE.MeshLambertMaterial({ color: 0xd8cfc0, flatShading: true }), g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 3), m); base.position.y = 1.25; g.add(base);
  const dome = new THREE.Mesh(new THREE.ConeGeometry(2.1, 5, 4), m); dome.position.y = 5; dome.rotation.y = Math.PI / 4; g.add(dome);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 8, 6), m); spire.position.y = 11; g.add(spire);
  g.position.set(x, y, z); g.traverse(o => { o.castShadow = true; }); scene.add(g);
}
{ // a few trees and vineyards-ish dots
  const tg = new THREE.ConeGeometry(0.9, 2.6, 6), tm = new THREE.MeshLambertMaterial({ color: 0x2f6b2f, flatShading: true });
  const trees = new THREE.InstancedMesh(tg, tm, 1900); let n = 0; const M = new THREE.Matrix4();
  for (let t = 0; t < 6000 && n < 1400; t++) {
    const x = (hash(t, 7) - 0.5) * (SIZE - 20), z = (hash(t, 13) - 0.5) * (SIZE - 20), y = groundAt(x, z);
    if (y < 2 || y > 10 || fbm(x * 0.04, z * 0.04, 2) < 0.52) continue;
    const s = 0.7 + hash(t, 3) * 0.8; M.makeScale(s, s, s).setPosition(x, y + 1.2 * s, z); trees.setMatrixAt(n++, M);
  }
  for (let t = 0, k = 0; t < 4000 && k < 450; t++) { // lone trees scattered everywhere
    const x = (hash(t, 31) - 0.5) * 215, z = (hash(t, 37) - 0.5) * 270, y = groundAt(x, z);
    if (y < WATER_Y + 0.6 || y > 11) continue;
    const s = 0.6 + hash(t, 41) * 0.9; M.makeScale(s, s, s).setPosition(x, y + 1.2 * s, z); trees.setMatrixAt(n++, M); k++;
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
  const x0 = -108, x1 = 108, z0 = -138, z1 = 138;
  for (let py = 0; py < 190; py++) for (let px = 0; px < 150; px++) {
    const x = x0 + (x1 - x0) * px / 149, z = z0 + (z1 - z0) * py / 189, y = groundAt(x, z), o = (px + py * 150) * 4;
    if (y <= OUTSIDE_Y + 0.01) continue;
    const [r, gg, b] = y < WATER_Y ? [59, 127, 196] : y < 2.2 ? [150, 190, 95] : y < 6 ? [95, 145, 60] : y < 12.5 ? [140, 130, 120] : [240, 240, 240];
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
  if (cp.y < OUTSIDE_Y + 1) { chassisBody.position.set(lastSafe.x, groundAt(lastSafe.x, lastSafe.z) + RIDE + 1, lastSafe.z); chassisBody.velocity.setZero(); chassisBody.angularVelocity.setZero(); crashed = false; toast("That's the end of Piemonte. Back you go!"); }
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
    if (dogJumpT >= 1) { dogState = 'aboard'; car.userData.seat.add(dog); dog.position.set(0, 0, 0); dog.rotation.set(0, 0, 0); dog.scale.setScalar(0.55); }
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
const begin = () => { if (started) return; started = true; startEl.style.display = 'none'; canvas.focus(); toast('Start: the first piece is at the Politecnico, right ahead'); };
startEl.addEventListener('click', begin);
window.addEventListener('keydown', begin, { once: true });
frame();

// for automated checks
window.__coolcv = { setView(v) { VIEW = v; resize(); }, world, jump, chassisBody, pickups, groundAt, collect, keys, get dogState() { return dogState; }, get carpetOn() { return carpetOn; } };
