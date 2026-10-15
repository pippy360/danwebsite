import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ROOMS, WALL_HEIGHT as H } from './floorplan.js';
import { SUN_DIR } from './outdoors.js';

/**
 * Image-based ambient light (RoomEnvironment), a shadow-casting late-afternoon sun that
 * streams in through the windows, and warm lamps in each room (skipped on low quality).
 */
export function setupLighting(scene, renderer, { quality = 'high' } = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose?.();
  pmrem.dispose();
  scene.environmentIntensity = quality === 'low' ? 0.62 : 0.42;

  const hemi = new THREE.HemisphereLight(0xeaf1ff, 0xa08c74, quality === 'low' ? 0.7 : 0.45);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe2b8, 3.4);
  const target = new THREE.Vector3(0, 0, -7);
  sun.position.copy(target).addScaledVector(SUN_DIR, 45);
  sun.target.position.copy(target);
  sun.castShadow = true;
  const size = quality === 'low' ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  const cam = sun.shadow.camera;
  cam.left = -19;
  cam.right = 19;
  cam.top = 19;
  cam.bottom = -19;
  cam.near = 15;
  cam.far = 85;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);

  const lamps = [];
  if (quality !== 'low') {
    for (const r of ROOMS) {
      for (const [x, z] of r.lights) {
        const lamp = new THREE.PointLight(0xffd4a0, r.id === 'gallery' ? 7 : 6, 10, 1.6);
        lamp.position.set(x, H - 1.25, z);
        scene.add(lamp);
        lamps.push(lamp);
      }
    }
  }
  return { sun, hemi, lamps };
}
