// Pointer handling shared by everything you can place onto: wall panels and volumes.
// A hit anywhere is projected back to wall-plane (u, v).
import type { ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import { useGame } from '../state/store';

export function useWallPointer(toUv: (e: ThreeEvent<PointerEvent>) => { u: number; v: number }) {
  const hover = useGame((s) => s.hover);
  const leave = useGame((s) => s.leave);
  const down = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const { u, v } = toUv(e);
      hover(u, v);
    },
    onPointerOut: () => leave(),
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      down.current = { x: e.clientX, y: e.clientY };
      const { u, v } = toUv(e);
      hover(u, v);
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      const s = useGame.getState();
      if (s.draggingId) return s.endDrag();
      const d = down.current;
      down.current = null;
      if (!d && s.trayDrag && s.armed) return s.commit();
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
      if (s.armed) s.commit();
      else s.select(null);
    },
  };
}
