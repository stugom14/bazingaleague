import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ── Constants ──────────────────────────────────────────────────────────────
export const TRACK_WIDTH = 18;
const SEGMENT_LENGTH = 24;
const SEGMENTS_VISIBLE = 40;
const SEGMENTS_AHEAD = 60;
const CURVE_MAX = 0.38;
const CURVE_SMOOTH = 0.06;

// Obstacle types
export const OBS = {
  ROCK:   'rock',
  BARRIER:'barrier',
  RAMP:   'ramp',
  RAIL:   'rail',
};

// ── Track Segment ──────────────────────────────────────────────────────────
export class TrackSegment {
  constructor(index, x, z, curvature) {
    this.index = index;
    this.x = x;         // world X center
    this.z = z;         // world Z start (negative = into screen)
    this.curvature = curvature;
    this.obstacle = null;
    this.mesh = null;
    this.obstacleMesh = null;
  }
}

// ── Materials (shared) ─────────────────────────────────────────────────────
const roadMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
const edgeMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
const snowMat = new THREE.MeshLambertMaterial({ color: 0xddeeff });
const rockMat = new THREE.MeshLambertMaterial({ color: 0x555544 });
const barrierMat = new THREE.MeshLambertMaterial({ color: 0xff6600 });
const rampMat = new THREE.MeshLambertMaterial({ color: 0x887755 });
const railMat = new THREE.MeshLambertMaterial({ color: 0xaaaacc });

// ── Track Manager ──────────────────────────────────────────────────────────
export class TrackManager {
  constructor(scene) {
    this.scene = scene;
    this.segments = [];
    this.nextIndex = 0;
    this.currentCurve = 0;
    this.targetCurve = 0;
    this.curveTimer = 0;

    // Terrain chunks (side scenery)
    this.terrainChunks = [];

    // Pre-generate initial segments
    for (let i = 0; i < SEGMENTS_AHEAD; i++) this._addSegment();
  }

  _randomCurveTarget() {
    const bias = (Math.random() - 0.5) * 2;
    return bias * CURVE_MAX;
  }

  _addSegment() {
    const i = this.nextIndex++;
    this.curveTimer--;
    if (this.curveTimer <= 0) {
      this.targetCurve = this._randomCurveTarget();
      this.curveTimer = 8 + Math.floor(Math.random() * 14);
    }
    this.currentCurve += (this.targetCurve - this.currentCurve) * CURVE_SMOOTH;

    const prevZ = this.segments.length > 0
      ? this.segments[this.segments.length - 1].z - SEGMENT_LENGTH
      : 0;
    const prevX = this.segments.length > 0
      ? this.segments[this.segments.length - 1].x
      : 0;

    const newX = prevX + this.currentCurve * SEGMENT_LENGTH;
    const seg = new TrackSegment(i, newX, prevZ, this.currentCurve);

    // Obstacle placement (starts after first 10 segments)
    if (i > 10 && Math.random() < 0.18) {
      const obsTypes = [OBS.ROCK, OBS.ROCK, OBS.BARRIER, OBS.RAMP, OBS.RAIL];
      seg.obstacle = obsTypes[Math.floor(Math.random() * obsTypes.length)];
    }

    this._buildSegmentMesh(seg);
    this.segments.push(seg);
  }

  _buildSegmentMesh(seg) {
    const group = new THREE.Group();
    group.position.set(seg.x, 0, seg.z);

    // Road surface
    const roadGeo = new THREE.PlaneGeometry(TRACK_WIDTH, SEGMENT_LENGTH);
    roadGeo.rotateX(-Math.PI / 2);
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.position.y = 0;
    group.add(road);

    // Road edges (white lines)
    [-TRACK_WIDTH / 2 + 0.3, TRACK_WIDTH / 2 - 0.3].forEach(ex => {
      const edgeGeo = new THREE.PlaneGeometry(0.4, SEGMENT_LENGTH);
      edgeGeo.rotateX(-Math.PI / 2);
      const edge = new THREE.Mesh(edgeGeo, edgeMat);
      edge.position.set(ex, 0.01, 0);
      group.add(edge);
    });

    // Snow shoulders
    [-1, 1].forEach(side => {
      const snowGeo = new THREE.PlaneGeometry(10, SEGMENT_LENGTH);
      snowGeo.rotateX(-Math.PI / 2);
      const snow = new THREE.Mesh(snowGeo, snowMat);
      snow.position.set(side * (TRACK_WIDTH / 2 + 5), -0.05, 0);
      group.add(snow);
    });

    // Center dashes
    if (seg.index % 2 === 0) {
      const dashGeo = new THREE.PlaneGeometry(0.25, 4);
      dashGeo.rotateX(-Math.PI / 2);
      const dash = new THREE.Mesh(dashGeo, edgeMat);
      dash.position.set(0, 0.01, 0);
      group.add(dash);
    }

    seg.mesh = group;
    this.scene.add(group);

    // Obstacle
    if (seg.obstacle) {
      const obs = this._buildObstacle(seg.obstacle);
      if (obs) {
        // Random lateral placement
        const laneX = (Math.random() - 0.5) * (TRACK_WIDTH - 4);
        obs.position.set(seg.x + laneX, 0, seg.z - SEGMENT_LENGTH * 0.4);
        obs.userData.segIndex = seg.index;
        obs.userData.type = seg.obstacle;
        obs.userData.laneX = laneX; // relative to segment center
        seg.obstacleMesh = obs;
        this.scene.add(obs);
      }
    }

    // Side scenery (trees / rocks)
    this._addScenery(seg);
  }

  _buildObstacle(type) {
    switch (type) {
      case OBS.ROCK: {
        const g = new THREE.DodecahedronGeometry(0.9 + Math.random() * 0.6, 0);
        const m = new THREE.Mesh(g, rockMat);
        m.rotation.y = Math.random() * Math.PI;
        m.position.y = 0.5;
        return m;
      }
      case OBS.BARRIER: {
        const group = new THREE.Group();
        for (let b = -1; b <= 1; b++) {
          const g = new THREE.BoxGeometry(0.25, 1.2, 0.8);
          const m = new THREE.Mesh(g, barrierMat);
          m.position.set(b * 1.6, 0.6, 0);
          group.add(m);
        }
        const topG = new THREE.BoxGeometry(3.7, 0.18, 0.3);
        const top = new THREE.Mesh(topG, barrierMat);
        top.position.set(0, 1.28, 0);
        group.add(top);
        return group;
      }
      case OBS.RAMP: {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0); shape.lineTo(3.5, 0);
        shape.lineTo(3.5, 1.4); shape.lineTo(0, 0.1); shape.closePath();
        const extSettings = { depth: TRACK_WIDTH * 0.5, bevelEnabled: false };
        const g = new THREE.ExtrudeGeometry(shape, extSettings);
        const m = new THREE.Mesh(g, rampMat);
        m.rotation.y = Math.PI / 2;
        m.position.set(-TRACK_WIDTH * 0.25, 0, -1);
        return m;
      }
      case OBS.RAIL: {
        const group = new THREE.Group();
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6);
        [-2, 2].forEach(px => {
          const pole = new THREE.Mesh(poleGeo, railMat);
          pole.position.set(px, 0.55, 0);
          group.add(pole);
        });
        const railGeo = new THREE.CylinderGeometry(0.07, 0.07, 4.2, 8);
        railGeo.rotateZ(Math.PI / 2);
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(0, 1.05, 0);
        group.add(rail);
        return group;
      }
      default: return null;
    }
  }

  _addScenery(seg) {
    // Pine trees on sides
    [-1, 1].forEach(side => {
      if (Math.random() < 0.6) {
        const tx = seg.x + side * (TRACK_WIDTH / 2 + 2 + Math.random() * 8);
        const tz = seg.z - SEGMENT_LENGTH * Math.random();
        const tree = this._makeTree(tx, tz);
        this.scene.add(tree);
        this.terrainChunks.push({ mesh: tree, z: tz });
      }
    });
  }

  _makeTree(x, z) {
    const group = new THREE.Group();
    const h = 2.5 + Math.random() * 3;
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, h * 0.35, 6);
    const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a3520 }));
    trunk.position.y = h * 0.175;

    const leafGeo = new THREE.ConeGeometry(0.8 + Math.random() * 0.4, h * 0.8, 7);
    const leaf = new THREE.Mesh(leafGeo, new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.08 + Math.random() * 0.05, 0.25 + Math.random() * 0.1, 0.08)
    }));
    leaf.position.y = h * 0.35 + h * 0.4;

    // Snow cap
    const snowCapGeo = new THREE.ConeGeometry(0.35, h * 0.2, 6);
    const snowCap = new THREE.Mesh(snowCapGeo, snowMat);
    snowCap.position.y = h * 0.35 + h * 0.8 - 0.1;

    group.add(trunk, leaf, snowCap);
    group.position.set(x, 0, z);
    return group;
  }

  // Called each frame with skater's world Z position
  update(skaterZ) {
    // Remove segments that are too far behind
    while (
      this.segments.length > 0 &&
      this.segments[0].z > skaterZ + SEGMENT_LENGTH * 4
    ) {
      const old = this.segments.shift();
      this.scene.remove(old.mesh);
      if (old.obstacleMesh) this.scene.remove(old.obstacleMesh);
    }

    // Remove old scenery
    for (let i = this.terrainChunks.length - 1; i >= 0; i--) {
      if (this.terrainChunks[i].z > skaterZ + SEGMENT_LENGTH * 4) {
        this.scene.remove(this.terrainChunks[i].mesh);
        this.terrainChunks.splice(i, 1);
      }
    }

    // Generate new segments ahead
    const frontZ = this.segments[this.segments.length - 1]?.z ?? 0;
    while (frontZ - (-skaterZ) < SEGMENTS_AHEAD * SEGMENT_LENGTH) {
      this._addSegment();
    }
  }

  // Get the road X center at a given world Z (for camera + curve displacement)
  getRoadXAt(z) {
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (z >= s.z - SEGMENT_LENGTH && z <= s.z) {
        return s.x;
      }
    }
    return 0;
  }

  // Returns nearby obstacle meshes for collision detection
  getNearbyObstacles(skaterZ) {
    const result = [];
    for (const seg of this.segments) {
      if (!seg.obstacleMesh) continue;
      if (Math.abs(seg.z - skaterZ) < SEGMENT_LENGTH * 2) {
        result.push(seg.obstacleMesh);
      }
    }
    return result;
  }
}
