export function hash2(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

export function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const smoothX = tx * tx * (3 - 2 * tx);
  const smoothY = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * smoothX;
  const bottom = c + (d - c) * smoothX;
  return top + (bottom - top) * smoothY;
}

export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed || 1;
  }

  next(): number {
    this.state |= 0;
    this.state = this.state + 0x6d2b79f5 | 0;
    let value = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)];
  }

  shuffle<T>(values: T[]): T[] {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const other = this.int(0, index);
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  }
}
