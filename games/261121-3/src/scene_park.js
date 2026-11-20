// scene_park.js — 【仮の場面】骨格の動作確認用スタブ。次の実装役が丸ごと書き直す。
//   export createParkScene(ctx) → { group, env, envIntensity, background, enter(), exit(), update(dt, t) }
//   光る球をタップ → ctx.nextDay()（次の朝の台所へ）。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function createParkScene(ctx) {
  const { engine, input, audio, hints, tweens } = ctx;
  const group = new THREE.Group();
  const pm = new THREE.PMREMGenerator(engine.renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.01, 0.6), new THREE.MeshStandardMaterial({ color: 0xd25b5b, roughness: 0.9 }));
  board.position.y = -0.005; board.receiveShadow = true; group.add(board);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 40, 24), new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffc860, emissiveIntensity: 0.5, roughness: 0.3 }));
  ball.position.set(0, 0.04, 0); ball.castShadow = true; group.add(ball);

  const sun = new THREE.DirectionalLight(0xfff2da, 2.4);
  sun.position.set(-0.4, 1.2, -0.3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 3 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.003;
  group.add(sun); group.add(new THREE.HemisphereLight(0xdfefff, 0x6a7a4a, 0.7));

  let tw = null, hs = [];
  return {
    group, env, envIntensity: 0.45, background: new THREE.Color(0xbfdcae),
    enter() {
      tw = tweens.scope();
      engine.setShot({
        target: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1.5, 1),
        points: [new THREE.Vector3(-0.4, 0, -0.3), new THREE.Vector3(0.4, 0, -0.3), new THREE.Vector3(-0.4, 0, 0.3), new THREE.Vector3(0.4, 0, 0.3)],
      }, 0);
      audio.setMusic('picnic'); audio.setAmbience('park');
      hs.push(input.add(ball, {
        tap() { audio.play('same'); engine.shake(0.01, 0.3); hints.clear(); ctx.nextDay(); },
      }));
      hints.set({
        target: ball, gesture: 'tap',
        nudge() { audio.play('leaf'); tw.to(ball.position, { y: 0.06 }, 0.12).promise.then(() => tw.to(ball.position, { y: 0.04 }, 0.5, { ease: 'outBounce' })); },
      });
    },
    exit() { for (const h of hs) h.remove(); hs = []; if (tw) tw.killAll(); },
    update() {},
  };
}
