import type { BiomeId } from "./types";

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private ambience?: OscillatorNode;
  private ambienceGain?: GainNode;
  private pulse = 0;
  private bossMode = false;
  private bossTheme = 0;
  private currentBiome: BiomeId = "surface";

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.context.destination);
      this.startAmbience();
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  setBiome(biome: BiomeId): void {
    if (biome === this.currentBiome) return;
    this.currentBiome = biome;
    const frequencies: Record<BiomeId, number> = {
      surface: 92, stone: 58, crystal: 116, mushroom: 78, mine: 66, ruins: 73,
      lava: 46, ice: 128, poison: 51, abyss: 35, factory: 84,
    };
    if (this.context && this.ambience) {
      this.ambience.frequency.cancelScheduledValues(this.context.currentTime);
      this.ambience.frequency.linearRampToValueAtTime(frequencies[biome], this.context.currentTime + 1.8);
    }
  }

  update(dt: number): void {
    if (!this.context) return;
    this.pulse -= dt;
    if (this.pulse > 0) return;
    this.pulse = this.bossMode ? 0.42 : 2.2 + Math.random() * 2.8;
    if (this.bossMode) {
      const root = 42 + this.bossTheme % 5 * 3;
      this.tone(root, 0.18, "sawtooth", 0.12, this.bossTheme % 3 === 0 ? -8 : 0);
      this.tone(root * (this.bossTheme % 2 === 0 ? 2 : 1.5), 0.08, "square", 0.035, 0);
    } else {
      const base = this.currentBiome === "crystal" || this.currentBiome === "ice" ? 260 : 110;
      this.tone(base + Math.random() * 40, 1.4, "sine", 0.018, -20);
    }
  }

  setBossMode(enabled: boolean): void {
    this.bossMode = enabled;
    this.pulse = 0;
    if (this.context && this.ambienceGain) {
      this.ambienceGain.gain.linearRampToValueAtTime(enabled ? 0.005 : 0.025, this.context.currentTime + 0.4);
    }
  }

  setBossTheme(stage: number): void {
    this.bossTheme = Math.max(0, stage - 1);
  }

  silence(): void {
    if (this.context && this.ambienceGain) {
      this.ambienceGain.gain.linearRampToValueAtTime(0.0001, this.context.currentTime + 0.18);
    }
  }

  step(): void { this.tone(80 + Math.random() * 12, 0.045, "triangle", 0.035, -35); }
  jump(): void { this.tone(210, 0.12, "square", 0.055, 170); }
  dash(): void { this.tone(140, 0.14, "sawtooth", 0.07, -100); }
  roll(): void { this.tone(95, 0.16, "triangle", 0.05, -30); }
  attack(): void { this.tone(180, 0.09, "sawtooth", 0.065, -80); }
  mine(): void { this.tone(130 + Math.random() * 45, 0.055, "square", 0.05, -55); }
  breakBlock(): void { this.noise(0.14, 0.07, 900); }
  chest(): void {
    [330, 494, 659].forEach((frequency, index) => window.setTimeout(() => this.tone(frequency, 0.2, "sine", 0.07, 25), index * 90));
  }
  buy(): void { this.tone(440, 0.08, "square", 0.055, 110); }
  hurt(): void { this.noise(0.16, 0.1, 500); this.tone(90, 0.18, "sawtooth", 0.06, -45); }
  heal(): void { this.tone(300, 0.28, "sine", 0.06, 240); }
  level(): void {
    [262, 330, 392, 523].forEach((frequency, index) => window.setTimeout(() => this.tone(frequency, 0.24, "triangle", 0.06, 20), index * 75));
  }
  warning(): void {
    this.noise(0.7, 0.14, 260);
    [92, 69, 46].forEach((frequency, index) => window.setTimeout(() => this.tone(frequency, 0.42, "sawtooth", 0.18, -20), index * 260));
  }
  heartbeat(): void {
    this.tone(54, 0.09, "sine", 0.1, -7);
    window.setTimeout(() => this.tone(48, 0.07, "sine", 0.08, -5), 120);
  }
  bossHit(): void { this.tone(72, 0.11, "square", 0.075, -25); }
  victory(): void {
    this.setBossMode(false);
    [196, 247, 294, 392, 494].forEach((frequency, index) => window.setTimeout(() => this.tone(frequency, 0.48, "triangle", 0.085, 18), index * 120));
  }

  private startAmbience(): void {
    if (!this.context || !this.master) return;
    this.ambience = this.context.createOscillator();
    this.ambienceGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    this.ambience.type = "sine";
    this.ambience.frequency.value = 92;
    this.ambienceGain.gain.value = 0.025;
    filter.type = "lowpass";
    filter.frequency.value = 170;
    this.ambience.connect(filter).connect(this.ambienceGain).connect(this.master);
    this.ambience.start();
  }

  private tone(frequency: number, duration: number, wave: OscillatorType, volume: number, bend: number): void {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + bend), this.context.currentTime + duration);
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
  }

  private noise(duration: number, volume: number, cutoff: number): void {
    if (!this.context || !this.master) return;
    const buffer = this.context.createBuffer(1, this.context.sampleRate * duration, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }
}
