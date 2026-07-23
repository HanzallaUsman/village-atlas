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
  flyToggle.hidden = false;
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
  flyToggle.hidden = true;
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
  if (state === 'flying' && modalKind) showModal(modalKind);   // re-render open dialog
}

// ============================================================
//  Falcon flight mini-game
//  The "Fly" button (right edge, shown while exploring) hands the
//  camera to a bird you steer with the mouse: it auto-flies forward,
//  the mouse banks/pitches it, and a third-person camera trails
//  behind. Catch the drifting birds before the timer runs out.
//  ESC pauses. The falcon model and music are swappable via
//  config.flight / config.sounds.flightMusic — a placeholder bird
//  and a synthesized catch tone are used until then.
// ============================================================

const FLIGHT = {
  duration:    config.flight?.duration ?? 60,
  targetCount: config.flight?.targetCount ?? 7,
  cruise:      640,               // forward speed, world units/sec
  boost:       1150,              // while holding mouse / touch
  yawRate:     1.6,               // turn rate at full mouse deflection (rad/s)
  maxPitch:    0.52,              // climb / dive limit (rad)
  maxRoll:     0.7,               // cosmetic bank into turns (rad)
  chaseDist:   135,               // camera distance behind the bird
  chaseHeight: 48,                // camera lift above the bird
  lookAhead:   220,               // camera aims this far ahead
  follow:      4.5,               // camera catch-up rate
  catchRadius: 80,                // how close counts as a catch
  groundClear: 55,                // stay this far above the terrain
  ceiling:     CENTER.y + 1500,   // altitude cap
  edgeMargin:  260,               // start curving back this far from bounds
};

const flyToggle = document.getElementById('fly-toggle');
const flightHud = document.getElementById('flight-hud');
const flightScoreEl = document.getElementById('flight-score');
const flightTimeEl = document.getElementById('flight-time');
const flightHint = document.getElementById('flight-hint');
const flightCrosshair = document.getElementById('flight-crosshair');
const flightModal = document.getElementById('flight-modal');
const flightModalKicker = document.getElementById('flight-modal-kicker');
const flightModalTitle = document.getElementById('flight-modal-title');
const flightModalMsg = document.getElementById('flight-modal-msg');
const flightPrimary = document.getElementById('flight-primary');
const flightSecondary = document.getElementById('flight-secondary');

let flightPaused = false;
let flightOver = false;
let modalKind = null;
let score = 0;
let timeLeft = 0;
let boosting = false;
const mouse = { x: 0, y: 0 };            // normalized -1..1 from screen center

const bird = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0 };
const flightGroup = new THREE.Group();
let birdObj = null;
let birdWings = [];
let flapT = 0;
const targets = [];
const flightMusic = makeAudio(config.sounds?.flightMusic, true);

const _dir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();

// ----- placeholder bird (swapped for config.flight.model when set) -----

function buildPlaceholderBird() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: .85 });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x3f2b1c, roughness: .9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xcaa26a, roughness: .8 });

  const body = new THREE.Mesh(new THREE.ConeGeometry(9, 52, 14), bodyMat);
  body.rotation.x = Math.PI / 2;         // taper toward +Z (forward)
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 12), headMat);
  head.position.z = 24;
  g.add(head);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(2, 26, 8), bodyMat);
  tail.rotation.x = -Math.PI / 2; tail.position.z = -30; tail.scale.set(3, 1, 1);
  g.add(tail);

  const wingGeo = new THREE.BoxGeometry(64, 2.5, 26);
  const left = new THREE.Mesh(wingGeo, wingMat);  left.position.x = -34;
  const right = new THREE.Mesh(wingGeo, wingMat); right.position.x = 34;
  g.add(left, right);
  birdWings = [left, right];
  return g;
}

function buildBird() {
  birdObj = buildPlaceholderBird();
  birdObj.rotation.order = 'YXZ';
  flightGroup.add(birdObj);

  const path = config.flight?.model;
  if (!path) return;
  gltfLoader.load(path, (gltf) => {
    const f = gltf.scene;
    f.scale.setScalar(config.flight?.modelScale ?? 40);
    f.rotation.y = config.flight?.modelRotationY ?? 0;
    flightGroup.remove(birdObj);
    birdWings = [];
    birdObj = new THREE.Group();
    birdObj.rotation.order = 'YXZ';
    birdObj.add(f);
    flightGroup.add(birdObj);
  }, undefined, (err) => console.warn('Falcon model failed to load; using placeholder', err));
}

// ----- target birds (canvas silhouette sprites) -----

let birdSpriteTex = null;
function birdSpriteTexture() {
  if (birdSpriteTex) return birdSpriteTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.strokeStyle = 'rgba(28,24,20,0.95)';
  c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath();                          // a little gull "M" silhouette
  c.moveTo(6, 42); c.quadraticCurveTo(22, 16, 32, 36);
  c.quadraticCurveTo(42, 16, 58, 42);
  c.stroke();
  birdSpriteTex = new THREE.CanvasTexture(cv);
  birdSpriteTex.colorSpace = THREE.SRGBColorSpace;
  return birdSpriteTex;
}

function spawnTargetAt(t) {
  const b = VIEW.bounds, m = 200;
  const x = b.minX + m + Math.random() * (b.maxX - b.minX - 2 * m);
  const z = b.minZ + m + Math.random() * (b.maxZ - b.minZ - 2 * m);
  const y = groundHeight(x, z) + 220 + Math.random() * 520;
  t.pos.set(x, y, z);
  const ang = Math.random() * Math.PI * 2;
  const sp = 60 + Math.random() * 90;
  t.vel.set(Math.sin(ang) * sp, 0, Math.cos(ang) * sp);
  t.bobT = Math.random() * 6;
}

function buildTargets() {
  for (const t of targets) { flightGroup.remove(t.sprite); t.sprite.material.dispose(); }
  targets.length = 0;
  const tex = birdSpriteTexture();
  for (let i = 0; i < FLIGHT.targetCount; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(60, 60, 1);
    const t = { sprite: sp, pos: new THREE.Vector3(), vel: new THREE.Vector3(), bobT: 0 };
    spawnTargetAt(t);
    sp.position.copy(t.pos);
    flightGroup.add(sp);
    targets.push(t);
  }
}

// ----- synthesized "catch" chime (WebAudio; no asset needed) -----

let audioCtx = null;
function playCatchTone() {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now); osc.stop(now + 0.24);
  } catch { /* ignore */ }
}

// ----- per-frame update -----

function setFlightClock() {
  const secs = Math.max(0, Math.ceil(timeLeft));
  flightTimeEl.textContent = secs + 's';
  flightTimeEl.classList.toggle('low', secs <= 10);
}

function updateFlight(dt) {
  // steer: mouse right → turn right, mouse toward top → dive.
  // (chase cam looks +Z, so screen-right is world -X → yaw decreases.
  //  If steering ever feels mirrored, flip this - to a +.)
  bird.yaw -= mouse.x * FLIGHT.yawRate * dt;
  const targetPitch = mouse.y * FLIGHT.maxPitch;
  bird.pitch += (targetPitch - bird.pitch) * Math.min(1, dt * 4);
  bird.roll += (-mouse.x * FLIGHT.maxRoll - bird.roll) * Math.min(1, dt * 4);

  // forward motion along heading
  _dir.set(
    Math.sin(bird.yaw) * Math.cos(bird.pitch),
    Math.sin(bird.pitch),
    Math.cos(bird.yaw) * Math.cos(bird.pitch),
  );
  bird.pos.addScaledVector(_dir, (boosting ? FLIGHT.boost : FLIGHT.cruise) * dt);

  // keep it over Masfout: curve back near the edges, then hard-clamp
  const b = VIEW.bounds, m = FLIGHT.edgeMargin;
  if (bird.pos.x < b.minX + m || bird.pos.x > b.maxX - m ||
      bird.pos.z < b.minZ + m || bird.pos.z > b.maxZ - m) {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const toC = Math.atan2(cx - bird.pos.x, cz - bird.pos.z);
    const d = Math.atan2(Math.sin(toC - bird.yaw), Math.cos(toC - bird.yaw));
    bird.yaw += d * Math.min(1, dt * 0.9);
  }
  bird.pos.x = Math.min(b.maxX, Math.max(b.minX, bird.pos.x));
  bird.pos.z = Math.min(b.maxZ, Math.max(b.minZ, bird.pos.z));

  // altitude limits
  const minY = groundHeight(bird.pos.x, bird.pos.z) + FLIGHT.groundClear;
  if (bird.pos.y < minY) { bird.pos.y = minY; if (bird.pitch < 0) bird.pitch *= 0.4; }
  if (bird.pos.y > FLIGHT.ceiling) { bird.pos.y = FLIGHT.ceiling; if (bird.pitch > 0) bird.pitch *= 0.4; }

  // pose the bird + flap
  birdObj.position.copy(bird.pos);
  birdObj.rotation.set(-bird.pitch, bird.yaw, bird.roll);
  flapT += dt * (boosting ? 17 : 11);
  const a = Math.sin(flapT) * 0.5;
  if (birdWings.length) { birdWings[0].rotation.z = a; birdWings[1].rotation.z = -a; }

  // third-person chase camera (smoothed)
  _camPos.copy(bird.pos).addScaledVector(_dir, -FLIGHT.chaseDist);
  _camPos.y += FLIGHT.chaseHeight;
  camera.position.lerp(_camPos, Math.min(1, dt * FLIGHT.follow));
  camera.lookAt(_look.copy(bird.pos).addScaledVector(_dir, FLIGHT.lookAhead));

  // targets drift, bounce off bounds, and get caught by proximity
  for (const t of targets) {
    t.pos.addScaledVector(t.vel, dt);
    if (t.pos.x < b.minX + 120 || t.pos.x > b.maxX - 120) t.vel.x *= -1;
    if (t.pos.z < b.minZ + 120 || t.pos.z > b.maxZ - 120) t.vel.z *= -1;
    t.pos.x = Math.min(b.maxX - 120, Math.max(b.minX + 120, t.pos.x));
    t.pos.z = Math.min(b.maxZ - 120, Math.max(b.minZ + 120, t.pos.z));
    t.bobT += dt;
    t.sprite.position.set(t.pos.x, t.pos.y + Math.sin(t.bobT * 1.5) * 18, t.pos.z);
    if (bird.pos.distanceTo(t.pos) < FLIGHT.catchRadius) {
      score++;
      flightScoreEl.textContent = String(score);
      playCatchTone();
      spawnTargetAt(t);
      t.sprite.position.copy(t.pos);
    }
  }

  // timer
  timeLeft -= dt;
  setFlightClock();
  if (timeLeft <= 0) flightGameOver();
}

// ----- state transitions -----

function startRun() {
  score = 0;
  timeLeft = FLIGHT.duration;
  flightScoreEl.textContent = '0';
  setFlightClock();
  flightOver = false;
  flightPaused = false;
  boosting = false;
  mouse.x = 0; mouse.y = 0;
  bird.pos.set(CENTER.x, groundHeight(CENTER.x, CENTER.z) + 480, CENTER.z);
  bird.yaw = 0; bird.pitch = 0; bird.roll = 0;
  buildTargets();

  // snap the chase camera behind the bird (heading +Z)
  birdObj.position.copy(bird.pos);
  birdObj.rotation.set(0, 0, 0);
  camera.position.copy(bird.pos);
  camera.position.z -= FLIGHT.chaseDist;
  camera.position.y += FLIGHT.chaseHeight;
  camera.lookAt(bird.pos.x, bird.pos.y, bird.pos.z + FLIGHT.lookAhead);

  if (soundOn && flightMusic) {
    flightMusic.currentTime = 0;
    flightMusic.volume = 0;
    flightMusic.play().catch(() => {});
    fadeAudio(flightMusic, flightMusic.baseVolume, 1.0);
  }
}

function enterFlight() {
  if (state !== 'free') return;
  closeDetail(false);
  state = 'flying';
  if (!birdObj) buildBird();
  scene.add(flightGroup);
  ambientGroup.visible = false;

  controls.enabled = false;
  hud.hidden = true;
  pinLayer.hidden = true;
  flyToggle.hidden = true;
  scrollHint.hidden = true;
  moveHint.hidden = true;

  flightHud.hidden = false;
  flightCrosshair.hidden = false;
  flightModal.hidden = true;
  renderer.domElement.classList.add('flying');

  birdsDown();
  startRun();

  flightHint.hidden = false;
  flightHint.classList.remove('fade');
  setTimeout(() => flightHint.classList.add('fade'), 5200);
}

function leaveFlight() {
  scene.remove(flightGroup);
  ambientGroup.visible = true;
  flightModal.hidden = true;
  flightHud.hidden = true;
  flightCrosshair.hidden = true;
  flightHint.hidden = true;
  modalKind = null;
  renderer.domElement.classList.remove('flying');
  if (flightMusic) fadeAudio(flightMusic, 0, 0.6);

  // restore the top-down explore view
  state = 'free';
  zoomT = 0; zoomGoal = 0;
  controls.target.copy(CENTER);
  placeCameraZoom();
  controls.enabled = true;
  hud.hidden = false;
  pinLayer.hidden = false;
  flyToggle.hidden = false;
  birdsUp();
}

function showModal(kind) {
  modalKind = kind;
  const s = S();
  flightModalKicker.textContent = s.flyKicker;
  if (kind === 'pause') {
    flightModalTitle.textContent = s.flyPauseTitle;
    flightModalMsg.textContent = s.flyPauseMsg;
    flightPrimary.textContent = s.flyResume;
    flightSecondary.textContent = s.flyEnd;
    flightPrimary.onclick = resumeFlight;
    flightSecondary.onclick = leaveFlight;
  } else {
    flightModalTitle.textContent = s.flyOverTitle;
    flightModalMsg.textContent = `${score} ${s.flyOverMsg}`;
    flightPrimary.textContent = s.flyAgain;
    flightSecondary.textContent = s.flyDone;
    flightPrimary.onclick = () => { flightModal.hidden = true; modalKind = null; startRun(); };
    flightSecondary.onclick = leaveFlight;
  }
  flightModal.hidden = false;
}

function pauseFlight() {
  if (state !== 'flying' || flightOver || flightPaused) return;
  flightPaused = true;
  boosting = false;
  if (flightMusic) flightMusic.pause();
  showModal('pause');
}

function resumeFlight() {
  flightPaused = false;
  modalKind = null;
  flightModal.hidden = true;
  if (soundOn && flightMusic) flightMusic.play().catch(() => {});
}

function flightGameOver() {
  if (flightOver) return;
  flightOver = true;
  if (flightMusic) fadeAudio(flightMusic, 0, 0.8);
  showModal('over');
}

// ----- flight input -----

flyToggle.addEventListener('click', enterFlight);

addEventListener('pointermove', (e) => {
  if (state !== 'flying') return;
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = (e.clientY / innerHeight) * 2 - 1;
});
renderer.domElement.addEventListener('pointerdown', () => {
  if (state === 'flying' && !flightPaused && !flightOver) boosting = true;
});
addEventListener('pointerup', () => { boosting = false; });

renderer.domElement.addEventListener('touchstart', (e) => {
  if (state !== 'flying' || !e.touches[0]) return;
  if (!flightPaused && !flightOver) boosting = true;
}, { passive: true });
addEventListener('touchmove', (e) => {
  if (state !== 'flying' || !e.touches[0]) return;
  mouse.x = (e.touches[0].clientX / innerWidth) * 2 - 1;
  mouse.y = (e.touches[0].clientY / innerHeight) * 2 - 1;
}, { passive: true });
addEventListener('touchend', () => { if (state === 'flying') boosting = false; });

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || state !== 'flying') return;
  e.preventDefault();
  if (flightOver) return;
  if (flightPaused) resumeFlight(); else pauseFlight();
});

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

  // Flight mode owns the camera entirely; skip the map machinery.
  if (state === 'flying') {
    if (!flightPaused && !flightOver) updateFlight(dt);
    renderer.render(scene, camera);
    return;
  }

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
