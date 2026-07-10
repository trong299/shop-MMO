import { biomeOrder, biomes, tileHardness, tileResource } from "./data";
import { hash2, noise2, Random } from "./random";
import {
  CHUNK_SIZE,
  CHUNK_TILES,
  TILE,
  Tile,
  type Biome,
  type BiomeId,
  type Chunk,
  type ChunkChest,
  type Rarity,
  type SaveData,
  type TileId,
  type Vec2,
} from "./types";

const keyOf = (x: number, y: number): string => `${x},${y}`;
const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor);
const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

export interface MineResult {
  broken: boolean;
  progress: number;
  resource?: keyof SaveData["resources"];
  tile?: TileId;
}

export interface Arena {
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: Vec2;
  exitLeft: Vec2;
  exitRight: Vec2;
}

export class World {
  private readonly chunks = new Map<string, Chunk>();
  private readonly modified: Record<string, TileId>;
  private readonly opened: Set<string>;
  private frame = 0;
  private miningTarget = "";
  private miningProgress = 0;

  constructor(
    public seed: number,
    private readonly stage: number,
    save: SaveData,
  ) {
    this.modified = save.modifiedTiles;
    this.opened = new Set(save.openedChests);
  }

  reset(seed: number, save: SaveData): void {
    this.seed = seed;
    this.chunks.clear();
    this.opened.clear();
    save.openedChests.forEach((id) => this.opened.add(id));
    this.miningTarget = "";
    this.miningProgress = 0;
  }

  updateAround(x: number, y: number): void {
    this.frame += 1;
    const centerX = floorDiv(x, CHUNK_SIZE);
    const centerY = floorDiv(y, CHUNK_SIZE);
    for (let cy = centerY - 1; cy <= centerY + 1; cy += 1) {
      for (let cx = centerX - 2; cx <= centerX + 2; cx += 1) {
        this.loadChunk(cx, cy).lastTouched = this.frame;
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - centerX) > 3 || Math.abs(chunk.cy - centerY) > 2) this.chunks.delete(key);
    }
  }

  get loadedChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  getBiomeAt(tx: number, ty: number): Biome {
    if (ty < 20) return biomes.surface;
    const depthBand = Math.floor((ty - 20) / 74);
    const region = Math.floor(tx / 150);
    const variation = Math.floor(hash2(region, depthBand, this.seed) * biomeOrder.length);
    const index = mod(depthBand + region + variation + this.stage - 1, biomeOrder.length);
    return biomes[biomeOrder[index]];
  }

  surfaceAt(tx: number): number {
    return 14 + Math.floor(noise2(tx * 0.035, 0, this.seed + 91) * 6);
  }

  getTile(tx: number, ty: number): TileId {
    const changed = this.modified[keyOf(tx, ty)];
    if (changed !== undefined) return changed;
    const cx = floorDiv(tx, CHUNK_TILES);
    const cy = floorDiv(ty, CHUNK_TILES);
    const chunk = this.loadChunk(cx, cy);
    return chunk.tiles[mod(ty, CHUNK_TILES) * CHUNK_TILES + mod(tx, CHUNK_TILES)] as TileId;
  }

  setTile(tx: number, ty: number, tile: TileId): void {
    this.modified[keyOf(tx, ty)] = tile;
    const cx = floorDiv(tx, CHUNK_TILES);
    const cy = floorDiv(ty, CHUNK_TILES);
    const chunk = this.loadChunk(cx, cy);
    chunk.tiles[mod(ty, CHUNK_TILES) * CHUNK_TILES + mod(tx, CHUNK_TILES)] = tile;
  }

  isSolid(tile: TileId): boolean {
    return tile !== Tile.Air &&
      tile !== Tile.Water &&
      tile !== Tile.Lava &&
      tile !== Tile.Poison &&
      tile !== Tile.Spikes &&
      tile !== Tile.Ladder &&
      tile !== Tile.Rope;
  }

  isPlatform(tile: TileId): boolean {
    return tile === Tile.Platform;
  }

  isClimbable(tile: TileId): boolean {
    return tile === Tile.Ladder || tile === Tile.Rope;
  }

  isLiquid(tile: TileId): boolean {
    return tile === Tile.Water || tile === Tile.Lava || tile === Tile.Poison;
  }

  mine(tx: number, ty: number, dt: number, power: number): MineResult {
    const tile = this.getTile(tx, ty);
    const hardness = tileHardness[tile];
    if (hardness === undefined) {
      this.miningTarget = "";
      this.miningProgress = 0;
      return { broken: false, progress: 0 };
    }
    const target = keyOf(tx, ty);
    if (this.miningTarget !== target) {
      this.miningTarget = target;
      this.miningProgress = 0;
    }
    this.miningProgress += dt * power / hardness;
    if (this.miningProgress < 1) return { broken: false, progress: this.miningProgress, tile };
    this.setTile(tx, ty, Tile.Air);
    this.miningProgress = 0;
    this.miningTarget = "";
    return { broken: true, progress: 1, resource: tileResource[tile], tile };
  }

  cancelMining(): void {
    this.miningTarget = "";
    this.miningProgress = 0;
  }

  getMiningProgress(tx: number, ty: number): number {
    return this.miningTarget === keyOf(tx, ty) ? this.miningProgress : 0;
  }

  nearestChest(x: number, y: number, radius = Number.POSITIVE_INFINITY): ChunkChest | undefined {
    let closest: ChunkChest | undefined;
    let closestDistance = radius;
    for (const chunk of this.chunks.values()) {
      for (const chest of chunk.chests) {
        if (chest.opened) continue;
        const distance = Math.hypot(chest.x - x, chest.y - y);
        if (distance < closestDistance) {
          closest = chest;
          closestDistance = distance;
        }
      }
    }
    return closest;
  }

  openChest(chest: ChunkChest, save: SaveData): void {
    chest.opened = true;
    this.opened.add(chest.id);
    save.openedChests = [...this.opened];
  }

  createArena(worldX: number, worldY: number): Arena {
    const centerTx = Math.floor(worldX / TILE) + 18;
    const centerTy = Math.max(26, Math.floor(worldY / TILE));
    const left = centerTx - 17;
    const right = centerTx + 17;
    const top = centerTy - 9;
    const bottom = centerTy + 9;
    for (let ty = top; ty <= bottom; ty += 1) {
      for (let tx = left; tx <= right; tx += 1) {
        const border = ty === top || ty === bottom || tx === left || tx === right;
        this.setTile(tx, ty, border ? Tile.Factory : Tile.Air);
      }
    }
    const platformStride = 4 + this.stage % 3;
    for (let tx = left + 2; tx < right - 1; tx += platformStride) {
      const platformY = bottom - 3 - (Math.abs(tx + this.stage) % 3) * 2;
      this.setTile(tx, platformY, Tile.Platform);
      this.setTile(tx + 1, platformY, Tile.Platform);
    }
    if (this.stage >= 4) {
      for (let tx = left + 6 + this.stage % 4; tx < right - 5; tx += 10) {
        this.setTile(tx, bottom - 1, this.stage % 2 === 0 ? Tile.Lava : Tile.Spikes);
        this.setTile(tx + 1, bottom - 1, this.stage % 2 === 0 ? Tile.Lava : Tile.Spikes);
      }
    }
    const exitLeft = { x: left, y: bottom - 3 };
    const exitRight = { x: right, y: bottom - 3 };
    this.setTile(exitLeft.x, exitLeft.y, Tile.Factory);
    this.setTile(exitRight.x, exitRight.y, Tile.Factory);
    return {
      left: left * TILE,
      right: (right + 1) * TILE,
      top: top * TILE,
      bottom: (bottom + 1) * TILE,
      center: { x: (centerTx + 0.5) * TILE, y: (bottom - 2.5) * TILE },
      exitLeft,
      exitRight,
    };
  }

  unlockArena(arena: Arena): void {
    this.setTile(arena.exitLeft.x, arena.exitLeft.y, Tile.Air);
    this.setTile(arena.exitRight.x, arena.exitRight.y, Tile.Air);
  }

  private loadChunk(cx: number, cy: number): Chunk {
    const key = keyOf(cx, cy);
    const existing = this.chunks.get(key);
    if (existing) return existing;
    const chunk = this.generateChunk(cx, cy);
    this.chunks.set(key, chunk);
    return chunk;
  }

  private generateChunk(cx: number, cy: number): Chunk {
    const tiles = new Uint8Array(CHUNK_TILES * CHUNK_TILES);
    const centerTx = cx * CHUNK_TILES + CHUNK_TILES / 2;
    const centerTy = cy * CHUNK_TILES + CHUNK_TILES / 2;
    const biome = this.getBiomeAt(centerTx, centerTy).id;
    for (let localY = 0; localY < CHUNK_TILES; localY += 1) {
      for (let localX = 0; localX < CHUNK_TILES; localX += 1) {
        const tx = cx * CHUNK_TILES + localX;
        const ty = cy * CHUNK_TILES + localY;
        const generated = this.generateTile(tx, ty);
        tiles[localY * CHUNK_TILES + localX] = this.modified[keyOf(tx, ty)] ?? generated;
      }
    }
    this.decorateChunk(cx, cy, tiles);
    const chests = this.generateChests(cx, cy, tiles);
    const hazards = this.generateHazards(cx, cy, tiles);
    return { cx, cy, biome, tiles, chests, hazards, lastTouched: this.frame };
  }

  private generateTile(tx: number, ty: number): TileId {
    const surface = this.surfaceAt(tx);
    if (ty < surface) return Tile.Air;
    if (ty === surface) return Tile.Dirt;
    if (ty <= surface + 3) return Tile.Dirt;
    const depth = ty - surface;
    const biome = this.getBiomeAt(tx, ty).id;
    const broad = noise2(tx * 0.045, ty * 0.045, this.seed + 204);
    const detail = noise2(tx * 0.105, ty * 0.105, this.seed + 877);
    const windingTunnel = Math.abs(ty - (30 + Math.sin(tx * 0.045 + this.seed) * 5)) < 2.4;
    const cave = depth > 6 && (broad * 0.74 + detail * 0.26 > 0.565 || windingTunnel);
    if (cave) {
      const pool = hash2(tx, ty, this.seed + 333);
      if (biome === "lava" && pool < 0.065 && this.generateTileBase(tx, ty + 1) !== Tile.Air) return Tile.Lava;
      if (biome === "ice" && pool < 0.045) return Tile.Water;
      if (biome === "poison" && pool < 0.05) return Tile.Poison;
      return Tile.Air;
    }
    return this.generateTileBase(tx, ty);
  }

  private generateTileBase(tx: number, ty: number): TileId {
    const biome = this.getBiomeAt(tx, ty).id;
    const ore = hash2(tx, ty, this.seed + 607);
    const vein = noise2(tx * 0.19, ty * 0.19, this.seed + 922);
    if (biome === "ice" && ore < 0.35) return Tile.Ice;
    if (biome === "factory" && ore < 0.32) return Tile.Factory;
    if (biome === "lava" && ore < 0.17) return Tile.Obsidian;
    if (biome === "crystal" && vein > 0.71) return ore < 0.2 ? Tile.Diamond : Tile.Crystal;
    if (biome === "abyss" && vein > 0.74) return Tile.Magic;
    if (vein > 0.77 && ore < 0.2) return Tile.Gold;
    if (vein > 0.7 && ore < 0.42) return Tile.Iron;
    if (vein > 0.63 && ore < 0.58) return Tile.Copper;
    if ((biome === "crystal" || biome === "ruins") && ore > 0.987) return Tile.Explosive;
    return Tile.Stone;
  }

  private decorateChunk(cx: number, cy: number, tiles: Uint8Array): void {
    const biome = this.getBiomeAt(cx * CHUNK_TILES + 32, cy * CHUNK_TILES + 32).id;
    for (let y = 1; y < CHUNK_TILES - 1; y += 1) {
      for (let x = 1; x < CHUNK_TILES - 1; x += 1) {
        const index = y * CHUNK_TILES + x;
        if (tiles[index] !== Tile.Air) continue;
        const below = tiles[index + CHUNK_TILES] as TileId;
        const tx = cx * CHUNK_TILES + x;
        const ty = cy * CHUNK_TILES + y;
        const roll = hash2(tx, ty, this.seed + 1220);
        if (this.isSolid(below) && roll < 0.018) tiles[index] = Tile.Spikes;
        else if ((biome === "mine" || biome === "ruins") && roll > 0.985) tiles[index] = Tile.Platform;
        else if (biome === "mine" && roll > 0.977 && roll < 0.982) {
          for (let ladderY = y; ladderY > Math.max(1, y - 7); ladderY -= 1) {
            const ladderIndex = ladderY * CHUNK_TILES + x;
            if (tiles[ladderIndex] === Tile.Air) tiles[ladderIndex] = Tile.Ladder;
          }
        } else if (biome === "mushroom" && roll > 0.988) {
          for (let ropeY = y; ropeY > Math.max(1, y - 8); ropeY -= 1) {
            const ropeIndex = ropeY * CHUNK_TILES + x;
            if (tiles[ropeIndex] === Tile.Air) tiles[ropeIndex] = Tile.Rope;
          }
        }
      }
    }
  }

  private generateChests(cx: number, cy: number, tiles: Uint8Array): ChunkChest[] {
    const chests: ChunkChest[] = [];
    const random = new Random(Math.floor(hash2(cx, cy, this.seed + 77) * 0x7fffffff));
    const attempts = random.int(1, 4);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const x = random.int(3, CHUNK_TILES - 4);
      for (let y = 4; y < CHUNK_TILES - 3; y += 1) {
        const index = y * CHUNK_TILES + x;
        if (tiles[index] !== Tile.Air || !this.isSolid(tiles[index + CHUNK_TILES] as TileId)) continue;
        const id = `${this.seed}:${cx}:${cy}:${attempt}`;
        const rarityRoll = random.next() + this.stage * 0.015 + Math.max(0, cy) * 0.006;
        const rarity: Rarity = rarityRoll > 1.18 ? "Ancient" : rarityRoll > 0.98 ? "Mythic" : rarityRoll > 0.79 ? "Legendary" : rarityRoll > 0.55 ? "Epic" : rarityRoll > 0.28 ? "Rare" : "Common";
        chests.push({
          id,
          x: (cx * CHUNK_TILES + x + 0.5) * TILE,
          y: (cy * CHUNK_TILES + y + 0.5) * TILE,
          opened: this.opened.has(id),
          locked: random.next() > 0.72,
          rarity,
        });
        break;
      }
    }
    return chests;
  }

  private generateHazards(cx: number, cy: number, tiles: Uint8Array): Chunk["hazards"] {
    const hazards: Chunk["hazards"] = [];
    const random = new Random(Math.floor(hash2(cx, cy, this.seed + 1500) * 0x7fffffff));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (random.next() > 0.44) continue;
      const x = random.int(4, CHUNK_TILES - 5);
      for (let y = 5; y < CHUNK_TILES - 4; y += 1) {
        const index = y * CHUNK_TILES + x;
        if (tiles[index] !== Tile.Air || !this.isSolid(tiles[index + CHUNK_TILES] as TileId)) continue;
        const worldX = (cx * CHUNK_TILES + x + 0.5) * TILE;
        const worldY = (cy * CHUNK_TILES + y + 0.5) * TILE;
        hazards.push({
          id: `${cx}:${cy}:hazard:${attempt}`,
          kind: random.pick(["boulder", "saw", "falling"] as const),
          x: worldX,
          y: worldY,
          baseX: worldX,
          baseY: worldY,
          vx: 0,
          vy: 0,
          phase: random.next() * Math.PI * 2,
          active: true,
        });
        break;
      }
    }
    return hazards;
  }
}
