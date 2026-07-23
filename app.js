// ============================================================
//  Village Atlas — 3D engine
//  Flow: cloud deck (landing) → select village → clouds part →
//  top-down view. One continuous zoom axis: fully out is a flat
//  top-down map; zooming in lowers the camera and adds tilt.
//  Pan is bounded to the map; right-drag turns around it.
//  Pins and placed models come from config.js.
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { config } from './config.js';

// ------------------------------------------------------------
// Basic state
// ------------------------------------------------------------

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEV = new URLSearchParams(location.search).has('dev');

let lang = 'en';
try { lang = localStorage.getItem('atlas-lang') || 'en'; } catch { /* private mode */ }

const village = config.villages.find(v => v.status === 'live');
const VIEW = village.view;
const CENTER = new THREE.Vector3(VIEW.center.x, VIEW.center.y, VIEW.center.z);

// landing → pending → revealing → free → returning
let state = 'landing';
let terrainLoaded = false;
let loadProgress = 0;

// ------------------------------------------------------------
// The zoom axis: one number drives the whole camera feel.
//   zoomT = 0 → top-down, whole village fills the window
//   zoomT = 1 → low, close, tilted bird's-eye view
// The wheel/pinch set zoomGoal; each frame zoomT eases toward it.
// ------------------------------------------------------------

let zoomT = 0;
let zoomGoal = 0;
let glideActive = false;         // true while a scripted camera move runs

const POLAR_TOP = 0.035;         // ~straight down (0 exactly degenerates)
const POLAR_LOW = 0.95;          // ~54° tilt when fully zoomed in
const MIN_DIST = VIEW.closestZoom ?? 480;  // closest distance at zoomT = 1

const CLOUD_ALT = VIEW.topAltitude;    // landing view, above the cloud deck
let FIT_ALT = VIEW.topAltitude * 0.64; // zoomT=0 distance; computed for real
                                       // after load from bounds + window aspect

function zoomEase(k) { return easeInOut(k); }
function distFor(t) { return FIT_ALT + (MIN_DIST - FIT_ALT) * zoomEase(t); }
function polarFor(t) { return POLAR_TOP + (POLAR_LOW - POLAR_TOP) * zoomEase(t); }

// invert distFor (monotonic) — used when a scripted move changes distance
function tFromDist(d) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (distFor(mid) > d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------
// Renderer / scene / camera
// ------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd9eaf7, 2600, 9000);

// Lights are only for placed 3D models (config.models) — the terrain is
// unlit satellite imagery and ignores them.
scene.add(new THREE.HemisphereLight(0xcfe4f7, 0xb09a78, 1.1));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(-0.6, 1, 0.4);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 2, 30000);

// Landing: parked high above the cloud deck, looking straight down
function placeLanding() {
  const s = new THREE.Spherical(CLOUD_ALT, POLAR_TOP, 0);
  camera.position.setFromSpherical(s).add(CENTER);
  camera.lookAt(CENTER);
}
placeLanding();

// Apply the zoom axis: orbit the current pan target, preserving the
// user's heading (theta); distance and tilt come from zoomT.
function placeCameraZoom() {
  const offset = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  const polar = polarFor(zoomT);
  sph.radius = distFor(zoomT);
  sph.phi = polar;
  camera.position.setFromSpherical(sph).add(controls.target);
  camera.lookAt(controls.target);
  // tilt belongs to the zoom axis: pin it so drag-rotate is heading-only
  controls.minPolarAngle = polar;
  controls.maxPolarAngle = polar;
}

// Choose the zoomT=0 distance so the terrain just overfills the window
// (no sky around its edges) for the current aspect ratio.
const terrainBox = new THREE.Box3();
function computeFit() {
  if (!terrainLoaded) return;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dV = (terrainBox.max.z - terrainBox.min.z) / 2 / tan;
  const dH = (terrainBox.max.x - terrainBox.min.x) / 2 / (tan * camera.aspect);
  FIT_ALT = Math.max(MIN_DIST + 350, Math.min(dV, dH) * 0.80); // generous overfill
}

// ------------------------------------------------------------
// Clouds — photo billboards from config.cloudImages, with a
// procedural fallback if none load
// ------------------------------------------------------------

function makeCloudTexture(seed) {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const x = size * (0.5 + (rnd() - 0.5) * 0.6);
    const y = size * (0.5 + (rnd() - 0.5) * 0.42);
    const r = size * (0.09 + rnd() * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const clouds = [];
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);

function loadCloudTextures() {
  const loader = new THREE.TextureLoader();
  const urls = config.cloudImages || [];
  return Promise.all(urls.map((u) => new Promise((res) => {
    loader.load(u, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null));
  }))).then((list) => {
    const ok = list.filter(Boolean);
    const mirrored = ok.map((t) => {
      const f = t.clone();
      f.wrapS = THREE.RepeatWrapping;
      f.repeat.x = -1;
      f.offset.x = 1;
      f.needsUpdate = true;
      return f;
    });
    return [...ok, ...mirrored];
  });
}

function spawnClouds(textures, photo) {
  const defs = photo
    ? [
        { count: 44, yMin: 1350, yMax: 1950, sMin: 1000, sMax: 2300, oMin: .78, oMax: 1 },
        { count: 14, yMin: 2000, yMax: 2200, sMin: 2000, sMax: 3400, oMin: .3, oMax: .5 },
      ]
    : [
        { count: 46, yMin: 1350, yMax: 1950, sMin: 900, sMax: 2100, oMin: .55, oMax: .95 },
        { count: 14, yMin: 2000, yMax: 2200, sMin: 1800, sMax: 3200, oMin: .2, oMax: .4 },
      ];
  for (const d of defs) {
    for (let i = 0; i < d.count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: textures[Math.floor(Math.random() * textures.length)],
        transparent: true,
        depthWrite: false,
        opacity: d.oMin + Math.random() * (d.oMax - d.oMin),
      });
      const sp = new THREE.Sprite(mat);
      const s = d.sMin + Math.random() * (d.sMax - d.sMin);
      sp.scale.set(s, photo ? s * (0.88 + Math.random() * 0.2) : s * 0.55, 1);
      sp.position.set(
        CENTER.x + (Math.random() - 0.5) * 6800,
        d.yMin + Math.random() * (d.yMax - d.yMin),
        CENTER.z + (Math.random() - 0.5) * 5200,
      );
      sp.userData = {
        home: sp.position.clone(),
        homeOpacity: mat.opacity,
        drift: 5 + Math.random() * 9,
      };
      cloudGroup.add(sp);
      clouds.push(sp);
    }
  }
}

// A handful of low, wispy clouds that stay over the map after the reveal
// and keep drifting. They fade as the camera sinks to their altitude.
const ambient = [];
const ambientGroup = new THREE.Group();
scene.add(ambientGroup);

function spawnAmbient(textures) {
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.SpriteMaterial({
      map: textures[Math.floor(Math.random() * textures.length)],
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const sp = new THREE.Sprite(mat);
    const s = 450 + Math.random() * 700;
    sp.scale.set(s, s * 0.95, 1);
    sp.position.set(
      CENTER.x + (Math.random() - 0.5) * 3800,
      550 + Math.random() * 250,
      CENTER.z + (Math.random() - 0.5) * 2600,
    );
    sp.userData = { baseOpacity: 0.35 + Math.random() * 0.3, drift: 7 + Math.random() * 9 };
    ambientGroup.add(sp);
    ambient.push(sp);
  }
}

function updateAmbient(dt) {
  for (const sp of ambient) {
    if (!REDUCED) {
      sp.position.x += sp.userData.drift * dt;
      if (sp.position.x > CENTER.x + 2400) sp.position.x = CENTER.x - 2400;
    }
    const k = Math.min(1, Math.max(0, (camera.position.y - sp.position.y - 50) / 200));
    sp.material.opacity = sp.userData.baseOpacity * k;
  }
}

loadCloudTextures().then((list) => {
  const tex = list.length ? list : [makeCloudTexture(11), makeCloudTexture(97), makeCloudTexture(1337)];
  spawnClouds(tex, list.length > 0);
  spawnAmbient(tex);
});

// Haze sheet under the clouds so the terrain stays a mystery until revealed
const haze = new THREE.Mesh(
  new THREE.PlaneGeometry(14000, 11000),
  new THREE.MeshBasicMaterial({
    color: 0xe8f1f9, transparent: true, opacity: 0.88, depthWrite: false, fog: false,
  }),
);
haze.rotation.x = -Math.PI / 2;
haze.position.set(CENTER.x, 1150, CENTER.z);
scene.add(haze);

// ------------------------------------------------------------
// Tiny tween system
// ------------------------------------------------------------

const tweens = [];
function tween({ delay = 0, dur = 1, ease = easeOutCubic, update = () => {}, done = () => {} }) {
  tweens.push({ t: 0, delay, dur, ease, update, done });
}
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, Math.max(0, (tw.t - tw.delay) / tw.dur));
    if (tw.t >= tw.delay) tw.update(tw.ease(k));
    if (k >= 1) { tweens.splice(i, 1); tw.done(); }
  }
}
function easeOutCubic(k) { return 1 - Math.pow(1 - k, 3); }
function easeInOut(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

// ------------------------------------------------------------
// Terrain
// ------------------------------------------------------------

const gltfLoader = new GLTFLoader();
const terrainMeshes = [];
let terrainRoot = null;

function loadTerrain() {
  gltfLoader.load(
    village.terrain,
    (gltf) => {
      terrainRoot = gltf.scene;
      const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      terrainRoot.traverse((node) => {
        if (node.isMesh) {
          // Satellite imagery has the sun baked in — render it unlit
          // so colors stay true and no lights are needed.
          const map = node.material.map || null;
          if (map) map.anisotropy = maxAniso;
          const unlit = new THREE.MeshBasicMaterial({ map });
          node.material.dispose();
          node.material = unlit;
          terrainMeshes.push(node);
        }
      });
      scene.add(terrainRoot);
      terrainLoaded = true;
      terrainBox.setFromObject(terrainRoot);
      computeFit();
      snapPins();
      loadModels();
      updateVillageRows();
      if (state === 'pending') beginReveal();
    },
    (e) => {
      if (e.total) {
        loadProgress = Math.round((e.loaded / e.total) * 100);
        updateVillageRows();
      }
    },
    (err) => {
      console.error('Terrain failed to load:', err);
      showFileWarning();
    },
  );
}

// Placed 3D models from config; clicking one opens the detail panel.
const modelMeshes = [];
function loadModels() {
  for (const m of village.models || []) {
    gltfLoader.load(m.url, (gltf) => {
      const obj = gltf.scene;
      obj.scale.setScalar(m.scale ?? 1);
      obj.rotation.y = m.rotationY ?? 0;
      const y = groundHeight(m.x, m.z) + (m.yOffset ?? 0);
      obj.position.set(m.x, y, m.z);
      scene.add(obj);
      const box = new THREE.Box3().setFromObject(obj);
      const focus = box.getCenter(new THREE.Vector3());
      obj.traverse((n) => {
        if (n.isMesh) {
          n.userData.detail = m;
          n.userData.focus = focus;
          modelMeshes.push(n);
        }
      });
      // floating name tag above the model, same style as landmark pins
      if (m.title) {
        modelTagDefs.push({
          data: m,
          world: new THREE.Vector3(focus.x, box.max.y + 18, focus.z),
          focus,
        });
        buildPins();
      }
    }, undefined, (err) => console.warn(`Model "${m.url}" failed to load`, err));
  }
}

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function groundHeight(x, z) {
  raycaster.set(new THREE.Vector3(x, 4000, z), DOWN);
  const hit = raycaster.intersectObjects(terrainMeshes, false)[0];
  return hit ? hit.point.y : CENTER.y;
}

// ------------------------------------------------------------
// Controls: pan (bounded) + heading rotate. Zoom is ours, not
// OrbitControls' — the wheel drives zoomT so direction and tilt
// always stay consistent.
// ------------------------------------------------------------

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableZoom = false;               // zoom handled by the zoom axis
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;       // pan slides along the ground
controls.rotateSpeed = 0.6;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.target.copy(CENTER);

controls.addEventListener('change', () => {
  const t = controls.target;
  const clampedX = Math.min(VIEW.bounds.maxX, Math.max(VIEW.bounds.minX, t.x));
  const clampedZ = Math.min(VIEW.bounds.maxZ, Math.max(VIEW.bounds.minZ, t.z));
  camera.position.x += clampedX - t.x;
  camera.position.z += clampedZ - t.z;
  t.x = clampedX;
  t.z = clampedZ;
  t.y = CENTER.y;
});

// Wheel over the map: scroll down zooms in (and tilts), scroll up backs out
addEventListener('wheel', (e) => {
  if (state !== 'free' || glideActive) return;
  if (e.target !== renderer.domElement) return;   // let panels scroll normally
  e.preventDefault();
  const step = e.deltaMode === 1 ? 40 : 1;        // line-mode wheels
  zoomGoal = Math.min(1, Math.max(0, zoomGoal + e.deltaY * step * 0.00045));
  if (zoomGoal > 0.1) scrollHint.classList.add('fade');
}, { passive: false });

// Touch: two-finger pinch drives the same zoom axis
let pinchDist = null;
addEventListener('touchmove', (e) => {
  if (state !== 'free' || glideActive || e.touches.length !== 2) { pinchDist = null; return; }
  if (e.target !== renderer.domElement) return;
  const d = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY,
  );
  if (pinchDist !== null) {
    zoomGoal = Math.min(1, Math.max(0, zoomGoal + (d - pinchDist) * 0.0022));
    if (zoomGoal > 0.1) scrollHint.classList.add('fade');
  }
  pinchDist = d;
}, { passive: true });
addEventListener('touchend', () => { pinchDist = null; });

function enterFree() {
  state = 'free';
  zoomT = 0;
  zoomGoal = 0;
  controls.target.copy(CENTER);
  placeCameraZoom();
  controls.enabled = true;
  scrollHint.hidden = false;
  scrollHint.classList.remove('fade');
  moveHint.hidden = false;
  moveHint.classList.remove('fade');
  setTimeout(() => moveHint.classList.add('fade'), 5000);
  pinLayer.hidden = false;
  birdsUp();
}

// ------------------------------------------------------------
// Reveal / return choreography
// ------------------------------------------------------------

const DUR = REDUCED ? 0.3 : 1;   // global duration scale

const FOG_SKY = new THREE.Color(0xd9eaf7);
const FOG_EARTH = new THREE.Color(0x8a7660);

function beginReveal() {
  state = 'revealing';
  playWoosh();
  primeBirds();
  landing.classList.add('gone');
  document.getElementById('vignette').classList.add('on');
  document.getElementById('bg-earth').classList.add('on');
  const f0 = scene.fog.color.clone();
  tween({ dur: 2.0 * DUR, update: (k) => scene.fog.color.copy(f0).lerp(FOG_EARTH, k) });
  computeFit();
  controls.target.copy(CENTER);
  // glide down from the cloud deck to the fitted top-down view
  tween({
    dur: 2.2 * DUR,
    ease: easeInOut,
    update: (k) => {
      const s = new THREE.Spherical(CLOUD_ALT + (FIT_ALT - CLOUD_ALT) * k, POLAR_TOP, 0);
      camera.position.setFromSpherical(s).add(CENTER);
      camera.lookAt(CENTER);
    },
  });
  clouds.forEach((sp, i) => {
    const dir = sp.userData.home.clone().sub(CENTER);
    dir.y = 0;
    if (dir.lengthSq() < 1) dir.set(1, 0, 0);
    dir.normalize();
    const from = sp.position.clone();
    const to = from.clone().addScaledVector(dir, 4600);
    const o0 = sp.material.opacity;
    tween({
      delay: (i % 30) * 0.028 * DUR,
      dur: (1.6 + Math.random() * 0.7) * DUR,
      update: (k) => {
        sp.position.lerpVectors(from, to, k);
        sp.material.opacity = o0 * (1 - k);
      },
    });
  });
  const h0 = haze.material.opacity;
  tween({ dur: 1.6 * DUR, update: (k) => { haze.material.opacity = h0 * (1 - k); } });
  tween({
    dur: 2.4 * DUR,
    update: () => {},
    done: () => {
      cloudGroup.visible = false;
      hud.hidden = false;
      villageLabel.textContent = dualName(village);
      enterFree();
    },
  });
}

function returnToClouds() {
  if (state !== 'free') return;
  state = 'returning';
  controls.enabled = false;
  document.getElementById('vignette').classList.remove('on');
  document.getElementById('bg-earth').classList.remove('on');
  const f0 = scene.fog.color.clone();
  tween({ dur: 1.6 * DUR, update: (k) => scene.fog.color.copy(f0).lerp(FOG_SKY, k) });
  hud.hidden = true;
  pinLayer.hidden = true;
  closeDetail(false);
  birdsDown();
  cloudGroup.visible = true;

  // rise back above the cloud deck, re-centring on the way up
  const posFrom = camera.position.clone();
  const lookFrom = controls.target.clone();
  const posTo = new THREE.Vector3()
    .setFromSpherical(new THREE.Spherical(CLOUD_ALT, POLAR_TOP, 0))
    .add(CENTER);
  tween({
    dur: 1.6 * DUR,
    ease: easeInOut,
    update: (k) => {
      camera.position.lerpVectors(posFrom, posTo, k);
      CENTER_TMP.lerpVectors(lookFrom, CENTER, k);
      camera.lookAt(CENTER_TMP);
    },
  });

  clouds.forEach((sp, i) => {
    const from = sp.position.clone();
    const fo = sp.material.opacity;
    tween({
      delay: (0.5 + (i % 30) * 0.02) * DUR,
      dur: (1.4 + Math.random() * 0.5) * DUR,
      update: (k) => {
        sp.position.lerpVectors(from, sp.userData.home, k);
        sp.material.opacity = fo + (sp.userData.homeOpacity - fo) * k;
      },
    });
  });
  tween({ delay: 0.6 * DUR, dur: 1.4 * DUR, update: (k) => { haze.material.opacity = 0.88 * k; } });
  tween({
    dur: 2.6 * DUR,
    update: () => {},
    done: () => {
      zoomT = 0;
      zoomGoal = 0;
      controls.target.copy(CENTER);
      placeLanding();
      state = 'landing';
      landing.classList.remove('gone');
    },
  });
}
const CENTER_TMP = new THREE.Vector3();

// ------------------------------------------------------------
// UI: village index, HUD, pins, detail panel, toast, i18n
// ------------------------------------------------------------

const landing = document.getElementById('landing');
const villageList = document.getElementById('village-list');
const hud = document.getElementById('hud');
const scrollHint = document.getElementById('scroll-hint');
const moveHint = document.getElementById('move-hint');
const villageLabel = document.getElementById('village-label');
const pinLayer = document.getElementById('pin-layer');
const detail = document.getElementById('detail');
const detailTitle = document.getElementById('detail-title');
const detailHero = document.getElementById('detail-hero');
const detailBody = document.getElementById('detail-body');
const detailStrip = document.getElementById('detail-strip');
const toast = document.getElementById('toast');

pinLayer.hidden = true;

function S() { return config.strings[lang]; }
function otherLang() { return lang === 'en' ? 'ar' : 'en'; }
function dualName(v) { return `${v.name[lang]} · ${v.name[otherLang()]}`; }

function buildVillageList() {
  villageList.innerHTML = '';
  config.villages.forEach((v, i) => {
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `village-row ${v.status === 'live' ? 'live' : 'soon'}`;
    row.dataset.id = v.id;
    if (v.status !== 'live') row.disabled = true;

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1).padStart(2, '0');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = v.name[lang];
    const alt = document.createElement('span');
    alt.className = 'alt-name';
    alt.textContent = v.name[otherLang()];
    name.appendChild(alt);

    const status = document.createElement('span');
    status.className = 'row-status';
    status.dataset.role = 'status';

    row.append(num, name, status);
    if (v.status === 'live') row.addEventListener('click', () => selectVillage(v));
    li.appendChild(row);
    villageList.appendChild(li);
  });
  updateVillageRows();
}

function updateVillageRows() {
  for (const row of villageList.querySelectorAll('.village-row')) {
    const v = config.villages.find(x => x.id === row.dataset.id);
    const status = row.querySelector('[data-role="status"]');
    if (v.status !== 'live') { status.textContent = S().soon; continue; }
    if (terrainLoaded) status.textContent = S().explore;
    else status.textContent = `${S().loading} ${loadProgress ? loadProgress + '%' : ''}`.trim();
  }
}

function selectVillage() {
  if (state !== 'landing') return;
  if (terrainLoaded) beginReveal();
  else { state = 'pending'; updateVillageRows(); }
}

document.getElementById('back').addEventListener('click', returnToClouds);

// ----- pins -----

const pinEls = [];
const modelTagDefs = [];   // name tags for placed models (world pos is fixed)

function makePinEl(data, world, focusPoint) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pin';
  b.innerHTML = '<span class="dot"></span><span class="pin-name"></span>';
  b.querySelector('.pin-name').textContent = data.title[lang];
  b.addEventListener('click', () => openDetail(data, focusPoint));
  pinLayer.appendChild(b);
  return b;
}

function buildPins() {
  pinLayer.innerHTML = '';
  pinEls.length = 0;
  for (const p of village.pins || []) {
    const world = new THREE.Vector3(p.x, CENTER.y, p.z);
    pinEls.push({ el: makePinEl(p, world, world), data: p, world });
  }
  for (const t of modelTagDefs) {
    pinEls.push({ el: makePinEl(t.data, t.world, t.focus), data: t.data, world: t.world, fixed: true });
  }
  if (terrainLoaded) snapPins();
}

function snapPins() {
  for (const p of pinEls) {
    if (p.fixed) continue;                 // model tags sit at the model top
    p.world.y = groundHeight(p.data.x, p.data.z) + 10;
  }
}

const projected = new THREE.Vector3();
function updatePins() {
  if (pinLayer.hidden) return;
  for (const p of pinEls) {
    projected.copy(p.world).project(camera);
    const visible = projected.z < 1;
    p.el.style.display = visible ? '' : 'none';
    if (visible) {
      p.el.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
      p.el.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
    }
  }
}

// ----- detail panel (slides in; camera keeps the subject framed) -----

let currentDetail = null;          // config entry currently shown
let savedView = null;              // camera target/offset to restore on close

function phEl() {
  const d = document.createElement('div');
  d.className = 'ph';
  d.textContent = S().photoSoon;
  return d;
}

function renderDetail() {
  if (!currentDetail) return;
  const d = currentDetail;
  detailTitle.textContent = d.title[lang];
  detailBody.textContent = d.body ? d.body[lang] : '';
  const imgs = d.images || [];
  detailHero.innerHTML = '';
  if (imgs[0]) {
    const im = document.createElement('img');
    im.src = imgs[0];
    im.alt = d.title[lang];
    detailHero.appendChild(im);
  } else {
    detailHero.appendChild(phEl());
  }
  detailStrip.innerHTML = '';
  const rest = imgs.length > 1 ? imgs.slice(1) : [null, null, null];
  for (const src of rest) {
    const card = document.createElement('div');
    card.className = 'strip-card';
    if (src) {
      const im = document.createElement('img');
      im.src = src;
      im.alt = d.title[lang];
      card.appendChild(im);
    } else {
      card.appendChild(phEl());
    }
    detailStrip.appendChild(card);
  }
}

function openDetail(data, focusPoint) {
  currentDetail = data;
  renderDetail();
  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');
  detail.scrollTop = 0;
  if (focusPoint) focusOn(focusPoint);
}

function closeDetail(restoreCamera = true) {
  if (!currentDetail) return;
  currentDetail = null;
  detail.classList.remove('open');
  detail.setAttribute('aria-hidden', 'true');
  if (restoreCamera && savedView && state === 'free') restoreFocus();
  else savedView = null;
}

document.getElementById('detail-back').addEventListener('click', () => closeDetail());
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// photo strip arrows
const stripStep = () => detailStrip.clientWidth * 0.75;
document.getElementById('strip-prev').addEventListener('click', () =>
  detailStrip.scrollBy({ left: -stripStep() * (lang === 'ar' ? -1 : 1), behavior: 'smooth' }));
document.getElementById('strip-next').addEventListener('click', () =>
  detailStrip.scrollBy({ left: stripStep() * (lang === 'ar' ? -1 : 1), behavior: 'smooth' }));

// Glide the camera so the subject sits centred in the map area left
// visible beside the panel; remember where we were for the close.
function focusOn(point) {
  const offset = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  if (!savedView) savedView = { target: controls.target.clone(), sph: sph.clone() };

  const dist = Math.min(Math.max(sph.radius * 0.6, MIN_DIST), 780);
  const tF = tFromDist(dist);
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * camera.aspect;
  const panelW = Math.min(440, innerWidth * 0.92);
  const dirSign = document.documentElement.dir === 'rtl' ? -1 : 1;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0; right.normalize();
  const tgt = point.clone().addScaledVector(right, (panelW / innerWidth) * halfW * dirSign);
  tgt.y = CENTER.y;
  glideTo(tgt, new THREE.Spherical(dist, polarFor(tF), sph.theta), tF);
}

function restoreFocus() {
  const v = savedView;
  savedView = null;
  glideTo(v.target, v.sph, tFromDist(v.sph.radius));
}

function glideTo(tgt, sphTo, tAfter) {
  glideActive = true;
  controls.enabled = false;
  const from = controls.target.clone();
  const offset = camera.position.clone().sub(controls.target);
  const sphFrom = new THREE.Spherical().setFromVector3(offset);
  const cur = new THREE.Vector3();
  tween({
    dur: 1.0 * DUR,
    ease: easeInOut,
    update: (k) => {
      cur.lerpVectors(from, tgt, k);
      const s = new THREE.Spherical(
        sphFrom.radius + (sphTo.radius - sphFrom.radius) * k,
        sphFrom.phi + (sphTo.phi - sphFrom.phi) * k,
        sphFrom.theta + (sphTo.theta - sphFrom.theta) * k,
      );
      controls.target.copy(cur);
      camera.position.setFromSpherical(s).add(cur);
      camera.lookAt(cur);
    },
    done: () => {
      // hand the result back to the zoom axis so wheel stays consistent
      zoomT = tAfter;
      zoomGoal = tAfter;
      controls.minPolarAngle = sphTo.phi;
      controls.maxPolarAngle = sphTo.phi;
      glideActive = false;
      if (state === 'free') controls.enabled = true;
    },
  });
}

// ----- sound: woosh on select, birds while exploring -----

let soundOn = true;
try { soundOn = localStorage.getItem('atlas-sound') !== 'off'; } catch { /* ignore */ }

function makeAudio(def, loop = false) {
  if (!def) return null;
  const a = new Audio(def.file);
  a.loop = loop;
  a.preload = 'auto';
  a.volume = def.volume ?? 0.5;
  a.baseVolume = def.volume ?? 0.5;
  return a;
}
const wooshSfx = makeAudio(config.sounds?.woosh);
const birdsSfx = makeAudio(config.sounds?.birds, true);

function fadeAudio(a, to, dur) {
  if (!a) return;
  const from = a.volume;
  tween({
    dur,
    update: (k) => { a.volume = from + (to - from) * k; },
    done: () => { if (to === 0) a.pause(); },
  });
}

function playWoosh() {
  if (!soundOn || !wooshSfx) return;
  wooshSfx.currentTime = 0;
  wooshSfx.volume = wooshSfx.baseVolume;
  wooshSfx.play().catch(() => {});
}

// start birds silently inside the click gesture (autoplay-safe),
// then fade them up once exploration begins
function primeBirds() {
  if (!soundOn || !birdsSfx) return;
  birdsSfx.volume = 0;
  birdsSfx.play().catch(() => {});
}
function birdsUp() { if (soundOn && birdsSfx && !birdsSfx.paused) fadeAudio(birdsSfx, birdsSfx.baseVolume, 1.6); }
function birdsDown() { if (birdsSfx && !birdsSfx.paused) fadeAudio(birdsSfx, 0, 1.0); }

const soundToggle = document.getElementById('sound-toggle');
function updateSoundLabel() { soundToggle.textContent = soundOn ? S().soundOn : S().soundOff; }
soundToggle.addEventListener('click', () => {
  soundOn = !soundOn;
  try { localStorage.setItem('atlas-sound', soundOn ? 'on' : 'off'); } catch { /* ignore */ }
  updateSoundLabel();
  if (!soundOn) {
    birdsDown();
    wooshSfx?.pause();
  } else if (state === 'free' || state === 'revealing') {
    primeBirds();
    birdsUp();
  }
});

// ----- toast -----

let toastTimer = 0;
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1900);
}

// ----- map clicks: placed models open their panel; ?dev copies coords -----

{
  let downX = 0, downY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (state !== 'free') return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 7) return;
    const ndc = new THREE.Vector2(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);

    // placed 3D models first
    const modelHit = raycaster.intersectObjects(modelMeshes, false)[0];
    if (modelHit && modelHit.object.userData.detail?.title) {
      openDetail(modelHit.object.userData.detail, modelHit.object.userData.focus);
      return;
    }

    if (!DEV) return;
    const hit = raycaster.intersectObjects(terrainMeshes, false)[0];
    if (!hit) return;
    const snippet = `x: ${hit.point.x.toFixed(1)}, z: ${hit.point.z.toFixed(1)}`;
    console.log(`[dev] ${snippet}`);
    navigator.clipboard?.writeText(snippet).catch(() => {});
    showToast(`${S().copied} — ${snippet}`);
  });
}

// ----- language -----

const langToggle = document.getElementById('lang-toggle');
langToggle.addEventListener('click', () => {
  lang = otherLang();
  try { localStorage.setItem('atlas-lang', lang); } catch { /* ignore */ }
  applyLang();
});

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = S().docTitle;
  langToggle.textContent = S().langLabel;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = S()[el.dataset.i18n] ?? el.textContent;
  }
  buildVillageList();
  buildPins();
  if (terrainLoaded) snapPins();
  if (state !== 'landing' && state !== 'pending') villageLabel.textContent = dualName(village);
  renderDetail();                          // refresh panel text if it's open
  updateSoundLabel();
  if (state === 'free') pinLayer.hidden = false;
}

// ----- file:// guard -----

function showFileWarning() {
  document.getElementById('file-warning').hidden = false;
}

// ------------------------------------------------------------
// Boot + frame loop
// ------------------------------------------------------------

applyLang();

if (location.protocol === 'file:') {
  showFileWarning();
} else {
  loadTerrain();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  computeFit();                       // keep the top-down view frame-filling
  if (state === 'free' && !glideActive) placeCameraZoom();
});

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  stepTweens(dt);

  // gentle drift while the cloud deck is on screen
  if (!REDUCED && (state === 'landing' || state === 'pending')) {
    for (const sp of clouds) {
      sp.position.x += sp.userData.drift * dt;
      if (sp.position.x > CENTER.x + 3600) sp.position.x = CENTER.x - 3600;
      sp.userData.home.x = sp.position.x;
    }
  }

  // ease the zoom axis toward its goal and apply it
  if (state === 'free' && !glideActive && Math.abs(zoomGoal - zoomT) > 0.0004) {
    zoomT += (zoomGoal - zoomT) * Math.min(1, dt * 7);
    placeCameraZoom();
  }

  updateAmbient(dt);
  if (controls.enabled) controls.update();
  updatePins();
  renderer.render(scene, camera);
});
