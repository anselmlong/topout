// Pointer handling shared by everything you can place onto: wall panels and volumes.
// A hit anywhere is projected back to wall-plane (u, v).
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import { holdNear } from '../game/rules';
import { spotsOf } from '../game/spots';
import { useGame } from '../state/store';

/** How far past a hold's edge a fingertip still grabs it, in screen pixels (a ~44 px target on a foot chip). */
const TOUCH_SLOP_PX = 18;

export function useWallPointer(toUv: (e: ThreeEvent<PointerEvent>) => { u: number; v: number }) {
  const hover = useGame((s) => s.hover);
  const leave = useGame((s) => s.leave);
  const height = useThree((s) => s.size.height);
  const down = useRef<{ x: number; y: number } | null>(null);
  /**
   * A finger that lands just beside a hold (and missed its mesh) means that hold: pick it
   * up, or select a Start/Finish spot's hold.
   */
  const grabNear = (e: ThreeEvent<PointerEvent>, u: number, v: number) => {
    const s = useGame.getState();
    if (e.pointerType === 'mouse' || !e.isPrimary || e.button !== 0) return;
    if (s.draggingId || s.armed || s.viewing || s.done || s.phase !== 'setting' || !s.day) return;
    // Centimetres per screen pixel at the touch's depth.
    const fov = ((e.camera as PerspectiveCamera).fov ?? 45) * (Math.PI / 180);
    const cmPerPx = (200 * e.distance * Math.tan(fov / 2)) / Math.max(1, height);
    const slop = TOUCH_SLOP_PX * cmPerPx;
    const spots = spotsOf(s.day).filter((h) => s.spots[h.id]).map((h) => ({ ...h, ...s.spots[h.id] }));
    const near = holdNear([...s.placed, ...spots], u, v, slop);
    if (!near) return;
    if (spots.some((h) => h.id === near.id)) {
      s.select(near.id);
      // The lift isn't a tap on empty wall: don't let it deselect.
      down.current = null;
    } else s.startDrag(near.id);
  };
  return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const { u, v } = toUv(e);
      hover(u, v);
    },
    onPointerOut: () => leave(),
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      down.current = { x: e.clientX, y: e.clientY };
      const { u, v } = toUv(e);
      grabNear(e, u, v);
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
