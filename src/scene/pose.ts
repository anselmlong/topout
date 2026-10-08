// Skeleton poses for the climber, in world metres. Shared by the on-wall posing
// (Climber.tsx) and the topout, which leaves the wall and stands on the deck.
import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export const ARM = [0.3, 0.29];
export const LEG = [0.43, 0.42];
export const TORSO = 0.5;

export interface Pose {
  hip: THREE.Vector3;
  chest: THREE.Vector3;
  head: THREE.Vector3;
  shoulders: [THREE.Vector3, THREE.Vector3];
  elbows: [THREE.Vector3, THREE.Vector3];
  hands: [THREE.Vector3, THREE.Vector3];
  pelvis: [THREE.Vector3, THREE.Vector3];
  knees: [THREE.Vector3, THREE.Vector3];
  feet: [THREE.Vector3, THREE.Vector3];
  /** World direction the fingers point for each hand on a hold (wrapping the incut). */
  grips?: [THREE.Vector3 | null, THREE.Vector3 | null];
  /** Where the climber is looking (a hold), or undefined to face straight ahead. */
  look?: THREE.Vector3 | null;
}

/** Two-bone IK: the middle joint and the (reach-clamped) end, bending toward `pole`. */
export function ik(root: THREE.Vector3, target: THREE.Vector3, [a, b]: number[], pole: THREE.Vector3) {
  const dir = target.clone().sub(root);
  const d = Math.min(dir.length(), a + b - 1e-4);
  dir.normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
  perp.normalize();
  const joint = root.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * Math.sqrt(1 - cosA * cosA));
  const end = root.clone().addScaledVector(dir, d);
  return { joint, end };
}
