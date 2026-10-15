import * as THREE from 'three';
import { textTexture } from './textures.js';
import { WALLS, HOUSE, EXT_T } from './floorplan.js';

const SERIF = '"Cormorant Garamond", "Cormorant", Georgia, "Times New Roman", serif';

/** Waits (briefly) for the web font so canvas text doesn't render in a fallback face. */
export async function waitForFonts(timeout = 2500) {
  if (!document.fonts?.load) return;
  const load = Promise.all([
    document.fonts.load(`600 120px ${SERIF}`),
    document.fonts.load(`italic 500 60px ${SERIF}`),
  ]).catch(() => {});
  await Promise.race([load, new Promise((r) => setTimeout(r, timeout))]);
}

/** Name plaque above the front door and lettering above the entrance-hall arch. */
export function buildSigns(artist, tagline) {
  const group = new THREE.Group();
  group.name = 'signs';
  const name = artist.toUpperCase();

  // ── exterior plaque ──
  const face = HOUSE.z1 + EXT_T / 2;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.4, 0.035),
    new THREE.MeshStandardMaterial({ color: 0x24302d, roughness: 0.55 }),
  );
  board.position.set(0, 2.88, face + 0.0175);
  board.castShadow = true;
  const plaqueTex = textTexture(
    [{ text: name, size: 150, weight: 600, family: SERIF, color: '#e8d7a8', letterSpacing: 26, y: 0.54 }],
    { width: 2048, height: 390 },
  );
  const plaqueText = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.4),
    new THREE.MeshStandardMaterial({ map: plaqueTex, transparent: true, roughness: 0.4, metalness: 0.6 }),
  );
  plaqueText.position.set(0, 2.88, face + 0.0365);
  group.add(board, plaqueText);

  // ── lettering above the arch, facing into the entrance hall ──
  const wall = WALLS.find((w) => w.id === 'front-gallery');
  const arch = wall.openings.find((o) => o.type === 'arch');
  const lines = [{ text: name, size: 132, weight: 600, family: SERIF, color: '#3a3833', letterSpacing: 30, y: 0.42 }];
  if (tagline) {
    lines.push({ text: tagline, size: 60, weight: 500, family: SERIF, color: '#6d675d', letterSpacing: 4, y: 0.84 });
  }
  const letterTex = textTexture(lines, { width: 2048, height: 300 });
  const letters = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 0.425),
    new THREE.MeshStandardMaterial({ map: letterTex, transparent: true, roughness: 0.8 }),
  );
  const archTop = arch.y1 + 0.075; // top of the architrave
  letters.position.set(arch.c, archTop + 0.03 + 0.425 / 2 - 0.02, wall.at + wall.t / 2 + 0.003);
  group.add(letters);
  return group;
}
