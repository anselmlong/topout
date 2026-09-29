// Chalk puffs: short-lived dust particles, instanced.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

interface Grain {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

const MAX = 260;
const grains: Grain[] = [];

/** Emit a puff at `at`, drifting out along `normal`. */
export function puff(at: THREE.Vector3, normal: THREE.Vector3, amount = 14, spread = 0.5) {
  for (let i = 0; i < amount; i++) {
    if (grains.length >= MAX) grains.shift();
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 - 0.1, Math.random() - 0.5)
      .multiplyScalar(spread)
      .addScaledVector(normal, 0.35 + Math.random() * 0.3);
    grains.push({
      p: at.clone().addScaledVector(normal, 0.03),
      v: dir,
      age: 0,
      life: 0.7 + Math.random() * 0.8,
      size: 0.012 + Math.random() * 0.02,
    });
  }
}

export function ChalkDust() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const step = Math.min(dt, 0.05);
    let n = 0;
    for (let i = grains.length - 1; i >= 0; i--) {
      const g = grains[i];
      g.age += step;
      if (g.age > g.life) {
        grains.splice(i, 1);
        continue;
      }
      // Dust slows fast and drifts down slowly.
      g.v.multiplyScalar(1 - 3.5 * step);
      g.v.y -= 0.15 * step;
      g.p.addScaledVector(g.v, step);
    }
    for (const g of grains) {
      const k = g.age / g.life;
      const size = g.size * (1 + k * 2.5) * (1 - k * k);
      mesh.setMatrixAt(n++, m.compose(g.p, q, s.set(size, size, size)));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX]} frustumCulled={false} raycast={() => null}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#f7f5f0" transparent opacity={0.55} depthWrite={false} />
    </instancedMesh>
  );
}
