let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bgGain: GainNode | null = null;
let bgStarted = false;
let lastHoverSound = 0;
let enabled = false;

export function soundEnabled() { return enabled; }

export function setSoundEnabled(next: boolean) {
  enabled = next;
  if (enabled) {
    resumeAudio();
    master?.gain.setTargetAtTime(0.55, audio().currentTime, 0.1);
    startAmbient();
  } else if (master) {
    master.gain.setTargetAtTime(0, audio().currentTime, 0.08);
  }
}

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function resumeAudio() {
  if (!enabled) return;
  const c = audio();
  if (c.state === "suspended") c.resume();
}

// Short crystalline ping — artwork click / chip / result tap
export function playClick(pitch = 1.0) {
  if (!enabled) return;
  const c = audio();
  if (c.state === "suspended") c.resume();
  const t = c.currentTime;

  const osc = c.createOscillator();
  const env = c.createGain();
  const hpf = c.createBiquadFilter();

  osc.type = "sine";
  osc.frequency.setValueAtTime(1600 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.1);

  hpf.type = "highpass";
  hpf.frequency.value = 600;
  hpf.Q.value = 0.5;

  env.gain.setValueAtTime(0.13, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

  osc.connect(hpf);
  hpf.connect(env);
  env.connect(master!);
  osc.start(t);
  osc.stop(t + 0.16);
}

// Very soft high tick — hover over an artwork (throttled in main.ts)
export function playHover() {
  if (!enabled) return;
  const now = performance.now();
  if (now - lastHoverSound < 80) return; // max ~12/s
  lastHoverSound = now;

  const c = audio();
  if (c.state === "suspended") return; // don't resume just for hover
  const t = c.currentTime;

  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = "sine";
  osc.frequency.value = 3200;

  env.gain.setValueAtTime(0.028, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

  osc.connect(env);
  env.connect(master!);
  osc.start(t);
  osc.stop(t + 0.05);
}

// Warm ambient pad — a soft consonant triad instead of a low drone, meant to feel
// closer to a calm room tone than a rumble.
export function startAmbient() {
  if (!enabled) return;
  if (bgStarted) return;
  bgStarted = true;

  const c = audio();
  bgGain = c.createGain();
  bgGain.gain.value = 0;
  bgGain.connect(master!);

  // Fade in slowly over 8 s — a gentle arrival, not a wall of sound
  bgGain.gain.linearRampToValueAtTime(0.05, c.currentTime + 8);

  // A-major triad across two octaves: root, major third, fifth, octave —
  // consonant and warm rather than a bare open-fifth drone
  const notes: [number, number][] = [
    [110, 0.20],    // A2 — root
    [138.6, 0.13],  // C#3 — major third
    [164.8, 0.15],  // E3 — fifth
    [220, 0.09],    // A3 — octave
  ];
  for (const [freq, vol] of notes) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 4; // gentle micro-detune for warmth
    g.gain.value = vol;

    // Slow, soft tremolo — breathing, not throbbing
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    lfo.frequency.value = 0.05 + Math.random() * 0.04;
    lfoG.gain.value = 0.012;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    lfo.start();

    osc.connect(g);
    g.connect(bgGain!);
    osc.start();
  }

  // Airy, band-passed noise bed instead of a low rumble — reads as soft room tone
  const bufLen = c.sampleRate * 2;
  const noiseBuf = c.createBuffer(1, bufLen, c.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) nd[i] = Math.random() * 2 - 1;
  const noise = c.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;

  const bpf = c.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.value = 900;
  bpf.Q.value = 0.5;

  const noiseG = c.createGain();
  noiseG.gain.value = 0.018;

  noise.connect(bpf);
  bpf.connect(noiseG);
  noiseG.connect(bgGain!);
  noise.start();

  // High shimmer — slow breathing overtone, in key with the triad, kept quiet
  const shimmer = c.createOscillator();
  const shimG = c.createGain();
  shimmer.type = "sine";
  shimmer.frequency.value = 1108.7; // C#6
  shimG.gain.value = 0;

  const sLfo = c.createOscillator();
  const sLfoG = c.createGain();
  sLfo.frequency.value = 0.035;
  sLfoG.gain.value = 0.009;
  sLfo.connect(sLfoG);
  sLfoG.connect(shimG.gain);
  sLfo.start();

  shimmer.connect(shimG);
  shimG.connect(bgGain!);
  shimmer.start();
}
