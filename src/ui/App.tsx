import { useEffect, useRef } from 'react';
import { unlockAudio } from '../audio/sfx';
import { Scene } from '../scene/Scene';
import { warmSolver } from '../solver/client';
import { markHelpSeen, seenHelp } from '../state/persist';
import { useGame } from '../state/store';
import { ActionBar, Brief, ClimbTicker, Controls, SelectionBar, TopBar, Tray, ViewingBanner } from './Hud';
import { GradesModal, HelpModal, PracticeModal, ResultModal, StatsModal } from './Modals';
import { Tour } from './Tour';

const ROTATE_STEP = Math.PI / 12;

export function App() {
  const status = useGame((s) => s.status);
  const load = useGame((s) => s.load);
  const toast = useGame((s) => s.toast);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load().then(() => {
      warmSolver();
      // First visit: point at the real Start/Finish, tray and Test button rather than a wall of text.
      if (!seenHelp()) useGame.getState().setModal('tour');
    });
    // A route link opened in an already-open tab only changes the hash.
    const onHash = () => location.hash.includes('r=') && load();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const s = useGame.getState();
      if ((e.metaKey || e.ctrlKey) && !s.modal) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) s.undo();
        else if ((key === 'z' && e.shiftKey) || key === 'y') s.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (s.modal) {
        if (e.key === 'Escape') {
          if (s.modal === 'tour') markHelpSeen();
          s.setModal(null);
        }
        return;
      }
      if (e.key === 'q' || e.key === 'Q') s.rotate(ROTATE_STEP);
      else if (e.key === 'e' || e.key === 'E') s.rotate(-ROTATE_STEP);
      else if (e.key === 'Delete' || e.key === 'Backspace') s.remove();
      else if (e.key === 'Escape' && s.phase === 'climbing') s.skipClimb();
      else if (e.key === 'Escape') {
        s.arm(null);
        s.select(null);
      } else return;
      e.preventDefault();
    };
    const onDown = () => unlockAudio();
    const onUp = () => {
      const s = useGame.getState();
      s.endDrag();
      if (s.trayDrag) useGame.setState({ trayDrag: false });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  // Wheel rotates the armed/selected hold. Non-passive so it doesn't scroll the page.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = useGame.getState();
      // Otherwise the wheel falls through to the camera zoom.
      if (!s.armed && !s.selectedId) return;
      e.preventDefault();
      s.rotate(Math.sign(e.deltaY) * -ROTATE_STEP);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [status]);

  // A tap on the wall selects on press, so the hold or spot picker can appear right under the
  // finger; the browser's click after the lift then lands on it (swapping a start jug for
  // whatever button is there). Swallow that one click if it lands outside the wall.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let pending = false;
    let timer = 0;
    const onStageDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      pending = true;
      clearTimeout(timer);
      timer = window.setTimeout(() => (pending = false), 1000);
    };
    const onAnyDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) pending = false;
    };
    const onClick = (e: MouseEvent) => {
      if (!pending) return;
      pending = false;
      if (el.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', onStageDown, true);
    window.addEventListener('pointerdown', onAnyDown, true);
    window.addEventListener('click', onClick, true);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('pointerdown', onStageDown, true);
      window.removeEventListener('pointerdown', onAnyDown, true);
      window.removeEventListener('click', onClick, true);
    };
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
      <ClimbTicker />
      <ActionBar />
      <ViewingBanner />
      <HelpModal />
      <Tour />
      <GradesModal />
      <ResultModal />
      <StatsModal />
      <PracticeModal />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
