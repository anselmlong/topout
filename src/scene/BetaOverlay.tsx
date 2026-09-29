// Numbered hand moves on the wall, coloured by how hard each move is relative
// to the crux. While the climber is on the wall, tags appear as moves happen.
import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import type { Day } from '../solver/types';
import { useClimb } from '../state/climb';
import { useGame } from '../state/store';
import { frameAt, panelFrames, uvToWorld } from './wallGeometry';

export function strainColor(s: number) {
  // muted green → ochre → brick
  const stops = [
    [111, 154, 122],
    [196, 160, 72],
    [191, 91, 79],
  ];
  const t = Math.max(0, Math.min(1, s)) * 2;
  const i = Math.min(1, Math.floor(t));
  const k = t - i;
  const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * k));
  return `rgb(${c.join(',')})`;
}

export function BetaOverlay({ day }: { day: Day }) {
  const beta = useGame((s) => s.beta);
  const phase = useGame((s) => s.phase);
  const current = useClimb((s) => s.move);
  const frames = useMemo(() => panelFrames(day.wall), [day.wall]);

  const tags = useMemo(() => {
    if (!beta || !beta.result.ok) return [];
    const { moves, crux } = beta.result;
    let n = 0;
    return moves
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.limb <= 1)
      .map(({ m, i }) => {
        n++;
        const p = m.to.points[m.limb];
        const f = frameAt(frames, p.v);
        const side = m.limb === 0 ? -1 : 1;
        const pos = uvToWorld(day.wall, frames, p.u + side * 9, p.v + 7).addScaledVector(f.normal, 0.08);
        const strain = m.difficulty / Math.max(crux, 1e-6);
        return { key: i, move: i, n, pos, strain, crux: m.difficulty >= crux - 1e-9, hand: m.limb === 0 ? 'L' : 'R', dyno: m.dynamic };
      });
  }, [beta, frames, day.wall]);

  if (!tags.length) return null;
  const climbing = phase === 'climbing';
  return (
    <group>
      {tags
        .filter((t) => !climbing || t.move <= current)
        .map((t) => (
          <Html key={t.key} position={t.pos} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
            <div
              className={`beta-tag ${t.crux ? 'crux' : ''} ${climbing && t.move === current ? 'now' : ''}`}
              style={{ background: strainColor(t.strain) }}
            >
              <span className="n">{t.n}</span>
              <span className="h">{t.hand}</span>
              {t.dyno && <span className="h">↯</span>}
              {t.crux && <span className="crux-label">crux</span>}
            </div>
          </Html>
        ))}
    </group>
  );
}
