// scene_kitchen.js — 【仮の場面】骨格の動作確認用スタブ。次の実装役が丸ごと書き直す。
//   export createKitchenScene(ctx) → { group, env, envIntensity, background, enter(), exit(), update(dt, t) }
//   板の上の光る球をタップ → 'walk' へ。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function createKitchenScene(ctx) {
  const { engine, input, audio, hints, tweens } = ctx;
  const group = new THREE.Group();
  const pm = new THREE.PMREMGenerator(engine.renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.4), new THREE.MeshStandardMaterial({ color: 0xc89b6d, roughness: 0.6 }));
  board.position.y = -0.015; board.receiveShadow = true; group.add(board);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 40, 24), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffb347, emissiveIntensity: 0.6, roughness: 0.3 }));
  ball.position.set(0.05, 0.035, 0.02); ball.castShadow = true; group.add(ball);
  const other = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }));
  other.position.set(-0.15, 0.01, -0.06); other.castShadow = true; group.add(other);

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-0.6, 1.2, 0.4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 3 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.003;
  group.add(sun); group.add(new THREE.HemisphereLight(0xeef3ff, 0xb59a78, 0.6));

  let tw = null, hs = [];
  return {
    group, env, envIntensity: 0.45, background: new THREE.Color(0xe9e1d4),
    enter() {
      tw = tweens.scope();
      ball.scale.setScalar(1); ball.rotation.set(0, 0, 0);
      engine.setShot({
        target: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1.1, 1),
        points: [new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, 0, -0.2), new THREE.Vector3(-0.3, 0, 0.2), new THREE.Vector3(0.3, 0, 0.2)],
      }, 0);
      audio.setMusic('morning'); audio.setAmbience('kitchen');
      hs.push(input.add(ball, {
        down() { audio.play('press'); tw.to(ball.scale, { x: 0.9, y: 0.85, z: 0.9 }, 0.08, { ease: 'outCubic' }); },
        up() { tw.to(ball.scale, { x: 1, y: 1, z: 1 }, 0.35, { ease: 'outBack' }); },
        tap() { audio.play('popBig'); hints.clear(); ctx.goto('walk'); },
      }));
      hs.push(input.add(other, {
        down() { audio.play('ceramic'); tw.to(other.rotation, { z: 0.08 }, 0.06).promise.then(() => tw.to(other.rotation, { z: 0 }, 0.4, { ease: 'outElastic' })); },
      }));
      hints.set({
        target: ball, gesture: 'tap',
        nudge() { audio.play('tick'); tw.to(ball.rotation, { z: 0.25 }, 0.07).promise.then(() => tw.to(ball.rotation, { z: 0 }, 0.6, { ease: 'outElastic' })); },
      });
    },
    exit() { for (const h of hs) h.remove(); hs = []; if (tw) tw.killAll(); },
    update(dt, t) { ball.material.emissiveIntensity = 0.45 + 0.2 * Math.sin(t * 3); },
  };
}
