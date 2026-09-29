// Tiny synthesized sound effects. No audio files: everything is shaped noise
// and sine blips, kept soft to match the muted look. Browsers only allow audio
// after a user gesture, so the context is created lazily on first use.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
let noiseBuf: AudioBuffer | null = null;

function readMuted() {
  try {
    return localStorage.getItem('topout:muted') === '1';
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('topout:muted', m ? '1' : '0');
  } catch {
    // Not persisted; fine.
  }
  if (master) master.gain.value = m ? 0 : 0.55;
}

/** Call from a user gesture (pointerdown) so later sounds are allowed. */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function ready() {
  return ctx && master && noiseBuf && !muted ? ctx : null;
}

function noise(c: AudioContext, t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5, dur + 0.05);
  return f;
}

function tone(c: AudioContext, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', glideTo?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  /** Hand slaps a hold. Harder holds sound a little sharper. */
  grab(strain = 0.5) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.07, 900 + strain * 900, 1.2, 0.5);
    tone(c, t, 180 + strain * 60, 0.09, 0.25, 'triangle', 120);
  },
  foot() {
    const c = ready();
    if (!c) return;
    noise(c, c.currentTime, 0.05, 600, 1, 0.22);
  },
  chalk() {
    const c = ready();
    if (!c) return;
    noise(c, c.currentTime, 0.25, 3500, 0.6, 0.08, 'highpass');
  },
  whoosh() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    const f = noise(c, t, 0.4, 400, 0.8, 0.18);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
  },
  /** Body lands on the pad; `v` ~ impact speed per step. */
  thud(v: number) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    const g = Math.min(0.9, 0.2 + v * 12);
    tone(c, t, 95, 0.25, g, 'sine', 45);
    noise(c, t, 0.12, 300, 0.7, g * 0.5, 'lowpass');
  },
  topout() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 523.25, 0.35, 0.18, 'triangle');
    tone(c, t + 0.11, 659.25, 0.35, 0.16, 'triangle');
    tone(c, t + 0.22, 783.99, 0.6, 0.16, 'triangle');
  },
  fail() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 330, 0.25, 0.12, 'triangle', 300);
    tone(c, t + 0.16, 262, 0.45, 0.12, 'triangle', 220);
  },
  click() {
    const c = ready();
    if (!c) return;
    noise(c, c.currentTime, 0.03, 2400, 2, 0.12);
  },
};
