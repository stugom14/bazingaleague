import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { TrackManager } from './track.js';
import { Skater } from './skater.js';
import { pollGamepad, gamepadConfirmPressed } from './gamepad.js';

// ── Scene Setup ────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.fog = new THREE.Fog(0x8899bb, 60, 220);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8899bb);
scene.fog = renderer.fog;

// ── Lighting ───────────────────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xbbccdd, 0.7);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff5dd, 1.4);
sun.position.set(30, 80, -40);
sun.castShadow = true;
scene.add(sun);

const fillLight = new THREE.DirectionalLight(0xaaccff, 0.3);
fillLight.position.set(-20, 20, 10);
scene.add(fillLight);

// ── Camera ─────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
let camOffset = new THREE.Vector3(0, 4.5, 9);
let camLookAhead = new THREE.Vector3(0, 1, -18);

// ── Game State ─────────────────────────────────────────────────────────────
let state = 'start';   // 'start' | 'playing' | 'dead'
let track = null;
let skater = null;
let score = 0;
let lastFrameTime = 0;

// Daily challenge (seeded by date)
const TODAY = new Date();
const CHALLENGE = buildDailyChallenge(TODAY);

// ── Input ──────────────────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  // Prevent page scroll on space/arrows
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

// ── UI References ──────────────────────────────────────────────────────────
const speedEl     = document.getElementById('speed-value');
const scoreEl     = document.getElementById('score-value');
const distEl      = document.getElementById('distance-value');
const comboEl     = document.getElementById('combo-value');
const comboDiv    = document.getElementById('combo-display');
const boostBar    = document.getElementById('boost-bar');
const trickFlash  = document.getElementById('trick-flash');
const startScreen = document.getElementById('start-screen');
const wipeScreen  = document.getElementById('wipeout-screen');
const challengeTxt= document.getElementById('challenge-text');
const challengeRes= document.getElementById('challenge-result');
const finalDist   = document.getElementById('final-distance');
const finalSpd    = document.getElementById('final-speed');
const finalScore  = document.getElementById('final-score');
const finalTrick  = document.getElementById('final-trick');

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);
window.addEventListener('keydown', e => {
  if (e.key === 'Enter' && state === 'start')  startGame();
  if (e.key === 'Enter' && state === 'dead')   startGame();
  if (e.key === 'r' && state === 'dead')       startGame();
});

// Poll gamepad confirm on menu screens (runs even when not playing)
function menuGamepadPoll() {
  if (state !== 'playing' && gamepadConfirmPressed()) startGame();
  requestAnimationFrame(menuGamepadPoll);
}
requestAnimationFrame(menuGamepadPoll);

// ── Challenge Setup ────────────────────────────────────────────────────────
challengeTxt.textContent = `DAILY CHALLENGE: ${CHALLENGE.description}`;

function buildDailyChallenge(date) {
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const challenges = [
    { description: 'Reach 1500m without wiping out', type: 'distance', target: 1500 },
    { description: 'Hit 120 km/h at any point', type: 'speed', target: 120 },
    { description: 'Land 3 tricks in one run', type: 'tricks', target: 3 },
    { description: 'Score 5000 points', type: 'score', target: 5000 },
    { description: 'Build a x4 combo', type: 'combo', target: 4 },
    { description: 'Travel 3000m in one run', type: 'distance', target: 3000 },
    { description: 'Hit 150 km/h at any point', type: 'speed', target: 150 },
  ];
  return challenges[seed % challenges.length];
}

// ── Game Init ──────────────────────────────────────────────────────────────
function startGame() {
  // Clear old objects
  if (track) {
    track.segments.forEach(s => {
      scene.remove(s.mesh);
      if (s.obstacleMesh) scene.remove(s.obstacleMesh);
    });
    track.terrainChunks.forEach(c => scene.remove(c.mesh));
  }
  if (skater) scene.remove(skater.mesh);

  score = 0;
  track = new TrackManager(scene);
  skater = new Skater(scene);
  skater.setKeys(keys);

  startScreen.classList.add('hidden');
  wipeScreen.classList.add('hidden');
  state = 'playing';
  lastFrameTime = performance.now();
  requestAnimationFrame(gameLoop);
}

// ── Trick flash display ────────────────────────────────────────────────────
let trickFlashTimeout = null;
function showTrickFlash(text) {
  trickFlash.textContent = text;
  trickFlash.classList.remove('hidden');
  trickFlash.style.animation = 'none';
  void trickFlash.offsetWidth; // reflow
  trickFlash.style.animation = '';
  if (trickFlashTimeout) clearTimeout(trickFlashTimeout);
  trickFlashTimeout = setTimeout(() => trickFlash.classList.add('hidden'), 700);
}

// ── Previous trick state for detecting new landings ───────────────────────
let prevTrickLanded = false;
let prevCombo = 0;
let trickCount = 0;
let challengeMaxCombo = 0;

// ── Game Loop ──────────────────────────────────────────────────────────────
function gameLoop(now) {
  if (state !== 'playing') return;

  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  // Poll gamepad input into the shared keys object each frame
  pollGamepad(keys);

  // Update
  skater.update(dt, z => track.getRoadXAt(z));
  track.update(skater.getWorldZ());

  // Collision
  const obstacles = track.getNearbyObstacles(skater.getWorldZ());
  if (skater.checkObstacleCollision(obstacles)) {
    skater.crash();
    state = 'dead';
    setTimeout(showWipeout, 600);
    renderFrame();
    return;
  }

  // Trick landing detection
  if (skater.trickLanded && !prevTrickLanded) {
    skater.trickLanded = false;
    const trick = skater.bestTrick;
    const combo  = skater.getCombo();
    const pts    = trick ? trick.score * combo : 0;
    score += pts;
    trickCount++;
    if (combo > challengeMaxCombo) challengeMaxCombo = combo;
    if (trick) showTrickFlash(combo > 1 ? `${trick.name}  x${combo}!` : trick.name);
  }
  prevTrickLanded = skater.trickLanded;

  // Score from distance + speed
  score += skater.getSpeed() * dt * 0.5;

  // HUD
  const kmh = skater.getSpeedKmh();
  speedEl.textContent = kmh;
  scoreEl.textContent = Math.floor(score);
  distEl.textContent  = skater.getDistance();

  const combo = skater.getCombo();
  if (combo > 1) {
    comboDiv.classList.remove('hidden');
    comboEl.textContent = `x${combo}`;
  } else {
    comboDiv.classList.add('hidden');
  }

  boostBar.style.setProperty('--boost', `${Math.round(skater.getBoost() * 100)}%`);

  renderFrame();
  requestAnimationFrame(gameLoop);
}

// ── Camera Follow ──────────────────────────────────────────────────────────
function renderFrame() {
  if (!skater) { renderer.render(scene, camera); return; }

  const sp = skater.mesh.position;
  const speed = skater.getSpeed();

  // Dynamic FOV — feel the speed
  camera.fov = 68 + Math.min(speed / MAX_SPEED_REF, 1) * 16;
  camera.updateProjectionMatrix();

  // Camera pulls back slightly when crouching for speed sensation
  const crouchPull = skater.isCrouching ? 1.5 : 0;
  const targetOffset = new THREE.Vector3(
    -skater.lateralVel * 0.18,
    4.5 - (skater.isCrouching ? 0.4 : 0),
    9 + crouchPull
  );
  camOffset.lerp(targetOffset, 0.08);

  camera.position.set(
    sp.x + camOffset.x,
    sp.y + camOffset.y,
    sp.z + camOffset.z
  );

  const lookTarget = new THREE.Vector3(
    sp.x + skater.lateralVel * 0.5,
    sp.y + 1.0,
    sp.z - 18
  );
  camLookAhead.lerp(lookTarget, 0.1);
  camera.lookAt(camLookAhead);

  renderer.render(scene, camera);
}

const MAX_SPEED_REF = 95;

// ── Wipeout Screen ─────────────────────────────────────────────────────────
function showWipeout() {
  state = 'dead';
  wipeScreen.classList.remove('hidden');

  finalDist.textContent  = `${skater.getDistance()} m`;
  finalSpd.textContent   = `${Math.round(skater.topSpeed * 3.6)} km/h`;
  finalScore.textContent = Math.floor(score);
  finalTrick.textContent = skater.bestTrick ? skater.bestTrick.name : '—';

  // Challenge check
  const ch = CHALLENGE;
  let passed = false;
  if (ch.type === 'distance') passed = skater.getDistance() >= ch.target;
  if (ch.type === 'speed')    passed = Math.round(skater.topSpeed * 3.6) >= ch.target;
  if (ch.type === 'tricks')   passed = trickCount >= ch.target;
  if (ch.type === 'score')    passed = score >= ch.target;
  if (ch.type === 'combo')    passed = challengeMaxCombo >= ch.target;

  challengeRes.textContent = passed
    ? '★ DAILY CHALLENGE COMPLETE ★'
    : `CHALLENGE: ${ch.description}`;
  challengeRes.style.color = passed ? '#ffcc00' : 'rgba(255,255,255,0.4)';

  // Reset challenge trackers
  trickCount = 0;
  challengeMaxCombo = 0;
}

// ── Resize ─────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Initial render (start screen backdrop) ─────────────────────────────────
(function initBackdrop() {
  // Render a static scene so the start screen has something behind it
  const backdropTrack = new TrackManager(scene);
  camera.position.set(0, 6, 14);
  camera.lookAt(0, 0, -20);
  renderer.render(scene, camera);
})();
