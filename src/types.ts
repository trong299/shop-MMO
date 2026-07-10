export const TILE = 24;
export const CHUNK_TILES = 64;
export const CHUNK_SIZE = TILE * CHUNK_TILES;

export const Tile = {
  Air: 0,
  Dirt: 1,
  Stone: 2,
  Copper: 3,
  Iron: 4,
  Gold: 5,
  Crystal: 6,
  Diamond: 7,
  Magic: 8,
  Obsidian: 9,
  Lava: 10,
  Water: 11,
  Spikes: 12,
  Platform: 13,
  Ladder: 14,
  Rope: 15,
  Poison: 16,
  Explosive: 17,
  Ice: 18,
  Factory: 19,
} as const;

export type TileId = typeof Tile[keyof typeof Tile];
export type Vec2 = { x: number; y: number };
export type BiomeId =
  | "surface"
  | "stone"
  | "crystal"
  | "mushroom"
  | "mine"
  | "ruins"
  | "lava"
  | "ice"
  | "poison"
  | "abyss"
  | "factory";

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary" | "Mythic" | "Ancient";
export type EquipmentSlot = "Weapon" | "Helmet" | "Armor" | "Boots" | "Ring" | "Amulet" | "Artifact" | "Pet";
export type ResourceId = "stone" | "copper" | "iron" | "goldOre" | "crystal" | "diamond" | "magic" | "obsidian";

export interface Biome {
  id: BiomeId;
  name: string;
  sky: string;
  far: string;
  mid: string;
  near: string;
  stone: string;
  edge: string;
  accent: string;
  fog: string;
  gravity: number;
}

export interface ChunkChest {
  id: string;
  x: number;
  y: number;
  opened: boolean;
  locked: boolean;
  rarity: Rarity;
}

export interface ChunkHazard {
  id: string;
  kind: "boulder" | "saw" | "falling";
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  phase: number;
  active: boolean;
}

export interface Chunk {
  cx: number;
  cy: number;
  biome: BiomeId;
  tiles: Uint8Array;
  chests: ChunkChest[];
  hazards: ChunkHazard[];
  lastTouched: number;
}

export interface EquipmentStats {
  attack?: number;
  defense?: number;
  hp?: number;
  speed?: number;
  crit?: number;
  mining?: number;
  mana?: number;
  cooldown?: number;
}

export interface Equipment {
  id: string;
  name: string;
  slot: EquipmentSlot;
  rarity: Rarity;
  level: number;
  icon: string;
  stats: EquipmentStats;
  effect?: string;
}

export interface RewardChoice {
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  tag: string;
  choose: () => void;
}

export interface MerchantOffer {
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  price: number;
  sold: boolean;
  buy: () => boolean;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  facing: -1 | 1;
  grounded: boolean;
  onWall: -1 | 0 | 1;
  onLadder: boolean;
  dropping: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  armor: number;
  attack: number;
  mining: number;
  speed: number;
  crit: number;
  level: number;
  xp: number;
  xpNext: number;
  coyote: number;
  jumpBuffer: number;
  jumps: number;
  dashCooldown: number;
  dashTime: number;
  rollTime: number;
  attackCooldown: number;
  attackTime: number;
  combo: number;
  comboTimer: number;
  skillCooldown: number;
  invulnerable: number;
  potionCooldown: number;
  potions: number;
  ultimate: number;
  animation: string;
  animationTime: number;
}

export interface Boss {
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
  phase: number;
  cooldown: number;
  contactDamage: number;
  flash: number;
  dead: boolean;
}

export interface Projectile {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  hostile: boolean;
  color: string;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  glow: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  critical: boolean;
}

export interface SaveData {
  version: number;
  stage: number;
  seed: number;
  gold: number;
  keys: number;
  stones: number;
  materials: number;
  permanent: {
    attack: number;
    defense: number;
    hp: number;
    speed: number;
    crit: number;
    mining: number;
  };
  resources: Record<ResourceId, number>;
  equipment: Equipment[];
  equipped: Partial<Record<EquipmentSlot, string>>;
  modifiedTiles: Record<string, TileId>;
  openedChests: string[];
  bestDepth: number;
}

export interface HudState {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  xp: number;
  xpNext: number;
  level: number;
  armor: number;
  weapon: string;
  gold: number;
  stage: number;
  time: number;
  biome: string;
  objective: string;
  bossWarning: boolean;
  boss?: { name: string; hp: number; maxHp: number; phase: number };
  depth: number;
  treasureDistance?: number;
  merchantDistance?: number;
  dash: number;
  skill: number;
  potions: number;
  ultimate: number;
  buffs: string[];
}
