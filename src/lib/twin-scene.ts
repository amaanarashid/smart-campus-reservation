import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { resolveScene, type Scene } from "./scene";

/**
 * 3D digital twin of one facility, in plain three.js (no React), so it can be
 * driven by the admin page and also rendered on its own for testing.
 *
 *   const twin = createTwin(div, { type: "discussion_room", capacity: 6 });
 *   twin.update({ lights: true, people: true });   // from the room's events
 *   twin.dispose();
 *
 * The scene is built once per facility type. update() only sets targets; the
 * render loop eases every value towards its target, so a light switching on
 * in Wokwi fades up here instead of popping.
 *
 * WebGL needs literal colours, so the palette below is the one place in the
 * app with hard-coded colours. They mirror the theme tokens in globals.css.
 */

export type TwinStatus = "free" | "booked" | "in_use" | "offline" | "inactive";
export interface TwinState {
  lights: boolean;
  ac: boolean;
  people: boolean;
  doorOpen: boolean;
  unlocked: boolean;
  status: TwinStatus;
}
export interface Twin {
  /** Set what the room is doing. `instant` skips the easing (first load). */
  update(s: Partial<TwinState>, instant?: boolean): void;
  resetView(): void;
  dispose(): void;
}

export const DEFAULT_TWIN_STATE: TwinState = {
  lights: false, ac: false, people: false, doorOpen: false, unlocked: false, status: "free",
};

const PAL = {
  crimson: 0xa8232f,
  wall: 0xf4f0ea, wallTop: 0xe4ddd2, skirting: 0xd9d1c4,
  wood: 0xd8bf98, woodDark: 0x8c6a48,
  chair: 0x3d4757, metal: 0x9aa3ad, white: 0xffffff, ink: 0x1f2633,
  courtGreen: 0x2f7a59, courtWood: 0xcf9356, line: 0xf7f7f2,
  water: 0x3a9fd6, tile: 0xe9eef2,
  skin: [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524],
  shirts: [0xa8232f, 0x2f4b7c, 0x2f7a59, 0xd08c2b, 0x5b4b8a, 0x3a8fa3],
  status: { free: 0x16a34a, booked: 0xd99a1e, in_use: 0xa8232f, offline: 0x7b8494, inactive: 0x7b8494 } as Record<TwinStatus, number>,
  airflow: 0x6cc4ff, warm: 0xfff1d6,
};

interface Dims { W: number; D: number; H: number }
const DIMS: Record<Scene, Dims> = {
  room: { W: 8, D: 6, H: 3 },
  generic: { W: 8, D: 6, H: 3 },
  gym: { W: 10, D: 7, H: 3.4 },
  net_court: { W: 13, D: 8, H: 4.5 },
  court: { W: 14, D: 9, H: 4.5 },
  hall: { W: 12, D: 9, H: 4 },
  pool: { W: 13, D: 8, H: 4 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createTwin(container: HTMLElement, opts: { type: string; capacity?: number }): Twin {
  const scene = resolveScene(opts.type);
  const { W, D, H } = DIMS[scene];
  const capacity = Math.max(1, opts.capacity ?? 6);
  const reduceMotion = typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const home = new THREE.Vector3(W * 0.62, Math.max(W, D) * 0.8, D * 1.75);
  camera.position.copy(home);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-W * 0.06, H * 0.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = Math.max(W, D) * 0.6;
  controls.maxDistance = Math.max(W, D) * 2.4;
  controls.maxPolarAngle = Math.PI * 0.46;          // never below the floor
  controls.enablePan = false;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.5;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  // ------------------------------------------------------------------ helpers
  const owned: { dispose(): void }[] = [];
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...extra });
    owned.push(m);
    return m;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = world) => {
    const g = new THREE.BoxGeometry(w, h, d); owned.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = world) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, 20); owned.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const sphere = (r: number, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = world) => {
    const g = new THREE.SphereGeometry(r, 20, 14); owned.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---------------------------------------------------------------- lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0xcfc6b8, 0.9);
  world.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(W * 0.6, H * 3.2, D * 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = Math.max(W, D) * 0.75;
  Object.assign(sun.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc, near: 0.5, far: 60 });
  sun.shadow.bias = -0.0005;
  world.add(sun);

  // ------------------------------------------------------------ floor + base
  const statusMat = mat(PAL.status.free, { emissive: PAL.status.free, emissiveIntensity: 0.55, roughness: 0.4 });
  box(W + 0.6, 0.08, D + 0.6, statusMat, 0, -0.16, 0).castShadow = false;
  const floorColor = scene === "net_court" ? PAL.courtGreen : scene === "court" ? PAL.courtWood
    : scene === "pool" ? PAL.tile : PAL.wood;
  box(W, 0.14, D, mat(floorColor, { roughness: 0.6 }), 0, -0.07, 0);

  // ------------------------------------------------- walls (dollhouse: 2 sides)
  const wallMat = mat(PAL.wall, { roughness: 0.9 });
  const capMat = mat(PAL.wallTop);
  const t = 0.16;
  box(W, H, t, wallMat, 0, H / 2, -D / 2 - t / 2);                 // back
  box(W + t, 0.06, t + 0.02, capMat, -t / 2, H + 0.03, -D / 2 - t / 2);
  box(W, 0.12, 0.03, mat(PAL.skirting), 0, 0.06, -D / 2 + 0.01);

  // left wall with a door opening near the front
  const doorW = 1.0, doorH = 2.1, doorZ = D / 2 - 1.3;             // centre of the opening
  const xL = -W / 2 - t / 2;
  const backLen = doorZ - doorW / 2 + D / 2;                      // from back wall to door
  box(t, H, backLen, wallMat, xL, H / 2, -D / 2 + backLen / 2);
  const frontLen = D / 2 - (doorZ + doorW / 2);
  box(t, H, frontLen, wallMat, xL, H / 2, D / 2 - frontLen / 2);
  box(t, H - doorH, doorW, wallMat, xL, doorH + (H - doorH) / 2, doorZ);   // lintel
  box(t + 0.02, 0.06, D + t, capMat, xL, H + 0.03, -t / 2);

  // door on a hinge (pivot at the back edge of the opening)
  const hinge = new THREE.Group();
  hinge.position.set(xL, 0, doorZ - doorW / 2);
  world.add(hinge);
  const doorMat = mat(PAL.woodDark, { roughness: 0.55 });
  box(0.06, doorH - 0.02, doorW - 0.04, doorMat, 0, doorH / 2, doorW / 2, hinge);
  sphere(0.04, mat(PAL.metal, { metalness: 0.8, roughness: 0.3 }), 0.07, 1.0, doorW - 0.15, hinge);

  // the Wokwi door unit: keypad + OLED outside, status LED inside
  const keypad = new THREE.Group();
  keypad.position.set(xL - t / 2 - 0.03, 1.25, doorZ + doorW / 2 + 0.32);
  world.add(keypad);
  box(0.05, 0.36, 0.24, mat(PAL.ink, { roughness: 0.4 }), 0, 0, 0, keypad);
  const oledMat = mat(0x0b1020, { emissive: 0x7fd3ff, emissiveIntensity: 0.6 });
  box(0.012, 0.08, 0.18, oledMat, -0.03, 0.11, 0, keypad);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++)
    box(0.012, 0.035, 0.045, mat(0xd7dce2), -0.03, 0.03 - r * 0.055, -0.06 + c * 0.06, keypad);
  const ledMat = mat(0x330000, { emissive: 0xff2a2a, emissiveIntensity: 1.2 });
  sphere(0.035, ledMat, xL + t / 2 + 0.03, 1.25, doorZ + doorW / 2 + 0.32);

  // ------------------------------------------------------------- ceiling lights
  const panels: THREE.MeshStandardMaterial[] = [];
  const bulbs: THREE.PointLight[] = [];
  const panelSpots: [number, number][] =
    scene === "room" || scene === "generic" ? [[-W * 0.2, 0], [W * 0.2, 0]]
    : [[-W * 0.28, -D * 0.2], [W * 0.28, -D * 0.2], [-W * 0.28, D * 0.2], [W * 0.28, D * 0.2]];
  for (const [x, z] of panelSpots) {
    const pm = mat(PAL.white, { emissive: PAL.warm, emissiveIntensity: 0, roughness: 0.3 });
    panels.push(pm);
    const p = box(scene === "room" || scene === "generic" ? 1.3 : 1.6, 0.06, 0.55, pm, x, H - 0.1, z);
    p.castShadow = false;
    cyl(0.008, 0.008, 0.12, mat(PAL.metal), x - 0.5, H - 0.02, z);
    cyl(0.008, 0.008, 0.12, mat(PAL.metal), x + 0.5, H - 0.02, z);
    const bulb = new THREE.PointLight(PAL.warm, 0, Math.max(W, D) * 1.1, 1.2);
    bulb.position.set(x, H - 0.35, z);
    world.add(bulb);
    bulbs.push(bulb);
  }

  // ------------------------------------------------------------------ air-con
  const acX = W / 2 - 1.3, acY = H - 0.5, acZ = -D / 2 + 0.2;
  box(1.5, 0.42, 0.3, mat(PAL.white, { roughness: 0.35 }), acX, acY, acZ);
  const flap = new THREE.Group();
  flap.position.set(acX, acY - 0.2, acZ + 0.15);
  world.add(flap);
  box(1.4, 0.03, 0.12, mat(0xe6e9ed), 0, 0, 0.05, flap);
  const acLedMat = mat(0x0a1a2a, { emissive: 0x38bdf8, emissiveIntensity: 0 });
  sphere(0.025, acLedMat, acX + 0.62, acY + 0.08, acZ + 0.16);

  const N = 180;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const spawn = (i: number, fresh = false) => {
    pos[i * 3] = acX + (Math.random() - 0.5) * 1.3;
    pos[i * 3 + 1] = acY - 0.25 - (fresh ? Math.random() * 1.6 : 0);
    pos[i * 3 + 2] = acZ + 0.25 + (fresh ? Math.random() * 1.8 : 0);
    vel[i * 3] = (Math.random() - 0.5) * 0.15;
    vel[i * 3 + 1] = -(0.35 + Math.random() * 0.4);
    vel[i * 3 + 2] = 0.55 + Math.random() * 0.5;
  };
  for (let i = 0; i < N; i++) spawn(i, true);
  const airGeo = new THREE.BufferGeometry(); owned.push(airGeo);
  airGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const airMat = new THREE.PointsMaterial({ color: PAL.airflow, size: 0.1, transparent: true, opacity: 0, depthWrite: false });
  owned.push(airMat);
  world.add(new THREE.Points(airGeo, airMat));

  // ------------------------------------------------------- furniture per scene
  const seats: { x: number; z: number; rot: number; seated: boolean }[] = [];
  const chairMat = mat(PAL.chair, { roughness: 0.6 });
  const chair = (x: number, z: number, rot: number) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; world.add(g);
    box(0.46, 0.06, 0.46, chairMat, 0, 0.46, 0, g);
    box(0.46, 0.5, 0.06, chairMat, 0, 0.74, -0.2, g);
    for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]])
      cyl(0.02, 0.02, 0.44, mat(PAL.metal), lx, 0.22, lz, g);
    seats.push({ x, z, rot, seated: true });
  };
  const lineMat = mat(PAL.line, { roughness: 0.5 });
  const line = (w: number, d: number, x: number, z: number) => { box(w, 0.012, d, lineMat, x, 0.006, z).castShadow = false; };

  if (scene === "room" || scene === "generic") {
    const tw = Math.min(3.6, 1.4 + capacity * 0.3), td = 1.3;
    box(tw, 0.08, td, mat(PAL.wood, { roughness: 0.45 }), 0, 0.76, 0.2);
    for (const [lx, lz] of [[-tw / 2 + 0.1, -td / 2 + 0.1], [tw / 2 - 0.1, -td / 2 + 0.1], [-tw / 2 + 0.1, td / 2 - 0.1], [tw / 2 - 0.1, td / 2 - 0.1]])
      cyl(0.035, 0.035, 0.72, mat(PAL.metal), lx, 0.36, 0.2 + lz);
    const n = Math.min(Math.max(capacity, 2), 8), perSide = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const side = i < perSide ? -1 : 1, k = side < 0 ? i : i - perSide;
      const cnt = side < 0 ? perSide : n - perSide;
      const x = -tw / 2 + (tw / (cnt + 1)) * (k + 1);
      chair(x, 0.2 + side * (td / 2 + 0.45), side < 0 ? 0 : Math.PI);
    }
    // laptops on the table
    box(0.34, 0.02, 0.24, mat(0x4b5563), -0.6, 0.81, 0.05);
    box(0.34, 0.22, 0.02, mat(0x4b5563, { emissive: 0x93c5fd, emissiveIntensity: 0.25 }), -0.6, 0.92, -0.07);
    box(0.34, 0.02, 0.24, mat(0x4b5563), 0.7, 0.81, 0.4);
    // whiteboard on the back wall
    box(2.6, 1.2, 0.04, mat(PAL.white, { roughness: 0.2 }), -1.2, 1.65, -D / 2 + 0.03);
    box(2.7, 0.06, 0.08, mat(PAL.metal), -1.2, 1.02, -D / 2 + 0.06);
    // a plant in the corner
    cyl(0.18, 0.14, 0.4, mat(0xb08968), W / 2 - 0.5, 0.2, D / 2 - 0.5);
    sphere(0.32, mat(0x3f7f4a), W / 2 - 0.5, 0.65, D / 2 - 0.5);
  } else if (scene === "net_court") {
    const cl = W - 2, cw = D - 2.4;
    line(cl, 0.05, 0, -cw / 2); line(cl, 0.05, 0, cw / 2);
    line(0.05, cw, -cl / 2, 0); line(0.05, cw, cl / 2, 0);
    line(0.05, cw, -1.98, 0); line(0.05, cw, 1.98, 0);
    line(cl, 0.04, 0, 0);
    cyl(0.04, 0.04, 1.55, mat(PAL.metal), 0, 0.78, -cw / 2 - 0.2);
    cyl(0.04, 0.04, 1.55, mat(PAL.metal), 0, 0.78, cw / 2 + 0.2);
    const net = box(0.02, 0.7, cw + 0.4, mat(PAL.white, { transparent: true, opacity: 0.45 }), 0, 1.2, 0);
    net.castShadow = false;
    box(0.03, 0.05, cw + 0.4, mat(PAL.white), 0, 1.55, 0);
    for (const [x, z] of [[-3.2, -1], [-3.2, 1.2], [3.2, -1.1], [3.2, 1]]) seats.push({ x, z, rot: x < 0 ? Math.PI / 2 : -Math.PI / 2, seated: false });
  } else if (scene === "court") {
    const cl = W - 1.6, cw = D - 1.6;
    line(cl, 0.06, 0, -cw / 2); line(cl, 0.06, 0, cw / 2);
    line(0.06, cw, -cl / 2, 0); line(0.06, cw, cl / 2, 0); line(0.06, cw, 0, 0);
    const ring = new THREE.RingGeometry(1.1, 1.17, 48); owned.push(ring);
    const rm = new THREE.Mesh(ring, lineMat); rm.rotation.x = -Math.PI / 2; rm.position.y = 0.008; world.add(rm);
    for (const s of [-1, 1]) {
      const gx = s * (cl / 2);
      cyl(0.04, 0.04, 1.4, mat(PAL.white), gx, 0.7, -1);
      cyl(0.04, 0.04, 1.4, mat(PAL.white), gx, 0.7, 1);
      box(0.06, 0.06, 2.06, mat(PAL.white), gx, 1.4, 0);
      box(0.6, 1.4, 2, mat(PAL.white, { transparent: true, opacity: 0.18 }), gx + s * 0.3, 0.7, 0).castShadow = false;
    }
    for (const [x, z] of [[-3, -1.5], [-2, 1.6], [2.5, -1], [3.4, 1.8]]) seats.push({ x, z, rot: x < 0 ? Math.PI / 2 : -Math.PI / 2, seated: false });
  } else if (scene === "hall") {
    box(W * 0.6, 0.5, 2.2, mat(PAL.woodDark, { roughness: 0.5 }), 0, 0.25, -D / 2 + 1.1);
    box(0.6, 1.1, 0.45, mat(PAL.chair), 1.6, 1.05, -D / 2 + 1.2);
    box(W * 0.5, 1.6, 0.04, mat(0x111827, { emissive: 0x1e3a8a, emissiveIntensity: 0.15 }), 0, 2.2, -D / 2 + 0.03);
    const rows = 4, cols = Math.min(8, Math.max(4, Math.round(capacity / 8)));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      chair(-((cols - 1) * 0.75) / 2 + c * 0.75, -0.6 + r * 1.0, Math.PI);
  } else if (scene === "pool") {
    const water = box(W - 2.4, 0.06, D - 2.4, mat(PAL.water, { transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.1 }), 0, 0.04, 0);
    water.castShadow = false;
    for (let i = 1; i < 5; i++) line(W - 2.6, 0.04, 0, -(D - 2.4) / 2 + ((D - 2.4) / 5) * i);
    for (const [x, z] of [[-3, -1.6], [-1, 0], [1.5, 1.6], [4.5, -2.8]]) seats.push({ x, z, rot: 0, seated: false });
  } else {
    // gym: benches, mats and a rack
    for (let i = 0; i < 3; i++) {
      box(1.3, 0.1, 0.35, chairMat, -2.5 + i * 2.5, 0.45, -0.5);
      cyl(0.04, 0.04, 0.4, mat(PAL.metal), -2.5 + i * 2.5, 0.22, -0.5);
    }
    box(2.4, 0.04, 1.2, mat(0x2f4b7c), 1.5, 0.02, 1.8).castShadow = false;
    box(0.1, 1.6, 2.2, mat(PAL.metal, { metalness: 0.6 }), W / 2 - 0.6, 0.8, -0.5);
    for (const [x, z] of [[-2.5, 0.1], [0, 0.2], [1.5, 1.8]]) seats.push({ x, z, rot: Math.PI, seated: false });
  }

  // ------------------------------------------------------------------- people
  const people: THREE.Group[] = [];
  const nPeople = Math.min(seats.length, scene === "room" || scene === "generic" ? Math.min(capacity, 4) : 4);
  for (let i = 0; i < nPeople; i++) {
    const s = seats[i];
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.rot;
    const shirt = mat(PAL.shirts[i % PAL.shirts.length], { roughness: 0.8 });
    const skin = mat(PAL.skin[i % PAL.skin.length], { roughness: 0.7 });
    if (s.seated) {
      cyl(0.17, 0.2, 0.55, shirt, 0, 0.78, -0.05, g);
      sphere(0.14, skin, 0, 1.2, -0.05, g);
      box(0.32, 0.12, 0.38, mat(PAL.ink), 0, 0.55, 0.12, g);
    } else {
      cyl(0.1, 0.12, 0.8, mat(PAL.ink), 0, 0.4, 0, g);
      cyl(0.18, 0.2, 0.6, shirt, 0, 1.1, 0, g);
      sphere(0.15, skin, 0, 1.56, 0, g);
    }
    g.scale.setScalar(0.001);
    g.visible = false;
    world.add(g);
    people.push(g);
  }

  // ------------------------------------------------------------- live state
  let target: TwinState = { ...DEFAULT_TWIN_STATE };
  const cur = { light: 0, ac: 0, door: 0, people: people.map(() => 0) };
  const statusColor = new THREE.Color(PAL.status.free);
  const statusTarget = new THREE.Color(PAL.status.free);
  const ledOn = new THREE.Color(0x22ff66), ledOff = new THREE.Color(0xff2a2a);

  // ------------------------------------------------------------------ resize
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // -------------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let raf = 0;
  let snap = false;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    frame();
  };
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    // frame-rate independent easing; k = 1 jumps straight to the target
    const k = snap ? 1 : 1 - Math.pow(0.0015, dt);
    snap = false;

    cur.light = lerp(cur.light, target.lights ? 1 : 0, k);
    cur.ac = lerp(cur.ac, target.ac ? 1 : 0, k);
    cur.door = lerp(cur.door, target.doorOpen ? 1 : 0, k * 0.8);

    // room lighting: dim daylight when off, warm and bright when on
    hemi.intensity = 0.55 + 0.55 * cur.light;
    sun.intensity = 0.45 + 0.4 * cur.light;
    panels.forEach((m) => { m.emissiveIntensity = 2.2 * cur.light; });
    bulbs.forEach((b) => { b.intensity = 7 * cur.light; });

    // air-con: flap opens, LED lights, airflow drifts out
    flap.rotation.x = 0.9 * cur.ac;
    acLedMat.emissiveIntensity = 2 * cur.ac;
    airMat.opacity = 0.9 * cur.ac;
    if (cur.ac > 0.02) {
      const sp = reduceMotion ? 0.3 : 1;
      for (let i = 0; i < N; i++) {
        pos[i * 3] += vel[i * 3] * dt * sp;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt * sp;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt * sp;
        if (pos[i * 3 + 1] < 0.3 || pos[i * 3 + 2] > D / 2) spawn(i);
      }
      airGeo.attributes.position.needsUpdate = true;
    }

    // door swings inwards
    hinge.rotation.y = -1.35 * cur.door;
    ledMat.emissive.copy(target.unlocked ? ledOn : ledOff);

    // people fade in one after another, and fidget a little
    people.forEach((g, i) => {
      const want = target.people ? 1 : 0;
      const delay = target.people ? i * 0.12 : 0;
      cur.people[i] = lerp(cur.people[i], want, k === 1 ? 1 : Math.max(0, k - delay * k));
      const s = Math.max(0.001, cur.people[i]);
      g.scale.setScalar(s);
      g.visible = s > 0.01;
      if (g.visible && !reduceMotion) g.position.y = Math.sin(time * 2 + i * 1.7) * 0.012;
    });

    // status glow under the room; "booked" pulses (waiting for check-in)
    statusTarget.setHex(PAL.status[target.status]);
    statusColor.lerp(statusTarget, k);
    statusMat.color.copy(statusColor);
    statusMat.emissive.copy(statusColor);
    statusMat.emissiveIntensity = target.status === "booked" && !reduceMotion
      ? 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(time * 3)) : 0.55;
    oledMat.emissiveIntensity = target.status === "offline" ? 0.05 : 0.6;

    controls.update();
    renderer.render(world, camera);
  };
  tick();

  return {
    update(s, instant = false) {
      target = { ...target, ...s };
      if (instant) { snap = true; frame(); }
    },
    resetView() {
      camera.position.copy(home);
      controls.target.set(-W * 0.06, H * 0.2, 0);
      controls.autoRotate = !reduceMotion;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      owned.forEach((o) => o.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
