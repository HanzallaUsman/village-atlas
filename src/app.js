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
      raceDevInit();
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
  raceToggle.hidden = !hasRaceRoute;
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
  raceToggle.hidden = true;
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

    // admin route-draw mode owns the click: drop a waypoint on the ground
    if (raceDraw.active) {
      const g = raycaster.intersectObjects(terrainMeshes, false)[0];
      if (g) addRoutePoint(g.point);
      return;
    }

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
  cruise:      110,               // forward speed, world units/sec
                                  // (~33s to cross Masfout's 3600-unit span)
  boost:       210,               // while holding mouse / touch
  yawRate:     1.6,               // turn rate at full mouse deflection (rad/s)
  maxPitch:    0.52,              // climb / dive limit (rad)
  maxRoll:     0.7,               // cosmetic bank into turns (rad)
  chaseDist:   95,                // camera distance behind the bird
  chaseHeight: 34,                // camera lift above the bird
  lookAhead:   170,               // camera aims this far ahead
  follow:      4.5,               // camera catch-up rate
  catchRadius: 80,                // how close counts as a catch
  groundClear: 12,                // let it skim right down to the terrain
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
let birdMixer = null;         // plays the model's own flap/glide/dive clips
let birdActions = {};         // { flap, glide, dive } → AnimationAction
let birdActive = null;        // name of the clip currently faded in
let flapT = 0;
const targets = [];
const flightMusic = makeAudio(config.sounds?.flightMusic, true);

const _dir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _m4 = new THREE.Matrix4();          // decodes the head-pose matrix
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

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
  g.scale.setScalar(0.45);                 // small bird
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

    // Play the model's own wing animation (falls back to the geometric
    // flap driven in the tick when the model has no clips). We sort the
    // clips into flap / glide / dive so the tick can cross-fade between
    // them — dive kicks in while boosting.
    const clips = gltf.animations || [];
    if (clips.length) {
      birdMixer = new THREE.AnimationMixer(f);
      birdActions = {};
      for (const c of clips) {
        const key = /dive/i.test(c.name) ? 'dive'
                  : /glide/i.test(c.name) ? 'glide'
                  : /flap/i.test(c.name) ? 'flap' : null;
        if (key && !birdActions[key]) birdActions[key] = birdMixer.clipAction(c);
      }
      if (!birdActions.flap) birdActions.flap = birdMixer.clipAction(clips[0]);
      birdActive = null;
      setBirdClip('flap', 0);      // start flapping immediately
    }
  }, undefined, (err) => console.warn('Falcon model failed to load; using placeholder', err));
}

// Cross-fade the model to a named clip (flap / glide / dive). No-op when
// the model has no clips, the clip is missing, or it's already active.
function setBirdClip(name, fade = 0.3) {
  if (!birdMixer) return;
  const next = birdActions[name];
  if (!next || birdActive === name) return;
  next.enabled = true;
  next.setEffectiveWeight(1).reset().fadeIn(fade).play();
  const prev = birdActive && birdActions[birdActive];
  if (prev) prev.fadeOut(fade);
  birdActive = name;
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
  // when head-steering is live and calibrated, it drives the same
  // -1..1 steering values the mouse would (see head-control block below).
  if (head.active && head.neutral) { mouse.x = head.target.x; mouse.y = head.target.y; }

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
  if (birdMixer) {
    // boost → dive tuck; otherwise flap (fall back to flap if no dive clip)
    setBirdClip(boosting && birdActions.dive ? 'dive' : 'flap');
    birdMixer.timeScale = boosting ? 1.2 : 1;
    birdMixer.update(dt);
  }

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
  if (raceDraw.active) setDrawMode(false);
  closeDetail(false);
  state = 'flying';
  if (!birdObj) buildBird();
  scene.add(flightGroup);
  ambientGroup.visible = false;

  controls.enabled = false;
  hud.hidden = true;
  pinLayer.hidden = true;
  flyToggle.hidden = true;
  raceToggle.hidden = true;
  scrollHint.hidden = true;
  moveHint.hidden = true;

  flightHud.hidden = false;
  flightCrosshair.hidden = false;
  flightModal.hidden = true;
  headToggle.hidden = false;
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
  headToggle.hidden = true;
  disableHead();                 // release the webcam when leaving flight
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
  raceToggle.hidden = !hasRaceRoute;
  birdsUp();
}

function startFlightWith(mode) {
  flightModal.hidden = true;
  modalKind = null;
  enterFlight();
  if (mode === 'head') enableHead();
}

function showModal(kind) {
  modalKind = kind;
  const s = S();
  flightModalKicker.textContent = s.flyKicker;
  if (kind === 'choose') {
    flightModalTitle.textContent = s.flyChooseTitle;
    flightModalMsg.textContent = s.flyChooseMsg;
    flightPrimary.textContent = s.flyChooseHead;
    flightSecondary.textContent = s.flyChooseMouse;
    flightPrimary.onclick = () => startFlightWith('head');
    flightSecondary.onclick = () => startFlightWith('mouse');
  } else if (kind === 'pause') {
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

flyToggle.addEventListener('click', () => { if (state === 'free') showModal('choose'); });

addEventListener('pointermove', (e) => {
  if (state !== 'flying' || head.active) return;   // head steering owns the input while on
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
  if (state !== 'flying' || head.active || !e.touches[0]) return;
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

// ------------------------------------------------------------
//  Head-pose control (opt-in webcam steering)
//  Turn your head to steer, open your mouth to dive/boost. Everything
//  funnels into the same mouse.x/y + boosting the mouse path uses, so
//  the pointer stays a live fallback and this can't break it.
//  Uses MediaPipe Tasks-Vision (on-device, loaded lazily from CDN).
// ------------------------------------------------------------

const headToggle = document.getElementById('head-toggle');
const headCam = document.getElementById('head-cam');
const headStatus = document.getElementById('head-status');
const headLabel = headToggle.querySelector('[data-i18n]');

const HEAD = {
  yawRange:   0.42,   // radians of head-turn that maps to full steer
  pitchRange: 0.34,   // radians of nod that maps to full dive/climb
  deadzone:   0.09,   // ignore tiny wobble around neutral
  smooth:     0.28,   // EMA toward the new reading each detect (0..1)
  jawBoost:   0.40,   // mouth-open blendshape score that triggers boost
  invertYaw:  true,   // turn head left → fly left (raw pose yaw is inverted)
  invertPitch:true,   // face up → fly up (raw pose pitch is inverted)
  calibFrames:18,     // ~1s of "hold still" to capture the neutral pose
};

const head = {
  active: false, loading: false,
  landmarker: null, stream: null, raf: 0,
  lastVideoTime: -1,
  neutral: null,            // { yaw, pitch } captured at calibration
  calib: [], calibrating: false,
  target: { x: 0, y: 0 },   // smoothed steering handed to the flight tick
};

function setHeadStatus(msg) {
  if (!msg) { headStatus.hidden = true; return; }
  headStatus.textContent = msg;
  headStatus.hidden = false;
}

async function loadFaceLandmarker() {
  const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const { FaceLandmarker, FilesetResolver } = await import(V);
  const fileset = await FilesetResolver.forVisionTasks(`${V}/wasm`);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

async function enableHead() {
  if (head.active || head.loading) return;
  head.loading = true;
  setHeadStatus(S().headLoading);
  try {
    if (!head.landmarker) head.landmarker = await loadFaceLandmarker();
    head.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' }, audio: false,
    });
    headCam.srcObject = head.stream;
    await headCam.play();
    head.active = true;
    headCam.hidden = false;
    headToggle.classList.add('on');
    if (headLabel) headLabel.textContent = S().headOff;
    startCalibration();
    head.raf = requestAnimationFrame(headLoop);
  } catch (err) {
    console.warn('Head control unavailable', err);
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setHeadStatus(denied ? S().headDenied : S().headUnsupported);
    disableHead(true);
  } finally {
    head.loading = false;
  }
}

// keepMsg: leave any error status on screen (used by the failure path)
function disableHead(keepMsg) {
  head.active = false;
  head.calibrating = false;
  head.neutral = null;
  head.target.x = 0; head.target.y = 0;
  head.lastVideoTime = -1;
  if (head.raf) { cancelAnimationFrame(head.raf); head.raf = 0; }
  if (head.stream) { head.stream.getTracks().forEach((t) => t.stop()); head.stream = null; }
  headCam.srcObject = null;
  headCam.hidden = true;
  headToggle.classList.remove('on');
  if (headLabel) headLabel.textContent = S().headOn;
  if (!keepMsg) setHeadStatus('');
}

function startCalibration() {
  head.calibrating = true;
  head.calib.length = 0;
  head.neutral = null;
  setHeadStatus(S().headCalib);
}

function headLoop() {
  if (!head.active) return;
  head.raf = requestAnimationFrame(headLoop);
  const lm = head.landmarker;
  if (!lm || headCam.readyState < 2) return;
  // only run detection on a fresh camera frame (keeps three.js at 60fps)
  if (headCam.currentTime === head.lastVideoTime) return;
  head.lastVideoTime = headCam.currentTime;

  let res;
  try { res = lm.detectForVideo(headCam, performance.now()); }
  catch { return; }

  const mtx = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
  if (!mtx) { if (!head.calibrating) setHeadStatus(S().headNoFace); return; }

  // decode head yaw (Y) and pitch (X) from the 4x4 pose matrix
  _m4.fromArray(mtx.data);
  _euler.setFromRotationMatrix(_m4, 'YXZ');
  const yaw = _euler.y, pitch = _euler.x;

  if (head.calibrating) {
    head.calib.push([yaw, pitch]);
    if (head.calib.length >= HEAD.calibFrames) {
      const n = head.calib.length;
      head.neutral = {
        yaw:   head.calib.reduce((s, v) => s + v[0], 0) / n,
        pitch: head.calib.reduce((s, v) => s + v[1], 0) / n,
      };
      head.calibrating = false;
      setHeadStatus(S().headReady);
      setTimeout(() => { if (head.active && !head.calibrating) setHeadStatus(''); }, 3200);
    }
    return;
  }
  if (!head.neutral) return;

  let sx = (yaw - head.neutral.yaw) / HEAD.yawRange;
  let sy = (pitch - head.neutral.pitch) / HEAD.pitchRange;
  if (HEAD.invertYaw)   sx = -sx;
  if (HEAD.invertPitch) sy = -sy;
  sx = shapeAxis(sx);
  sy = shapeAxis(sy);
  head.target.x += (sx - head.target.x) * HEAD.smooth;
  head.target.y += (sy - head.target.y) * HEAD.smooth;

  // mouth-open → dive boost
  const bs = res.faceBlendshapes && res.faceBlendshapes[0];
  if (bs && !flightPaused && !flightOver) {
    const jaw = bs.categories.find((c) => c.categoryName === 'jawOpen');
    boosting = !!(jaw && jaw.score > HEAD.jawBoost);
  }
}

// deadzone + rescale + clamp to a clean -1..1
function shapeAxis(v) {
  const d = HEAD.deadzone;
  if (Math.abs(v) < d) return 0;
  v = (v - Math.sign(v) * d) / (1 - d);
  return Math.max(-1, Math.min(1, v));
}

headToggle.addEventListener('click', () => {
  if (head.active || head.loading) disableHead(); else enableHead();
});

// ------------------------------------------------------------
//  Cycling route — admin draw + export tool (?dev only)
//  Click along the terrain to lay waypoints; a ribbon previews the
//  route hugging the ground. Export copies JSON ready to paste into
//  config.villages[…].race.route. Heights snap via groundHeight().
// ------------------------------------------------------------

const raceDraw = {
  active: false,
  points: [],                 // [{ x, z }, …]
  group: new THREE.Group(),
  markers: [],
  ribbon: null,
  panel: null,
  drawBtn: null,
  drawingEl: null,
  statusEl: null,
};

const _routeMarkerGeo = new THREE.SphereGeometry(7, 12, 10);
const _routeMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffd34d });
const _routeStartMat  = new THREE.MeshBasicMaterial({ color: 0x4fd07a });
const _routeEndMat    = new THREE.MeshBasicMaterial({ color: 0xe8543f });

// Smooth curve through the waypoints (flat; y is snapped per-sample).
function routeCurve(points) {
  if (points.length < 2) return null;
  const pts = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

// A ground-hugging ribbon along the route. Reused by the ride later.
function buildRouteRibbon(points, { width = 26, color = 0xffd34d, opacity = 0.5, offset = 3 } = {}) {
  const curve = routeCurve(points);
  if (!curve) return null;
  const N = Math.min(1200, Math.max(24, points.length * 20));
  const half = width / 2;
  const up = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), p = new THREE.Vector3();
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    curve.getPoint(t, p);
    curve.getTangent(t, tan); tan.y = 0; tan.normalize();
    side.crossVectors(up, tan).normalize();
    const y = groundHeight(p.x, p.z) + offset;
    pos.push(p.x + side.x * half, y, p.z + side.z * half,
             p.x - side.x * half, y, p.z - side.z * half);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

function addRoutePoint(point) {
  raceDraw.points.push({ x: +point.x.toFixed(1), z: +point.z.toFixed(1) });
  refreshRouteVisual();
}
function undoRoutePoint() { raceDraw.points.pop(); refreshRouteVisual(); }
function clearRoute() { raceDraw.points.length = 0; refreshRouteVisual(); }

function refreshRouteVisual() {
  for (const m of raceDraw.markers) raceDraw.group.remove(m);
  raceDraw.markers.length = 0;
  if (raceDraw.ribbon) {
    raceDraw.group.remove(raceDraw.ribbon);
    raceDraw.ribbon.geometry.dispose();
    raceDraw.ribbon = null;
  }
  raceDraw.points.forEach((pt, i) => {
    const mat = i === 0 ? _routeStartMat
              : i === raceDraw.points.length - 1 ? _routeEndMat
              : _routeMarkerMat;
    const m = new THREE.Mesh(_routeMarkerGeo, mat);
    m.position.set(pt.x, groundHeight(pt.x, pt.z) + 7, pt.z);
    raceDraw.group.add(m);
    raceDraw.markers.push(m);
  });
  if (raceDraw.points.length >= 2) {
    raceDraw.ribbon = buildRouteRibbon(raceDraw.points);
    if (raceDraw.ribbon) raceDraw.group.add(raceDraw.ribbon);
  }
  if (raceDraw.statusEl) raceDraw.statusEl.textContent = `${raceDraw.points.length} point${raceDraw.points.length === 1 ? '' : 's'}`;
}

function exportRoute() {
  if (!raceDraw.points.length) { showToast('Draw a route first'); return; }
  const json = JSON.stringify(raceDraw.points);
  console.log('[race route] paste into config race.route:\n' + json);
  navigator.clipboard?.writeText(json).catch(() => {});
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `race-route-${village.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch { /* download optional */ }
  showToast(`Route copied — ${raceDraw.points.length} pts`);
}

// Admin panel (bottom-left): an "Admin" button that expands to reveal
// tools. "Draw route" enters draw mode; while drawing, the panel shows
// point count + Undo / Clear / Export / Done.
function buildAdminPanel() {
  const wrap = document.createElement('div');
  wrap.className = 'admin-panel';
  wrap.innerHTML =
    '<button type="button" class="control admin-toggle">Admin ▾</button>' +
    '<div class="admin-menu" hidden>' +
      '<button type="button" class="control admin-draw">✏️ Draw route</button>' +
      '<div class="admin-drawing" hidden>' +
        '<span class="admin-count">0 points</span>' +
        '<span class="admin-hint">Click the terrain to drop points</span>' +
        '<div class="admin-row">' +
          '<button type="button" class="control" data-act="undo">Undo</button>' +
          '<button type="button" class="control" data-act="clear">Clear</button>' +
          '<button type="button" class="control" data-act="done">Done</button>' +
        '</div>' +
        '<button type="button" class="control admin-export" data-act="export">⬇ Export route</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);
  const menu = wrap.querySelector('.admin-menu');
  raceDraw.panel = wrap;
  raceDraw.drawBtn = wrap.querySelector('.admin-draw');
  raceDraw.drawingEl = wrap.querySelector('.admin-drawing');
  raceDraw.statusEl = wrap.querySelector('.admin-count');

  wrap.querySelector('.admin-toggle').addEventListener('click', () => { menu.hidden = !menu.hidden; });
  raceDraw.drawBtn.addEventListener('click', () => setDrawMode(true));
  raceDraw.drawingEl.addEventListener('click', (e) => {
    const act = e.target instanceof HTMLElement ? e.target.dataset.act : null;
    if (act === 'undo') undoRoutePoint();
    else if (act === 'clear') clearRoute();
    else if (act === 'export') exportRoute();
    else if (act === 'done') setDrawMode(false);
  });
}

function setDrawMode(on) {
  raceDraw.active = on;
  raceDraw.group.visible = on;                 // markers/ribbon only while drawing
  if (raceDraw.drawingEl) raceDraw.drawingEl.hidden = !on;
  if (raceDraw.drawBtn) raceDraw.drawBtn.hidden = on;   // hide "Draw route" while drawing
  // pan stays on: a click (<7px) drops a point, a drag pans the map
}

// Called once the terrain is ready (groundHeight needs the mesh).
function raceDevInit() {
  scene.add(raceDraw.group);
  raceDraw.group.visible = false;              // hidden until Draw mode is on
  const saved = village.race?.route;
  if (Array.isArray(saved) && saved.length) {
    raceDraw.points = saved.map((p) => ({ x: p.x, z: p.z }));
  }
  refreshRouteVisual();
}

if (DEV) buildAdminPanel();     // admin tools only in ?dev

// ------------------------------------------------------------
//  Cycling time-trial race
//  A box "bike" (swap for config race.bike) rides the drawn route.
//  Tap SPACE / click to pedal — cadence sets speed, terrain slope
//  helps or fights you. Reach the finish fast; best time is saved.
// ------------------------------------------------------------

const RACE = {
  chaseDist:  70, chaseHeight: 32, lookAhead: 120, follow: 3.2,
  camTurn:    2.0,     // how fast the chase cam re-aims (lower = smoother)
  maxSpeed:   60,      // world units/sec at full cadence, flat ground
  pedalGain:  0.144,   // base power per pedal tap (diminishing near the top)
  decay:      0.50,    // power lost per second between taps
  slopeK:     2.4,     // how strongly grade helps (down) / hurts (up)
  groundOffset: 1,
};

const raceToggle = document.getElementById('race-toggle');
const raceHud = document.getElementById('race-hud');
const raceHint = document.getElementById('race-hint');
const raceTimeEl = document.getElementById('race-time');
const raceProgressEl = document.getElementById('race-progress');
const raceBestEl = document.getElementById('race-best');
const raceControls = document.getElementById('race-controls');
const raceMeterFill = document.getElementById('race-meter-fill');
const racePedal = document.getElementById('race-pedal');

const raceGroup = new THREE.Group();
let bikeObj = null, bikeMixer = null, raceTrack = null;
let raceCurve = null, raceLen = 0;
let raceDist = 0, racePower = 0, raceElapsed = 0;
let raceStarted = false, raceFinished = false;

const _rp = new THREE.Vector3(), _rpA = new THREE.Vector3();
const _rtan = new THREE.Vector3(), _rcam = new THREE.Vector3();
const _rcamdir = new THREE.Vector3(0, 0, 1);   // smoothed chase heading

// Rival bot cyclists: each rides the route in its own lateral lane (so
// they never overlap) at a steady, slightly varied speed. Lanes stay
// well inside the track ribbon (±15) so they never leave the road.
const BOT_COUNT = 2;
const BOT_COLORS = [0x3aa0ff, 0xff6ba6];
const BOT_SPEEDS = [34, 46];                   // world units/sec, varied
const BOT_LANES = [-7, 7];                      // player rides lane 0 (center)
const bots = [];
const _bp = new THREE.Vector3(), _btan = new THREE.Vector3(), _bside = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

const hasRaceRoute = Array.isArray(village.race?.route) && village.race.route.length >= 2;

function buildBikePlaceholder(color = 0xff7a1a) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 14, 34),
    new THREE.MeshBasicMaterial({ color }));
  body.position.y = 7;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(11, 9, 10),
    new THREE.MeshBasicMaterial({ color: 0x1c1c1c }));
  nose.position.set(0, 9, 19);   // dark block marks the front (+Z)
  g.add(body, nose);
  g.scale.setScalar(0.175);      // tiny placeholder "bike"
  g.rotation.order = 'YXZ';
  return g;
}

function buildBike() {
  bikeObj = buildBikePlaceholder();
  bikeObj.rotation.order = 'YXZ';
  raceGroup.add(bikeObj);
  const path = village.race?.bike;
  if (!path) return;
  gltfLoader.load(path, (gltf) => {
    const f = gltf.scene;
    f.scale.setScalar(village.race?.bikeScale ?? 40);
    f.rotation.y = village.race?.bikeRotationY ?? 0;
    raceGroup.remove(bikeObj);
    bikeObj = new THREE.Group();
    bikeObj.rotation.order = 'YXZ';
    bikeObj.add(f);
    raceGroup.add(bikeObj);
    if (gltf.animations?.length) {
      bikeMixer = new THREE.AnimationMixer(f);
      bikeMixer.clipAction(gltf.animations[0]).play();
    }
  }, undefined, (err) => console.warn('Bike model failed to load; using box', err));
}

function buildBots() {
  for (const b of bots) raceGroup.remove(b.obj);
  bots.length = 0;
  for (let i = 0; i < BOT_COUNT; i++) {
    const obj = buildBikePlaceholder(BOT_COLORS[i % BOT_COLORS.length]);
    raceGroup.add(obj);
    bots.push({ obj, dist: 0, speed: BOT_SPEEDS[i], lane: BOT_LANES[i] });
  }
}

// Pose a bot on the route at its arc-length + lateral lane offset.
function poseBotAt(bot) {
  const u = Math.min(1, Math.max(0, bot.dist / Math.max(1, raceLen)));
  raceCurve.getPointAt(u, _bp);
  raceCurve.getTangentAt(Math.min(0.999, u), _btan);
  _btan.y = 0; _btan.normalize();
  _bside.crossVectors(_UP, _btan).normalize();
  const x = _bp.x + _bside.x * bot.lane;
  const z = _bp.z + _bside.z * bot.lane;
  const y = groundHeight(x, z) + RACE.groundOffset;
  bot.obj.position.set(x, y, z);
  bot.obj.rotation.set(0, Math.atan2(_btan.x, _btan.z), 0);
}

// Pose the bike at arc-length fraction u; returns the local grade.
function poseBikeAt(u) {
  u = Math.min(1, Math.max(0, u));
  raceCurve.getPointAt(u, _rp);
  raceCurve.getTangentAt(Math.min(0.999, u), _rtan);
  _rtan.y = 0; _rtan.normalize();
  const gy = groundHeight(_rp.x, _rp.z) + RACE.groundOffset;
  const uA = Math.min(1, u + 10 / Math.max(1, raceLen));
  raceCurve.getPointAt(uA, _rpA);
  const gyA = groundHeight(_rpA.x, _rpA.z);
  const horiz = Math.hypot(_rpA.x - _rp.x, _rpA.z - _rp.z) || 1;
  const grade = (gyA - gy) / horiz;
  bikeObj.position.set(_rp.x, gy, _rp.z);
  bikeObj.rotation.set(-Math.atan(grade), Math.atan2(_rtan.x, _rtan.z), 0);
  return grade;
}

function updateRaceCam(dt) {
  // ease the chase heading toward the path tangent so the camera never
  // snaps around on sharp corners
  _rcamdir.lerp(_rtan, Math.min(1, dt * RACE.camTurn));
  if (_rcamdir.lengthSq() < 1e-4) _rcamdir.copy(_rtan);
  _rcamdir.y = 0; _rcamdir.normalize();

  _rcam.copy(bikeObj.position).addScaledVector(_rcamdir, -RACE.chaseDist);
  _rcam.y += RACE.chaseHeight;
  camera.position.lerp(_rcam, Math.min(1, dt * RACE.follow));
  camera.lookAt(
    bikeObj.position.x + _rcamdir.x * RACE.lookAhead,
    bikeObj.position.y + 8,
    bikeObj.position.z + _rcamdir.z * RACE.lookAhead,
  );
}

function pedal() {
  if (state !== 'racing' || raceFinished) return;
  if (!raceStarted) { raceStarted = true; raceHint.classList.add('fade'); }
  // diminishing returns: each tap adds less as the pace nears the top,
  // so full speed takes fast, sustained mashing to reach and hold.
  racePower = Math.min(1, racePower + RACE.pedalGain * (1 - racePower * 0.9));
}

function updateRace(dt) {
  const u = raceLen ? raceDist / raceLen : 0;
  const grade = poseBikeAt(u);

  // rivals ride at their own steady pace once the race is underway
  for (const bot of bots) {
    if (raceStarted && !raceFinished) bot.dist = Math.min(raceLen, bot.dist + bot.speed * dt);
    poseBotAt(bot);
  }

  if (!raceStarted) { updateRaceCam(1); return; }   // idle at the start line

  raceElapsed += dt;
  racePower = Math.max(0, racePower - RACE.decay * dt);
  const slope = Math.min(1.5, Math.max(0.35, 1 - grade * RACE.slopeK));
  const speed = RACE.maxSpeed * racePower * slope;
  raceDist += speed * dt;

  if (bikeMixer) { bikeMixer.timeScale = 0.4 + racePower * 2.2; bikeMixer.update(dt); }
  updateRaceCam(dt);

  raceTimeEl.textContent = raceElapsed.toFixed(1);
  raceProgressEl.textContent = Math.min(100, Math.round(u * 100)) + '%';
  if (raceMeterFill) raceMeterFill.style.width = Math.round(racePower * 100) + '%';
  if (raceDist >= raceLen) finishRace();
}

function raceBestKey() { return `atlas-race-best-${village.id}`; }
function loadRaceBest() {
  try { const v = parseFloat(localStorage.getItem(raceBestKey())); return isFinite(v) ? v : null; }
  catch { return null; }
}
function saveRaceBest(t) { try { localStorage.setItem(raceBestKey(), String(t)); } catch { /* ignore */ } }

function startRace() {
  raceDist = 0; racePower = 0; raceElapsed = 0;
  raceStarted = false; raceFinished = false;
  const best = loadRaceBest();
  raceBestEl.textContent = best != null ? best.toFixed(1) + 's' : '—';
  raceTimeEl.textContent = '0.0';
  raceProgressEl.textContent = '0%';
  raceHint.textContent = S().raceStartHint;
  raceHint.hidden = false;
  raceHint.classList.remove('fade');
  poseBikeAt(0);
  _rcamdir.copy(_rtan);         // start already aimed down the route
  updateRaceCam(1);             // snap camera behind the start
  if (raceMeterFill) raceMeterFill.style.width = '0%';

  // line the rivals up on the start grid with a fresh speed jitter
  for (let i = 0; i < bots.length; i++) {
    bots[i].dist = 0;
    bots[i].speed = BOT_SPEEDS[i] + (Math.random() * 6 - 3);
    poseBotAt(bots[i]);
  }
}

function finishRace() {
  if (raceFinished) return;
  raceFinished = true;
  raceDist = raceLen;
  const t = raceElapsed;
  const prev = loadRaceBest();
  const isBest = prev == null || t < prev;
  if (isBest) saveRaceBest(t);
  raceBestEl.textContent = (isBest ? t : prev).toFixed(1) + 's';
  // placement: how many rivals already crossed the line before you
  const ahead = bots.filter((b) => b.dist >= raceLen).length;
  const place = ahead + 1;
  const total = bots.length + 1;
  const s = S();
  flightModalKicker.textContent = s.raceKicker;
  flightModalTitle.textContent = `${s.raceFinishTitle} · ${place}/${total}`;
  flightModalMsg.textContent = isBest
    ? `${t.toFixed(1)}s — ${s.raceNewBest}`
    : `${t.toFixed(1)}s · ${s.raceBest} ${prev.toFixed(1)}s`;
  flightPrimary.textContent = s.raceAgain;
  flightSecondary.textContent = s.raceDone;
  flightPrimary.onclick = () => { flightModal.hidden = true; startRace(); };
  flightSecondary.onclick = leaveRace;
  flightModal.hidden = false;
}

function enterRace() {
  if (state !== 'free') return;
  const route = village.race?.route;
  if (!Array.isArray(route) || route.length < 2) { showToast(S().raceNoRoute); return; }
  raceCurve = routeCurve(route);
  raceCurve.arcLengthDivisions = 600;
  raceLen = raceCurve.getLength();
  if (raceDraw.active) setDrawMode(false);
  closeDetail(false);
  state = 'racing';

  if (!bikeObj) buildBike();
  if (!bots.length) buildBots();
  if (raceTrack) { raceGroup.remove(raceTrack); raceTrack.geometry.dispose(); raceTrack = null; }
  raceTrack = buildRouteRibbon(route, { width: 30, color: 0xffcf4d, opacity: 0.45, offset: 2 });
  if (raceTrack) raceGroup.add(raceTrack);
  scene.add(raceGroup);
  ambientGroup.visible = false;

  controls.enabled = false;
  hud.hidden = true;
  pinLayer.hidden = true;
  flyToggle.hidden = true;
  raceToggle.hidden = true;
  scrollHint.hidden = true;
  moveHint.hidden = true;
  if (raceDraw.panel) raceDraw.panel.style.display = 'none';
  flightModal.hidden = true;
  raceHud.hidden = false;
  raceControls.hidden = false;

  startRace();
}

function leaveRace() {
  flightModal.hidden = true;
  scene.remove(raceGroup);
  ambientGroup.visible = true;
  raceHud.hidden = true;
  raceHint.hidden = true;
  raceControls.hidden = true;
  if (raceDraw.panel) raceDraw.panel.style.display = '';

  state = 'free';
  zoomT = 0; zoomGoal = 0;
  controls.target.copy(CENTER);
  placeCameraZoom();
  controls.enabled = true;
  hud.hidden = false;
  pinLayer.hidden = false;
  flyToggle.hidden = false;
  raceToggle.hidden = !hasRaceRoute;
  birdsUp();
}

raceToggle.addEventListener('click', enterRace);
renderer.domElement.addEventListener('pointerdown', () => { if (state === 'racing') pedal(); });
// on-screen pedal button (iPad/touch); pointerdown fires per tap for mashing
racePedal.addEventListener('pointerdown', (e) => { e.preventDefault(); pedal(); });
addEventListener('keydown', (e) => {
  if (state !== 'racing') return;
  if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (!e.repeat) pedal(); }
  else if (e.key === 'Escape') { e.preventDefault(); leaveRace(); }
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

  // Race mode likewise owns the camera.
  if (state === 'racing') {
    updateRace(dt);
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
