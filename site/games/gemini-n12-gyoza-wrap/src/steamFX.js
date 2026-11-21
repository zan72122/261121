import * as THREE from 'three';

/**
 * Photographic curling kitchen steam wisps & sizzling micro-droplets.
 * Uses soft multi-octave wispy sprites with gentle upward buoyancy, turbulent curl, and smooth alpha fade.
 */
export class SteamSystem {
  constructor(scene, steamTex) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.puffs = [];
    this.maxPuffs = 34;

    for (let i = 0; i < this.maxPuffs; i++) {
      const mat = new THREE.SpriteMaterial({
        map: steamTex,
        color: new THREE.Color('#fffaf3'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({
        sprite,
        age: 0,
        life: 1,
        vx: 0,
        vy: 0,
        vz: 0,
        rotSpeed: 0,
        baseScale: 0.05,
        peakOpacity: 0.25,
      });
    }

    // Tiny sizzling oil/water bubbles popping around gyoza bases on the hot plate
    this.bubbles = [];
    const bGeo = new THREE.SphereGeometry(0.0022, 8, 6);
    const bMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#fff5dc'),
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.72,
    });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(bGeo, bMat);
      m.visible = false;
      this.group.add(m);
      this.bubbles.push({
        mesh: m,
        age: 0,
        life: 0.4,
        baseX: 0,
        baseY: 0,
        baseZ: 0,
        maxScale: 1,
      });
    }

    this.spawnTimer = 0;
    this.bubbleTimer = 0;
  }

  emitPuff(origin, {
    spread = 0.065,
    speedY = 0.075,
    scale = 0.065,
    opacity = 0.24,
    life = 1.9,
  } = {}) {
    const p = this.puffs.find((x) => !x.sprite.visible);
    if (!p) return;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * spread;
    p.sprite.position.set(
      origin.x + Math.cos(ang) * rad,
      origin.y + Math.random() * 0.012,
      origin.z + Math.sin(ang) * rad
    );
    p.age = 0;
    p.life = life * (0.8 + Math.random() * 0.45);
    p.vx = (Math.random() - 0.5) * 0.016;
    p.vy = speedY * (0.8 + Math.random() * 0.4);
    p.vz = (Math.random() - 0.5) * 0.014 - 0.006; // subtle kitchen draft toward rear
    p.baseScale = scale * (0.8 + Math.random() * 0.45);
    p.peakOpacity = opacity * (0.8 + Math.random() * 0.35);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.rotSpeed = (Math.random() - 0.5) * 0.45;
    p.sprite.scale.setScalar(p.baseScale * 0.45);
    p.sprite.material.opacity = 0;
    p.sprite.visible = true;
  }

  emitBurst(origin, count = 14, opts = {}) {
    for (let i = 0; i < count; i++) {
      this.emitPuff(origin, opts);
    }
  }

  emitBubble(origin, spread = 0.075) {
    const b = this.bubbles.find((x) => !x.mesh.visible);
    if (!b) return;
    const a = Math.random() * Math.PI * 2;
    const r = 0.015 + Math.random() * spread;
    b.baseX = origin.x + Math.cos(a) * r;
    b.baseY = origin.y + 0.001;
    b.baseZ = origin.z + Math.sin(a) * r;
    b.age = 0;
    b.life = 0.22 + Math.random() * 0.26;
    b.maxScale = 0.65 + Math.random() * 1.15;
    b.mesh.position.set(b.baseX, b.baseY, b.baseZ);
    b.mesh.scale.setScalar(0.1);
    b.mesh.visible = true;
  }

  /** Pre-seed natural mid-flight steam wisps (for instant realism at t=0) */
  prewarm(origin, count = 10, opts = {}) {
    for (let i = 0; i < count; i++) {
      this.emitPuff(origin, opts);
    }
    for (let step = 0; step < 30; step++) {
      this.update(0.05, null, 0, 0);
    }
  }

  update(dt, emitOrigin, steamRate = 0, sizzleRate = 0, puffOpts = {}) {
    if (emitOrigin && steamRate > 0) {
      this.spawnTimer += dt * steamRate;
      while (this.spawnTimer >= 1) {
        this.spawnTimer -= 1;
        this.emitPuff(emitOrigin, puffOpts);
      }
    }
    if (emitOrigin && sizzleRate > 0) {
      this.bubbleTimer += dt * sizzleRate;
      while (this.bubbleTimer >= 1) {
        this.bubbleTimer -= 1;
        this.emitBubble(emitOrigin, puffOpts.spread || 0.072);
      }
    }

    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if (!p.sprite.visible) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.visible = false;
        continue;
      }
      // Organic curl drift
      const curl = Math.sin(p.age * 2.4 + i) * 0.012;
      p.sprite.position.x += (p.vx + curl) * dt;
      p.sprite.position.y += p.vy * (1 - t * 0.35) * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.material.rotation += p.rotSpeed * dt;

      const s = p.baseScale * (0.45 + Math.pow(t, 0.72) * 1.65);
      p.sprite.scale.setScalar(s);

      // Soft photographic fade-in and gentle dissipation
      const fadeIn = Math.min(1, t / 0.22);
      const fadeOut = Math.pow(Math.max(0, 1 - t), 1.45);
      p.sprite.material.opacity = p.peakOpacity * fadeIn * fadeOut;
    }

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (!b.mesh.visible) continue;
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        b.mesh.visible = false;
        continue;
      }
      const pop = Math.sin(t * Math.PI);
      b.mesh.scale.set(b.maxScale * pop, b.maxScale * pop * 0.65, b.maxScale * pop);
      b.mesh.position.y = b.baseY + Math.sin(t * Math.PI) * 0.0028;
    }
  }
}
