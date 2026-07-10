export type Vec2 = { x: number; y: number };

export type RoomType =
  | "spawn"
  | "treasure"
  | "trap"
  | "puzzle"
  | "secret"
  | "locked"
  | "merchant"
  | "fountain"
  | "boss"
  | "passage";

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary" | "Mythic" | "Ancient";
export type EquipmentSlot = "Weapon" | "Helmet" | "Armor" | "Boots" | "Ring" | "Amulet" | "Artifact";

export interface Stats {
  attack: number;
  defense: number;
  maxHp: number;
  critChance: number;
  critDamage: number;
  attackSpeed: number;
  moveSpeed: number;
  lifeSteal: number;
  luck: number;
  cooldownReduction: number;
  elementDamage: number;
}

export interface Equipment {
  id: string;
  name: string;
  slot: EquipmentSlot;
  rarity: Rarity;
  level: number;
  icon: string;
  stats: Partial<Stats>;
  effect?: string;
}

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  maxStacks: number;
  apply: (game: UpgradeTarget) => void;
}

export interface UpgradeTarget {
  player: {
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
    attackSpeed: number;
    critChance: number;
    critDamage: number;
    dashCooldown: number;
    lifeSteal: number;
    projectiles: number;
    projectilePierce: number;
    thorns: number;
    auraDamage: number;
    chainChance: number;
    shield: number;
  };
  upgradeStacks: Map<string, number>;
}

export interface StageConfig {
  floor: number;
  name: string;
  palette: [string, string, string, string];
  mazeWidth: number;
  mazeHeight: number;
  duration: number;
  bossDamage: number;
  bossSpeed: number;
  bossSize: number;
  trapCount: number;
  treasureCount: number;
  bossName: string;
  bossHp: number;
}

export interface SaveData {
  version: number;
  unlockedFloor: number;
  selectedFloor: number;
  gold: number;
  stones: number;
  crystals: number;
  permanentPower: number;
  equipment: Equipment[];
  equipped: Partial<Record<EquipmentSlot, string>>;
}

export interface MazeCell {
  x: number;
  y: number;
  wall: boolean;
  discovered: boolean;
  room: RoomType;
  variant: number;
}

export interface Maze {
  width: number;
  height: number;
  cells: MazeCell[][];
  spawn: Vec2;
  boss: Vec2;
  treasure: Vec2[];
  traps: Vec2[];
  puzzles: Vec2[];
  locked: Vec2[];
  merchant: Vec2;
  fountain: Vec2;
  keys: Vec2[];
  secrets: Vec2[];
  floors: Vec2[];
}

export interface EnemyKind {
  name: string;
  color: string;
  accent: string;
  speed: number;
  radius: number;
  xp: number;
  behavior: "chase" | "ranged" | "charger" | "orbit";
  sprite: number;
}
