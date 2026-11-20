// scene_walk.js — 【仮の場面】骨格の動作確認用スタブ。次の実装役が丸ごと書き直す。
//   export createWalkScene(ctx) → { group, env, envIntensity, background, enter(), exit(), update(dt, t) }
//   光る球を光る円までドラッグ → 'park' へ（途中で離すとやさしく戻る）。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function createWalkScene(ctx) {
  const { engine, input, audio, hints, tweens, state } = ctx;
  const group = new THREE.Group();
  const pm = new THREE.PMREMGenerator(engine.renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.4), new THREE.MeshStandardMaterial({ color: 0x9fb48a, roughness: 0.8 }));
  board.position.y = -0.015; board.receiveShadow = true; group.add(board);
  const home = new THREE.Vector3(-0.15, 0.03, 0.05);
  const goal = new THREE.Vector3(0.16, 0, -0.06);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 40, 24), new THREE.MeshStandardMaterial({ color: 0xff9a7a, emissive: 0xff7a50, emissiveIntensity: 0.4, roughness: 0.35 }));
  ball.position.copy(home); ball.castShadow = true; group.add(ball);

  const sun = new THREE.DirectionalLight(0xfff6e8, 2.6);
  sun.position.set(0.5, 1.2, 0.3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 3 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.003;
  group.add(sun); group.add(new THREE.HemisphereLight(0xdfefff, 0x8a9a6a, 0.6));

  let tw = null, hs = [], done = false;
  const grab = new THREE.Vector3(), p = new THREE.Vector3();
  return {
    group, env, envIntensity: 0.45, background: new THREE.Color(0xcfe3f0),
    enter() {
      tw = tweens.scope(); done = false;
      ball.position.copy(home);
      engine.setShot({
        target: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1.3, 1),
        points: [new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, 0, -0.2), new THREE.Vector3(-0.3, 0, 0.2), new THREE.Vector3(0.3, 0, 0.2)],
      }, 0);
      audio.setMusic('walk'); audio.setAmbience('park');
      hs.push(input.add(ball, {
        down(ev) { if (done) return; tw.kill(ball.position); audio.play('pick'); ev.plane(0.03, grab).sub(ball.position); },
        move(ev) { if (done) return; ev.plane(0.03, p).sub(grab); p.y = 0.05; ball.position.copy(p); },
        up() {
          if (done) return;
          if (Math.hypot(ball.position.x - goal.x, ball.position.z - goal.z) < 0.07) {
            done = true; audio.play('place'); state.shake = 0.5;
            tw.to(ball.position, { x: goal.x, y: 0.03, z: goal.z }, 0.2).promise.then(() => ctx.goto('park'));
          } else {
            audio.play('boing');
            tw.to(ball.position, { x: home.x, y: home.y, z: home.z }, 0.5, { ease: 'outBack' });
          }
        },
      }));
      hints.set({
        target: ball, gesture: 'drag', dest: goal, destRadius: 0.05,
        nudge() { audio.play('rattle', { vol: 0.6 }); tw.to(ball.position, { y: 0.05 }, 0.1).promise.then(() => tw.to(ball.position, { y: home.y }, 0.4, { ease: 'outBounce' })); },
      });
    },
    exit() { for (const h of hs) h.remove(); hs = []; if (tw) tw.killAll(); },
    update() {},
  };
}
