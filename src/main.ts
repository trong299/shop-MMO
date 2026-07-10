import "./styles.css";
import { rarityColors, slots } from "./data";
import { Game } from "./game";
import type { EquipmentSlot, HudState, MerchantOffer, RewardChoice, SaveData } from "./types";

const get = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const canvas = get<HTMLCanvasElement>("game");
const titleScreen = get<HTMLElement>("title-screen");
const hud = get<HTMLElement>("hud");
const choiceModal = get<HTMLElement>("choice-modal");
const merchantModal = get<HTMLElement>("merchant-modal");
const inventoryModal = get<HTMLElement>("inventory-modal");
const victoryModal = get<HTMLElement>("victory-modal");
const deathModal = get<HTMLElement>("death-modal");
const bossIntro = get<HTMLElement>("boss-intro");
const bossHud = get<HTMLElement>("boss-hud");
const flash = get<HTMLElement>("flash");
const minimap = get<HTMLCanvasElement>("minimap");
const minimapContext = minimap.getContext("2d")!;

const visible = (element: HTMLElement, show: boolean): void => {
  element.classList.toggle("hidden", !show);
};
const percent = (value: number, max: number): number => Math.max(0, Math.min(1, value / Math.max(1, max)));

let merchantClose: (() => void) | undefined;

const game = new Game(canvas, {
  updateHud: (state) => updateHud(state),
  drawMinimap: (draw) => draw(minimapContext, minimap.width, minimap.height),
  showChoices: (kicker, title, choices) => showChoices(kicker, title, choices),
  showMerchant: (offers, close) => showMerchant(offers, close),
  showInventory: (save, equipped) => showInventory(save, equipped),
  hideInventory: () => visible(inventoryModal, false),
  showBossIntro: (name) => {
    get<HTMLElement>("intro-name").textContent = name;
    visible(bossIntro, true);
  },
  hideBossIntro: () => visible(bossIntro, false),
  showVictory: (title, rewards) => {
    get<HTMLElement>("victory-title").textContent = title;
    const host = get<HTMLElement>("victory-rewards");
    host.replaceChildren(...rewards.map((reward) => {
      const item = document.createElement("div");
      item.textContent = reward;
      return item;
    }));
    visible(victoryModal, true);
  },
  showDeath: (summary) => {
    const host = get<HTMLElement>("death-summary");
    host.replaceChildren(...summary.map((line) => {
      const item = document.createElement("div");
      item.textContent = line;
      return item;
    }));
    visible(deathModal, true);
  },
  setInteraction: (label) => {
    const interaction = get<HTMLElement>("interaction");
    visible(interaction, Boolean(label));
    if (label) get<HTMLElement>("interaction-label").textContent = label;
  },
  toast: (message, color = "#e8b95c") => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.style.setProperty("--toast", color);
    toast.textContent = message;
    get<HTMLElement>("toast-host").append(toast);
    window.setTimeout(() => toast.remove(), 2700);
  },
  flash: (color) => {
    flash.style.background = color;
    flash.classList.remove("fire");
    void flash.offsetWidth;
    flash.classList.add("fire");
  },
});

function updateHud(state: HudState): void {
  get<HTMLElement>("hp-fill").style.transform = `scaleX(${percent(state.hp, state.maxHp)})`;
  get<HTMLElement>("mana-fill").style.transform = `scaleX(${percent(state.mana, state.maxMana)})`;
  get<HTMLElement>("xp-fill").style.transform = `scaleX(${percent(state.xp, state.xpNext)})`;
  get<HTMLElement>("hp-text").textContent = `${Math.ceil(state.hp)} / ${Math.round(state.maxHp)}`;
  get<HTMLElement>("mana-text").textContent = `${Math.ceil(state.mana)} / ${Math.round(state.maxMana)}`;
  get<HTMLElement>("xp-text").textContent = `${Math.round(percent(state.xp, state.xpNext) * 100)}% EXPERIENCE`;
  get<HTMLElement>("level").textContent = state.level.toString();
  get<HTMLElement>("armor").textContent = state.armor.toString();
  get<HTMLElement>("weapon").textContent = state.weapon.toUpperCase();
  get<HTMLElement>("gold").textContent = state.gold.toLocaleString();
  get<HTMLElement>("stage").textContent = String(state.stage).padStart(2, "0");
  get<HTMLElement>("biome").textContent = state.biome;
  const minutes = Math.floor(state.time / 60);
  const seconds = Math.floor(state.time % 60);
  const timer = get<HTMLElement>("timer");
  timer.textContent = state.boss ? "BOSS" : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  timer.classList.toggle("warning", state.bossWarning);
  get<HTMLElement>("timer-label").textContent = state.boss ? "THE ARENA IS SEALED" : state.bossWarning ? "THE GUARDIAN IS WAKING" : "UNTIL THE DEEP STIRS";
  get<HTMLElement>("objective").textContent = state.objective.toUpperCase();
  get<HTMLElement>("indicators").textContent = `TREASURE ${state.treasureDistance ?? "--"}m · MERCHANT ${state.merchantDistance ?? "--"}m`;
  get<HTMLElement>("depth").textContent = `${state.depth}m`;
  get<HTMLElement>("dash-mask").style.height = `${state.dash * 100}%`;
  get<HTMLElement>("skill-mask").style.height = `${state.skill * 100}%`;
  get<HTMLElement>("ultimate-mask").style.height = `${100 - state.ultimate}%`;
  get<HTMLElement>("potion-label").textContent = `POTION ×${state.potions}`;
  get<HTMLElement>("compass-needle").style.transform = `rotate(${state.treasureDistance === undefined ? 0 : 20}deg)`;
  const buffHost = get<HTMLElement>("buffs");
  buffHost.replaceChildren(...state.buffs.map((buff) => {
    const icon = document.createElement("i");
    icon.textContent = buff;
    return icon;
  }));
  visible(bossHud, Boolean(state.boss));
  if (state.boss) {
    get<HTMLElement>("boss-name").textContent = state.boss.name;
    get<HTMLElement>("boss-title").textContent = `STAGE ${String(state.stage).padStart(2, "0")} GUARDIAN`;
    get<HTMLElement>("boss-phase").textContent = `PHASE ${["I", "II", "III"][state.boss.phase - 1]}`;
    get<HTMLElement>("boss-fill").style.transform = `scaleX(${percent(state.boss.hp, state.boss.maxHp)})`;
  }
}

function showChoices(kicker: string, title: string, choices: RewardChoice[]): void {
  get<HTMLElement>("choice-kicker").textContent = kicker;
  get<HTMLElement>("choice-title").textContent = title;
  const host = get<HTMLElement>("choice-cards");
  host.replaceChildren();
  choices.forEach((choice, index) => {
    const card = document.createElement("button");
    card.className = "choice-card";
    card.style.setProperty("--rarity", rarityColors[choice.rarity]);
    card.style.setProperty("--delay", `${index * 90}ms`);
    card.innerHTML = `
      <span class="rarity">${choice.rarity.toUpperCase()}</span>
      <span class="icon">${choice.icon}</span>
      <h3>${choice.name}</h3>
      <p>${choice.description}</p>
      <b>${choice.tag}</b>
    `;
    card.addEventListener("click", () => {
      visible(choiceModal, false);
      choice.choose();
    });
    host.append(card);
  });
  visible(choiceModal, true);
}

function showMerchant(offers: MerchantOffer[], close: () => void): void {
  merchantClose = close;
  const host = get<HTMLElement>("merchant-offers");
  const render = (): void => {
    get<HTMLElement>("merchant-gold").textContent = `◆ ${game.saveData.gold.toLocaleString()}`;
    host.replaceChildren();
    for (const offer of offers) {
      const button = document.createElement("button");
      button.className = "merchant-offer";
      button.style.setProperty("--rarity", rarityColors[offer.rarity]);
      button.disabled = offer.sold;
      button.innerHTML = `
        <span class="offer-icon">${offer.icon}</span>
        <div><small>${offer.rarity.toUpperCase()}</small><strong>${offer.name}</strong><p>${offer.description}</p></div>
        <b>${offer.sold ? "SOLD" : `◆ ${offer.price}`}</b>
      `;
      button.addEventListener("click", () => {
        if (offer.buy()) render();
      });
      host.append(button);
    }
  };
  render();
  visible(merchantModal, true);
}

function showInventory(save: SaveData, equipped: Map<EquipmentSlot, import("./types").Equipment>): void {
  const equipmentHost = get<HTMLElement>("equipment-grid");
  equipmentHost.replaceChildren(...slots.map((slot) => {
    const item = equipped.get(slot);
    const panel = document.createElement("div");
    panel.className = "equipment-slot";
    panel.innerHTML = `
      <small>${slot.toUpperCase()}</small>
      <span>${item?.icon ?? "·"}</span>
      <b style="color:${item ? rarityColors[item.rarity] : ""}">${item?.name ?? "EMPTY SLOT"}</b>
      <em>${item ? `${item.rarity.toUpperCase()} · +${item.level}` : "NO RELIC EQUIPPED"}</em>
    `;
    panel.addEventListener("click", () => game.upgradeEquipment(slot));
    return panel;
  }));
  const resources: Array<[string, number]> = Object.entries(save.resources);
  resources.unshift(["keys", save.keys], ["stones", save.stones], ["rare materials", save.materials]);
  get<HTMLElement>("resource-grid").replaceChildren(...resources.map(([name, amount]) => {
    const item = document.createElement("div");
    item.innerHTML = `<small>${name.toUpperCase()}</small><b>${amount}</b>`;
    return item;
  }));
  visible(inventoryModal, true);
}

function showGame(): void {
  visible(titleScreen, false);
  visible(hud, true);
  visible(victoryModal, false);
  visible(deathModal, false);
  game.audio.unlock();
}

get<HTMLButtonElement>("new-run").addEventListener("click", () => {
  showGame();
  game.startNew();
});

get<HTMLButtonElement>("continue-run").addEventListener("click", () => {
  showGame();
  game.continue();
});

get<HTMLButtonElement>("leave-merchant").addEventListener("click", () => {
  visible(merchantModal, false);
  merchantClose?.();
  merchantClose = undefined;
});

get<HTMLButtonElement>("close-inventory").addEventListener("click", () => game.closeInventory());

get<HTMLButtonElement>("retry-stage").addEventListener("click", () => {
  visible(deathModal, false);
  showGame();
  game.retry();
});

get<HTMLButtonElement>("return-title").addEventListener("click", () => {
  visible(deathModal, false);
  visible(hud, false);
  visible(titleScreen, true);
  game.returnToTitle();
});

get<HTMLButtonElement>("next-stage").addEventListener("click", () => {
  visible(victoryModal, false);
  if (game.saveData.stage >= 20) {
    visible(hud, false);
    visible(titleScreen, true);
    game.returnToTitle();
  } else {
    game.nextStage();
  }
});

for (const [button, stat] of [
  ["upgrade-damage", "attack"],
  ["upgrade-defense", "defense"],
  ["upgrade-health", "hp"],
  ["upgrade-speed", "speed"],
  ["upgrade-crit", "crit"],
  ["upgrade-mining", "mining"],
] as const) {
  get<HTMLButtonElement>(button).addEventListener("click", () => game.upgradePermanent(stat));
}

window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyI" && event.code !== "Escape") return;
  if (!merchantModal.classList.contains("hidden")) {
    get<HTMLButtonElement>("leave-merchant").click();
    return;
  }
  if (!inventoryModal.classList.contains("hidden")) {
    game.closeInventory();
    return;
  }
  if (event.code === "KeyI" && game.isRunning && choiceModal.classList.contains("hidden") && victoryModal.classList.contains("hidden")) game.toggleInventory();
});

get<HTMLElement>("saved-stage").textContent = String(game.saveData.stage).padStart(2, "0");
visible(get<HTMLButtonElement>("continue-run"), Boolean(game.saveData.seed));
