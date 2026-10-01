// While a handhold is being placed or dragged, an arc on the wall shows how far
// the climber can reach from the closest handhold below (solid: static, dashed:
// only as a dyno), with a line to the ghost coloured by which zone it lands in.
import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { reachArc, reachGuide, type ReachZone } from '../game/reach';
import { BODY, GRIP, wallHeight } from '../solver/model';
import type { Day } from '../solver/types';
import { useGame } from '../state/store';
import { PALETTE } from './palette';
import { frameAt, uvToWorld, type PanelFrame } from './wallGeometry';

const ZONE_COLOR: Record<ReachZone, string> = { static: PALETTE.ghostOk, dyno: '#c4a048', out: PALETTE.ghostBad };

export function ReachGuide({ day, frames }: { day: Day; frames: PanelFrame[] }) {
  const armed = useGame((s) => s.armed);
  const ghost = useGame((s) => s.ghost);
  const dragging = useGame((s) => (s.draggingId ? s.placed.find((h) => h.id === s.draggingId) : undefined));
  const placed = useGame((s) => s.placed);
  const type = dragging?.type ?? (armed && armed.type !== 'volume' ? armed.type : null);
  const guide = ghost && type && GRIP[type].hand ? reachGuide([...day.start, ...placed], ghost.u, ghost.v, dragging?.id) : null;
  const anchor = guide?.anchor;

  // Arc segments that stay on the wall, lifted off the surface so they don't z-fight.
  const arcs = useMemo(() => {
    if (!anchor) return null;
    const top = wallHeight(day.wall);
    const toWorld = (u: number, v: number) => uvToWorld(day.wall, frames, u, v).addScaledVector(frameAt(frames, u, v).normal, 0.004);
    const runs = (scale: number) => {
      const out: THREE.Vector3[][] = [];
      let run: THREE.Vector3[] = [];
      for (const p of reachArc(anchor, scale)) {
        if (p.u >= 0 && p.u <= day.wall.width && p.v >= 0 && p.v <= top) run.push(toWorld(p.u, p.v));
        else if (run.length) (run.length > 1 && out.push(run), (run = []));
      }
      if (run.length > 1) out.push(run);
      return out;
    };
    return { stat: runs(1), dyno: runs(BODY.dynoLimit), from: toWorld(anchor.u, anchor.v) };
  }, [anchor, day.wall, frames]);

  if (!guide || !arcs || !ghost) return null;
  const to = uvToWorld(day.wall, frames, ghost.u, ghost.v).addScaledVector(frameAt(frames, ghost.u, ghost.v).normal, 0.004);
  const color = ZONE_COLOR[guide.zone];
  return (
    <group renderOrder={2}>
      {arcs.stat.map((pts, i) => (
        <Line key={`s${i}`} points={pts} color={PALETTE.select} lineWidth={2} transparent opacity={0.75} raycast={() => null} />
      ))}
      {arcs.dyno.map((pts, i) => (
        <Line key={`d${i}`} points={pts} color={PALETTE.select} lineWidth={1.5} dashed dashSize={0.06} gapSize={0.05} transparent opacity={0.6} raycast={() => null} />
      ))}
      <Line points={[arcs.from, to]} color={color} lineWidth={2} dashed dashSize={0.03} gapSize={0.03} raycast={() => null} />
    </group>
  );
}
