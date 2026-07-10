import type { EnemyKind, EquipmentSlot, Rarity, StageConfig, Stats, Upgrade } from "./types";

export const TILE_SIZE = 48;

const bossNames = [
  "Gravetide Colossus",
  "Broodmother Veyra",
  "Cinderheart Golem",
  "Sir Malrec, the Hollow",
  "Nhal the Boneweaver",
  "Warden of Thorns",
  "The Drowned Oracle",
  "Maw of the Deep",
  "Velastra, Witch Queen",
  "Clockwork Behemoth",
  "Frostbound Jotunn",
  "The Thousand-Eyed",
  "Solar Revenant",
  "Abyssal Hydra",
  "Crystal Titan",
  "Lord of the Wild Hunt",
  "Astral Devourer",
  "Shadow Dragon Vharos",
  "Demon King Azrath",
  "The Labyrinth Eternal",
];

const floorNames = [
  "Forgotten Threshold",
  "Webbed Warrens",
  "Ember Vault",
  "Hall of Fallen Oaths",
  "Ossuary of Whispers",
  "Verdant Prison",
  "Sunken Archive",
  "Hollow Depths",
  "Coven of Ash",
  "Brass Catacombs",
  "Glacial Sepulcher",
  "Watcher Maze",
  "Temple of Dawn",
  "Hydra's Coil",
  "Prismatic Core",
  "Moonlit Chase",
  "Starless Expanse",
  "Umbral Roost",
  "Infernal Throne",
  "Heart of the Maze",
];

const palettes: [string, string, string, string][] = [
  ["#171c2a", "#252c3c", "#5b536e", "#4ad9a8"],
  ["#171522", "#2a2035", "#78456b", "#d25ca1"],
  ["#201619", "#3a2020", "#8e3e2e", "#ff8b3d"],
  ["#171a22", "#292d38", "#726b78", "#e0b66b"],
  ["#15171d", "#252832", "#555c69", "#8bd7d1"],
];

export function getStageConfig(floor: number): StageConfig {
  const n = Math.max(1, Math.min(20, floor));
  const mazeSize = Math.min(39, 23 + Math.floor((n - 1) / 2) * 2);
  const palette = palettes[(n - 1) % palettes.length];
  return {
    floor: n,
    name: floorNames[n - 1],
    palette,
    mazeWidth: mazeSize,
    mazeHeight: mazeSize,
    duration: 120,
    bossDamage: 10 * Math.pow(1.14, n - 1),
    bossSpeed: 68 + n * 2.2,
    bossSize: 27 + n * 0.75,
    trapCount: 3 + Math.floor(n * 0.7),
    treasureCount: 8 + Math.floor(n / 3),
    bossName: bossNames[n - 1],
    bossHp: 600 * Math.pow(1.2, n - 1),
  };
}

export const enemyKinds: EnemyKind[] = [
  { name: "Slime", color: "#65d66f", accent: "#c6ff9f", speed: 78, radius: 13, xp: 7, behavior: "chase", sprite: 96 },
  { name: "Skeleton", color: "#d7d2b8", accent: "#ffffff", speed: 92, radius: 12, xp: 10, behavior: "chase", sprite: 85 },
  { name: "Bat", color: "#9a6bd4", accent: "#e7c4ff", speed: 125, radius: 10, xp: 9, behavior: "orbit", sprite: 99 },
  { name: "Spider", color: "#b45a72", accent: "#ff9f8f", speed: 108, radius: 11, xp: 12, behavior: "charger", sprite: 98 },
  { name: "Ghost", color: "#67b9d2", accent: "#d7ffff", speed: 88, radius: 13, xp: 15, behavior: "orbit", sprite: 97 },
  { name: "Goblin", color: "#88a94f", accent: "#e0d76a", speed: 102, radius: 12, xp: 17, behavior: "ranged", sprite: 101 },
  { name: "Mage", color: "#7f70db", accent: "#e79cff", speed: 70, radius: 12, xp: 20, behavior: "ranged", sprite: 90 },
  { name: "Knight", color: "#8c98a9", accent: "#f2cf73", speed: 82, radius: 14, xp: 24, behavior: "charger", sprite: 87 },
  { name: "Demon", color: "#c74848", accent: "#ffb64d", speed: 100, radius: 15, xp: 30, behavior: "chase", sprite: 103 },
];

export const rarityOrder: Rarity[] = ["Common", "Rare", "Epic", "Legendary", "Mythic", "Ancient"];
export const rarityColors: Record<Rarity, string> = {
  Common: "#9aa5b1",
  Rare: "#56a8ff",
  Epic: "#b76cff",
  Legendary: "#ffb84c",
  Mythic: "#ff577f",
  Ancient: "#65f1d0",
};

export const slots: EquipmentSlot[] = ["Weapon", "Helmet", "Armor", "Boots", "Ring", "Amulet", "Artifact"];

export const itemNames: Record<EquipmentSlot, string[]> = {
  Weapon: ["Moonfang Blade", "Ashen Longbow", "Starcaller Staff", "Gravetide Axe"],
  Helmet: ["Watcher Hood", "Crown of Embers", "Knight's Visor", "Brood Mask"],
  Armor: ["Runed Carapace", "Warden Plate", "Ghostweave Mantle", "Titan Harness"],
  Boots: ["Windstep Greaves", "Mirewalkers", "Blink Boots", "Gilded Sabatons"],
  Ring: ["Serpent Loop", "Ruby Signet", "Ring of Echoes", "Fortune Band"],
  Amulet: ["Heart of Winter", "Sun Charm", "Bloodstone Locket", "Void Pendant"],
  Artifact: ["Fire Orb", "Clockwork Drone", "Healing Totem", "Lucky Charm"],
};

export const slotIcons: Record<EquipmentSlot, string> = {
  Weapon: "⚔",
  Helmet: "♜",
  Armor: "◆",
  Boots: "♞",
  Ring: "○",
  Amulet: "◇",
  Artifact: "✦",
};

export const baseStats: Stats = {
  attack: 18,
  defense: 3,
  maxHp: 120,
  critChance: 0.08,
  critDamage: 1.75,
  attackSpeed: 1,
  moveSpeed: 190,
  lifeSteal: 0,
  luck: 0,
  cooldownReduction: 0,
  elementDamage: 0,
};

export const upgrades: Upgrade[] = [
  {
    id: "fury",
    name: "Brutal Strength",
    description: "+20% attack damage",
    icon: "⚔",
    rarity: "Common",
    maxStacks: 5,
    apply: ({ player }) => { player.attack *= 1.2; },
  },
  {
    id: "vitality",
    name: "Giant's Heart",
    description: "+50 maximum health and heal 50",
    icon: "♥",
    rarity: "Common",
    maxStacks: 5,
    apply: ({ player }) => { player.maxHp += 50; player.hp = Math.min(player.maxHp, player.hp + 50); },
  },
  {
    id: "haste",
    name: "Wind Dancer",
    description: "+15% movement speed",
    icon: "➤",
    rarity: "Common",
    maxStacks: 4,
    apply: ({ player }) => { player.speed *= 1.15; },
  },
  {
    id: "rapid",
    name: "Quickening Rune",
    description: "+18% attack speed",
    icon: "»",
    rarity: "Rare",
    maxStacks: 5,
    apply: ({ player }) => { player.attackSpeed *= 1.18; },
  },
  {
    id: "critical",
    name: "Assassin's Mark",
    description: "+12% critical chance",
    icon: "✧",
    rarity: "Rare",
    maxStacks: 4,
    apply: ({ player }) => { player.critChance += 0.12; },
  },
  {
    id: "multishot",
    name: "Twin Fangs",
    description: "Fire an additional projectile",
    icon: "⋔",
    rarity: "Epic",
    maxStacks: 2,
    apply: ({ player }) => { player.projectiles += 1; },
  },
  {
    id: "pierce",
    name: "Spectral Bolts",
    description: "Projectiles pierce another enemy",
    icon: "↠",
    rarity: "Rare",
    maxStacks: 3,
    apply: ({ player }) => { player.projectilePierce += 1; },
  },
  {
    id: "lifesteal",
    name: "Crimson Pact",
    description: "Restore 4% of damage dealt",
    icon: "♦",
    rarity: "Epic",
    maxStacks: 3,
    apply: ({ player }) => { player.lifeSteal += 0.04; },
  },
  {
    id: "dash",
    name: "Phase Step",
    description: "-25% dash cooldown",
    icon: "◫",
    rarity: "Rare",
    maxStacks: 3,
    apply: ({ player }) => { player.dashCooldown *= 0.75; },
  },
  {
    id: "thorns",
    name: "Thornmail",
    description: "Return 35% contact damage",
    icon: "✷",
    rarity: "Rare",
    maxStacks: 3,
    apply: ({ player }) => { player.thorns += 0.35; },
  },
  {
    id: "aura",
    name: "Fire Aura",
    description: "Scorch nearby enemies every second",
    icon: "☀",
    rarity: "Epic",
    maxStacks: 4,
    apply: ({ player }) => { player.auraDamage += 10; },
  },
  {
    id: "chain",
    name: "Chain Lightning",
    description: "Hits may arc lightning to a nearby foe",
    icon: "ϟ",
    rarity: "Legendary",
    maxStacks: 3,
    apply: ({ player }) => { player.chainChance += 0.18; },
  },
  {
    id: "shield",
    name: "Arcane Aegis",
    description: "Gain a 35-point regenerating shield",
    icon: "⬡",
    rarity: "Epic",
    maxStacks: 3,
    apply: ({ player }) => { player.shield += 35; },
  },
  {
    id: "berserk",
    name: "Demon's Bargain",
    description: "+45% attack, -20 maximum health",
    icon: "♨",
    rarity: "Legendary",
    maxStacks: 3,
    apply: ({ player }) => { player.attack *= 1.45; player.maxHp = Math.max(40, player.maxHp - 20); player.hp = Math.min(player.hp, player.maxHp); },
  },
];
