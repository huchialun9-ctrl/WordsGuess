let ctx: AudioContext | null = null;
let muted = false;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function syncMuted(value: boolean): void {
  muted = value;
}

export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
}

export function installAudioResume(): () => void {
  const onVis = () => {
    if (document.visibilityState === "visible") unlockAudio();
  };
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}

function tone(freq: number, dur: number, type: OscillatorType, level: number, when = 0): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2400, t);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function playKey(): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * 0.028));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = (1 - i / len) ** 3;
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(1200, t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.16, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(hp);
  hp.connect(gain);
  gain.connect(ctx.destination);
  src.start(t);
  tone(540 + Math.random() * 70, 0.028, "square", 0.018);
}

export function playSubmit(): void {
  tone(494, 0.07, "triangle", 0.045);
}

export function playInvalid(): void {
  tone(128, 0.14, "sawtooth", 0.04);
  tone(86, 0.18, "square", 0.028, 0.05);
}

export function playWin(): void {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    tone(freq, 0.2, "triangle", 0.055, i * 0.09);
  });
}

export function playLose(): void {
  [392, 349.23, 311.13, 261.63].forEach((freq, i) => {
    tone(freq, 0.22, "triangle", 0.05, i * 0.11);
  });
}
