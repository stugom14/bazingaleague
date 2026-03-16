import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { TRACK_WIDTH } from './track.js';

// ── Physics constants ──────────────────────────────────────────────────────
const BASE_SPEED       = 18;      // m/s baseline
const MAX_SPEED        = 95;
const CROUCH_ACCEL     = 22;      // additional accel while crouched
const PASSIVE_ACCEL    = 4;       // always accelerating downhill
const DRAG             = 0.018;   // speed² drag coefficient
const STEER_SPEED      = 9.5;
const STEER_RETURN     = 5;
const GRAVITY          = -28;
const JUMP_FORCE       = 11;
const GROUND_Y         = 0.55;    // skater feet height
const CRASH_DISTANCE   = 1.4;     // obstacle hit radius

// ── Trick definitions ──────────────────────────────────────────────────────
export const TRICKS = {
  KICKFLIP:  { name: 'KICKFLIP',  score: 200, airTime: 0.5 },
  HEELFLIP:  { name: 'HEELFLIP',  score: 200, airTime: 0.5 },
  INDY:      { name: 'INDY GRAB', score: 350, airTime: 0.65 },
  MUTE:      { name: 'MUTE GRAB', score: 350, airTime: 0.65 },
  BACKFLIP:  { name: 'BACKFLIP',  score: 600, airTime: 0.8 },
  NOSEGRAB:  { name: 'NOSE GRAB', score: 400, airTime: 0.65 },
};

export class Skater {
  constructor(scene) {
    this.scene = scene;

    // State
    this.speed = BASE_SPEED;       // m/s
    this.lateralPos = 0;           // X offset from road center
    this.lateralVel = 0;
    this.y = GROUND_Y;
    this.velY = 0;
    this.isGrounded = true;
    this.isCrouching = false;
    this.isAlive = true;
    this.distanceTraveled = 0;
    this.topSpeed = 0;
    this.airTime = 0;
    this.currentTrick = null;
    this.trickLanded = false;
    this.bestTrick = null;

    // Combo system
    this.comboCount = 0;
    this.comboTimer = 0;
    this.COMBO_WINDOW = 4.5;       // seconds to keep combo alive

    // Boost
    this.boost = 0;                // 0–1
    this.boosting = false;

    // Input snapshot
    this.keys = {};

    // Build mesh
    this.mesh = this._buildMesh();
    this.mesh.position.set(0, GROUND_Y, 0);
    scene.add(this.mesh);

    // Lean state (visual only)
    this._leanAngle = 0;
    this._boardTilt = 0;
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Board
    const boardGeo = new THREE.BoxGeometry(0.24, 0.06, 0.9);
    const boardMat = new THREE.MeshLambertMaterial({ color: 0x221100 });
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.y = -0.28;
    board.castShadow = true;

    // Truck left
    const truckGeo = new THREE.BoxGeometry(0.42, 0.06, 0.12);
    const truckMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const truckF = new THREE.Mesh(truckGeo, truckMat);
    truckF.position.set(0, -0.3, 0.32);
    const truckB = new THREE.Mesh(truckGeo, truckMat);
    truckB.position.set(0, -0.3, -0.32);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.07, 10);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0xff4400 });
    wheelGeo.rotateZ(Math.PI / 2);
    [[-0.22, 0.34], [0.22, 0.34], [-0.22, -0.34], [0.22, -0.34]].forEach(([wx, wz]) => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(wx, -0.34, wz);
      group.add(w);
    });

    // Body (torso)
    const torsoGeo = new THREE.BoxGeometry(0.28, 0.38, 0.18);
    const torsoMat = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.12;

    // Head
    const headGeo = new THREE.SphereGeometry(0.13, 8, 8);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffd0a0 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.44;

    // Helmet
    const helmGeo = new THREE.SphereGeometry(0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const helmMat = new THREE.MeshLambertMaterial({ color: 0xff4400 });
    const helm = new THREE.Mesh(helmGeo, helmMat);
    helm.position.y = 0.48;

    // Arms
    const armGeo = new THREE.BoxGeometry(0.09, 0.28, 0.09);
    const armMat = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });
    [-1, 1].forEach(side => {
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(side * 0.2, 0.1, 0);
      arm.rotation.z = side * 0.4;
      group.add(arm);
    });

    // Legs
    const legGeo = new THREE.BoxGeometry(0.1, 0.28, 0.1);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3e });
    [-1, 1].forEach(side => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(side * 0.07, -0.18, 0.04);
      group.add(leg);
    });

    group.add(board, truckF, truckB, torso, head, helm);

    // Store refs for animation
    this._boardRef = board;
    this._torsoRef = torso;
    this._headRef = head;

    return group;
  }

  setKeys(keys) { this.keys = keys; }

  update(dt, roadXAt) {
    if (!this.isAlive) return;

    // ── Steering ──
    let steerInput = 0;
    if (this.keys['ArrowLeft']  || this.keys['a'] || this.keys['A']) steerInput -= 1;
    if (this.keys['ArrowRight'] || this.keys['d'] || this.keys['D']) steerInput += 1;

    this.lateralVel += steerInput * STEER_SPEED * dt;
    this.lateralVel *= Math.pow(1 - STEER_RETURN * dt, 1); // damping
    this.lateralPos += this.lateralVel * dt;

    // Clamp to track
    const halfW = TRACK_WIDTH / 2 - 0.5;
    if (Math.abs(this.lateralPos) > halfW) {
      this.lateralPos = Math.sign(this.lateralPos) * halfW;
      this.lateralVel = 0;
    }

    // ── Crouching ──
    this.isCrouching = !!(this.keys['ArrowDown'] || this.keys['s'] || this.keys['S']);

    // ── Jump ──
    if ((this.keys[' '] || this.keys['Space']) && this.isGrounded) {
      this.velY = JUMP_FORCE;
      this.isGrounded = false;
      this._attemptTrick();
    }

    // ── Boost release ──
    if ((this.keys['Shift'] || this.keys['shift']) && this.boost > 0.05) {
      this.boosting = true;
    } else {
      this.boosting = false;
    }

    // ── Speed ──
    let accel = PASSIVE_ACCEL;
    if (this.isCrouching && this.isGrounded) accel += CROUCH_ACCEL;
    if (this.boosting) {
      accel += 40;
      this.boost = Math.max(0, this.boost - dt * 0.6);
    }

    const drag = DRAG * this.speed * this.speed;
    this.speed += (accel - drag) * dt;
    this.speed = Math.min(this.speed, MAX_SPEED);
    this.speed = Math.max(this.speed, BASE_SPEED * 0.3);

    if (this.speed > this.topSpeed) this.topSpeed = this.speed;

    // ── Vertical (jumping) ──
    if (!this.isGrounded) {
      this.velY += GRAVITY * dt;
      this.y += this.velY * dt;
      this.airTime += dt;

      if (this.y <= GROUND_Y) {
        this.y = GROUND_Y;
        this.velY = 0;
        this.isGrounded = true;
        if (this.currentTrick) {
          this.trickLanded = true;
          this._landTrick();
        }
        this.airTime = 0;
      }
    }

    // ── Distance ──
    this.distanceTraveled += this.speed * dt;

    // ── Combo decay ──
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
      }
    }

    // ── World position: skater moves in Z, road curves in X ──
    const worldZ = -this.distanceTraveled;
    const roadX = roadXAt(worldZ);
    this.mesh.position.set(roadX + this.lateralPos, this.y, worldZ);

    // ── Visual lean ──
    this._leanAngle += (-steerInput * 0.22 - this._leanAngle) * 8 * dt;
    this._boardTilt += ((this.isCrouching ? 0.18 : 0) - this._boardTilt) * 10 * dt;
    this.mesh.rotation.z = this._leanAngle;
    if (this._boardRef) this._boardRef.rotation.x = this._boardTilt;

    // Air trick animation
    if (!this.isGrounded && this.currentTrick) {
      this._animateTrick(dt);
    }
  }

  _attemptTrick() {
    const left  = this.keys['ArrowLeft']  || this.keys['a'] || this.keys['A'];
    const right = this.keys['ArrowRight'] || this.keys['d'] || this.keys['D'];
    const down  = this.keys['ArrowDown']  || this.keys['s'] || this.keys['S'];

    let trick = null;
    if (left && down)        trick = TRICKS.BACKFLIP;
    else if (left)           trick = TRICKS.MUTE;
    else if (right)          trick = TRICKS.INDY;
    else if (down)           trick = TRICKS.HEELFLIP;
    else                     trick = TRICKS.KICKFLIP;

    this.currentTrick = trick;
    this._trickRotation = 0;
  }

  _animateTrick(dt) {
    if (!this.currentTrick) return;
    this._trickRotation = (this._trickRotation || 0) + dt * 6;
    if (this._boardRef) {
      if (this.currentTrick === TRICKS.KICKFLIP || this.currentTrick === TRICKS.HEELFLIP) {
        this._boardRef.rotation.z = Math.sin(this._trickRotation) * Math.PI;
      } else if (this.currentTrick === TRICKS.BACKFLIP) {
        this.mesh.rotation.x = Math.sin(this._trickRotation * 0.7) * 1.2;
      } else {
        this._torsoRef && (this._torsoRef.rotation.x = Math.sin(this._trickRotation) * 0.4);
      }
    }
  }

  _landTrick() {
    const trick = this.currentTrick;
    this.currentTrick = null;
    this._trickRotation = 0;

    // Reset rotations
    this.mesh.rotation.x = 0;
    if (this._boardRef) { this._boardRef.rotation.z = 0; this._boardRef.rotation.x = 0; }
    if (this._torsoRef) this._torsoRef.rotation.x = 0;

    // Combo
    this.comboCount++;
    this.comboTimer = this.COMBO_WINDOW;
    const pts = trick.score * this.comboCount;

    // Boost charge
    this.boost = Math.min(1, this.boost + 0.25 + this.comboCount * 0.05);

    if (!this.bestTrick || trick.score > this.bestTrick.score) {
      this.bestTrick = trick;
    }

    return { trick, pts, combo: this.comboCount };
  }

  crash() {
    if (!this.isAlive) return;
    this.isAlive = false;
    // Ragdoll spin
    this.mesh.rotation.z = Math.PI * 0.4;
    this.mesh.rotation.x = Math.PI * 0.3;
  }

  // Called by collision system
  checkObstacleCollision(obstacleMeshes) {
    if (!this.isAlive) return false;
    const pos = this.mesh.position;
    for (const obs of obstacleMeshes) {
      const dx = obs.position.x - pos.x;
      const dz = obs.position.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const type = obs.userData.type;

      if (type === 'ramp') {
        // Ramps launch you into a jump instead of crashing
        if (dist < 3.5 && this.isGrounded && this.y < 1.0) {
          this.velY = JUMP_FORCE * 1.2;
          this.isGrounded = false;
          this._attemptTrick();
          return false;
        }
      } else if (dist < CRASH_DISTANCE) {
        return true;
      }
    }
    return false;
  }

  getWorldZ() {
    return this.mesh.position.z;
  }

  getSpeed() { return this.speed; }
  getSpeedKmh() { return Math.round(this.speed * 3.6); }
  getDistance() { return Math.round(this.distanceTraveled); }
  getBoost() { return this.boost; }
  getCombo() { return this.comboCount; }
}
