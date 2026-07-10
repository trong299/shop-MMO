import type { Biome, EquipmentSlot, Rarity, ResourceId, SaveData, TileId } from "./types";
import { Tile } from "./types";

export const biomes: Record<string, Biome> = {
  surface: { id: "surface", name: "Moonfall Surface", sky: "#14243a", far: "#183248", mid: "#214056", near: "#2d5360", stone: "#545b64", edge: "#8f9a9b", accent: "#7ed8bf", fog: "#9fc9ca", gravity: 1 },
  stone: { id: "stone", name: "Whispering Stone", sky: "#090b12", far: "#111621", mid: "#1b222d", near: "#252d36", stone: "#4c515b", edge: "#747b83", accent: "#d2b26c", fog: "#77808f", gravity: 1 },
  crystal: { id: "crystal", name: "Prismatic Hollow", sky: "#0c0716", far: "#1a1030", mid: "#2b1744", near: "#3b2056", stone: "#3e3653", edge: "#715e8d", accent: "#ba79ff", fog: "#714a91", gravity: 0.98 },
  mushroom: { id: "mushroom", name: "Mycelium Gardens", sky: "#080e13", far: "#102320", mid: "#17342d", near: "#22483b", stone: "#3f4f47", edge: "#6b796c", accent: "#72e0a5", fog: "#467962", gravity: 0.95 },
  mine: { id: "mine", name: "The Forsaken Delve", sky: "#0e0b09", far: "#201813", mid: "#33241a", near: "#493322", stone: "#54463d", edge: "#947650", accent: "#efb55d", fog: "#765a3b", gravity: 1 },
  ruins: { id: "ruins", name: "Sunken Reliquary", sky: "#0d0b12", far: "#211a27", mid: "#33283a", near: "#46384a", stone: "#56505b", edge: "#968375", accent: "#e4bc72", fog: "#796976", gravity: 1 },
  lava: { id: "lava", name: "Cinder Maw", sky: "#160706", far: "#32100c", mid: "#561b10", near: "#742713", stone: "#392d31", edge: "#6d4a3b", accent: "#ff6639", fog: "#8d2f1d", gravity: 1.04 },
  ice: { id: "ice", name: "Glacier Crypt", sky: "#06101a", far: "#0d2639", mid: "#163a51", near: "#23536b", stone: "#38566d", edge: "#87c8dc", accent: "#8cf0ff", fog: "#6ea7b9", gravity: 0.97 },
  poison: { id: "poison", name: "Viridian Blight", sky: "#0a1007", far: "#17250e", mid: "#283b15", near: "#3c5620", stone: "#41483a", edge: "#77854d", accent: "#a7ee50", fog: "#648436", gravity: 1 },
  abyss: { id: "abyss", name: "The Lightless Deep", sky: "#020307", far: "#070813", mid: "#0d0d20", near: "#17152d", stone: "#24223c", edge: "#49436a", accent: "#746cff", fog: "#282449", gravity: 0.9 },
  factory: { id: "factory", name: "Buried Machine", sky: "#070d10", far: "#101d20", mid: "#1a2d2e", near: "#263c3a", stone: "#3f4b4c", edge: "#7d8c83", accent: "#f0aa3c", fog: "#536965", gravity: 1.05 },
};

export const biomeOrder = ["stone", "crystal", "mushroom", "mine", "ruins", "lava", "ice", "poison", "abyss", "factory"] as const;

export const bossNames = [
  "The Buried Sentinel",
  "Amethyst Colossus",
  "Sovereign Mycelia",
  "Ironjaw Excavator",
  "The Last Reliquary King",
  "Pyraxis, Cinder Wyrm",
  "Glacielle the Unmoving",
  "The Verdant Hunger",
  "Umbra, Beast Below",
  "Machina Prime",
  "Stoneheart Ascendant",
  "The Crystal Choir",
  "Sporebound Matriarch",
  "The Golden Drill",
  "Emperor of Dust",
  "Worldfire Dragon",
  "The Pale Titan",
  "Blightmind",
  "Lord of the Empty Dark",
  "AION, GOD BENEATH",
] as const;

export const rarityOrder: Rarity[] = ["Common", "Rare", "Epic", "Legendary", "Mythic", "Ancient"];
export const rarityColors: Record<Rarity, string> = {
  Common: "#b7bec7",
  Rare: "#50a9ff",
  Epic: "#b86cff",
  Legendary: "#ffb84d",
  Mythic: "#ff5f7e",
  Ancient: "#7fffe0",
};

export const slots: EquipmentSlot[] = ["Weapon", "Helmet", "Armor", "Boots", "Ring", "Amulet", "Artifact", "Pet"];
export const slotIcons: Record<EquipmentSlot, string> = {
  Weapon: "⚔",
  Helmet: "♜",
  Armor: "⬟",
  Boots: "➟",
  Ring: "◉",
  Amulet: "◇",
  Artifact: "✦",
  Pet: "◆",
};

export const equipmentNames: Record<EquipmentSlot, string[]> = {
  Weapon: ["Gravesong Pick", "Emberfang", "Moonsteel Edge", "Faultline Hammer", "Void Carver"],
  Helmet: ["Delver's Crown", "Crystal Visor", "Cinder Mask", "Abyss Hood", "King's Lantern"],
  Armor: ["Deepguard Plate", "Mushroom Mantle", "Obsidian Shell", "Runic Coat", "Machina Heart"],
  Boots: ["Cavewind Treads", "Wallrunner Greaves", "Frozen Steps", "Rift Boots", "Meteor Spurs"],
  Ring: ["Ring of Echoes", "Goldvein Loop", "Ember Circle", "Prismatic Signet", "Abyssal Band"],
  Amulet: ["Miner's Oath", "Heart of Stone", "Spore Charm", "Sunken Medallion", "Godshard"],
  Artifact: ["Chrono Shard", "Living Compass", "Volcanic Core", "Ancient Gear", "Crystal Moon"],
  Pet: ["Lantern Wisp", "Molekin", "Clockwork Finch", "Glowcap Sprite", "Shardling"],
};

export const tileHardness: Partial<Record<TileId, number>> = {
  [Tile.Dirt]: 0.22,
  [Tile.Stone]: 0.52,
  [Tile.Copper]: 0.7,
  [Tile.Iron]: 0.86,
  [Tile.Gold]: 1,
  [Tile.Crystal]: 0.92,
  [Tile.Diamond]: 1.35,
  [Tile.Magic]: 1.4,
  [Tile.Obsidian]: 1.8,
  [Tile.Ice]: 0.45,
  [Tile.Factory]: 1.1,
  [Tile.Explosive]: 0.35,
};

export const tileResource: Partial<Record<TileId, ResourceId>> = {
  [Tile.Stone]: "stone",
  [Tile.Copper]: "copper",
  [Tile.Iron]: "iron",
  [Tile.Gold]: "goldOre",
  [Tile.Crystal]: "crystal",
  [Tile.Diamond]: "diamond",
  [Tile.Magic]: "magic",
  [Tile.Obsidian]: "obsidian",
  [Tile.Factory]: "iron",
};

export const defaultSave: SaveData = {
  version: 1,
  stage: 1,
  seed: 0,
  gold: 0,
  keys: 0,
  stones: 0,
  materials: 0,
  permanent: { attack: 0, defense: 0, hp: 0, speed: 0, crit: 0, mining: 0 },
  resources: { stone: 0, copper: 0, iron: 0, goldOre: 0, crystal: 0, diamond: 0, magic: 0, obsidian: 0 },
  equipment: [],
  equipped: {},
  modifiedTiles: {},
  openedChests: [],
  bestDepth: 0,
};
