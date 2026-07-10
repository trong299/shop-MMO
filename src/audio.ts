export class AudioSystem {
  private context: AudioContext | null = null;
  private musicTimer = 0;
  private beat = 0;
  private bossMode = false;

  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume();
  }

  setBossMode(active: boolean): void {
    this.bossMode = active;
    this.beat = 0;
  }

  update(dt: number): void {
    if (!this.context || this.context.state !== "running") return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const bossNotes = [82.41, 98, 110, 123.47, 110, 98];
    const ambientNotes = [110, 146.83, 164.81, 146.83, 123.47, 146.83, 196, 164.81];
    const notes = this.bossMode ? bossNotes : ambientNotes;
    this.tone(notes[this.beat % notes.length], this.bossMode ? 0.12 : 0.06, "triangle", this.bossMode ? 0.19 : 0.35);
    if (this.bossMode && this.beat % 2 === 0) this.tone(55, 0.08, "sine", 0.12);
    this.beat += 1;
    this.musicTimer = this.bossMode ? 0.24 : 0.52;
  }

  shoot(): void {
    this.tone(330, 0.045, "square", 0.06, 130);
  }

  hit(critical = false): void {
    this.tone(critical ? 780 : 190, critical ? 0.11 : 0.045, critical ? "sine" : "square", 0.09, critical ? 250 : -80);
  }

  chest(): void {
    [523, 659, 784].forEach((note, index) => {
      window.setTimeout(() => this.tone(note, 0.12, "sine", 0.11), index * 80);
    });
  }

  level(): void {
    [392, 523, 659, 784].forEach((note, index) => {
      window.setTimeout(() => this.tone(note, 0.09, "triangle", 0.1), index * 60);
    });
  }

  dash(): void {
    this.tone(180, 0.09, "sawtooth", 0.05, 450);
  }

  hurt(): void {
    this.tone(90, 0.11, "sawtooth", 0.12, -40);
  }

  boss(): void {
    this.tone(55, 0.6, "sawtooth", 0.14, 30);
  }

  victory(): void {
    [261, 329, 392, 523].forEach((note, index) => {
      window.setTimeout(() => this.tone(note, 0.22, "triangle", 0.13), index * 120);
    });
  }

  private tone(
    frequency: number,
    volume: number,
    type: OscillatorType,
    duration: number,
    slide = 0,
  ): void {
    if (!this.context || this.context.state !== "running") return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}
