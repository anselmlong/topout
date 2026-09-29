import { useEffect, useRef } from 'react';
import { Scene } from '../scene/Scene';
import { seenHelp } from '../state/persist';
import { useGame } from '../state/store';
import { ActionBar, Brief, Controls, SelectionBar, TopBar, Tray, ViewingBanner } from './Hud';
import { HelpModal, ResultModal, StatsModal } from './Modals';

const ROTATE_STEP = Math.PI / 12;

export function App() {
  const status = useGame((s) => s.status);
  const load = useGame((s) => s.load);
  const toast = useGame((s) => s.toast);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load().then(() => {
      if (!seenHelp()) useGame.getState().setModal('help');
    });
    // A route link opened in an already-open tab only changes the hash.
    const onHash = () => location.hash.includes('r=') && load();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const s = useGame.getState();
      if (s.modal) {
        if (e.key === 'Escape') s.setModal(null);
        return;
      }
      if (e.key === 'q' || e.key === 'Q') s.rotate(ROTATE_STEP);
      else if (e.key === 'e' || e.key === 'E') s.rotate(-ROTATE_STEP);
      else if (e.key === 'Delete' || e.key === 'Backspace') s.remove();
      else if (e.key === 'Escape') {
        s.arm(null);
        s.select(null);
      } else return;
      e.preventDefault();
    };
    const onUp = () => {
      const s = useGame.getState();
      s.endDrag();
      if (s.trayDrag) useGame.setState({ trayDrag: false });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Wheel rotates the armed/selected hold. Non-passive so it doesn't scroll the page.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = useGame.getState();
      if (s.lookAround || (!s.armed && !s.selectedId)) return;
      e.preventDefault();
      s.rotate(Math.sign(e.deltaY) * -ROTATE_STEP);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="splash">
        <span className="wordmark">Topout</span>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="stage" ref={stage}>
        <Scene />
      </div>
      <TopBar />
      <div className="hud">
        <div className="hud-left">
          <Brief />
          <Controls />
        </div>
        <Tray />
      </div>
      <SelectionBar />
      <ActionBar />
      <ViewingBanner />
      <HelpModal />
      <ResultModal />
      <StatsModal />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
