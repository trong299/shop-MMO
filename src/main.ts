import "./styles.css";
import { rarityColors, slots } from "./data";
import { Game, type GameUI, type HudState } from "./game";
import type { EquipmentSlot } from "./types";

const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = get<HTMLCanvasElement>("game");
const minimapHost = get<HTMLDivElement>("minimap");
const minimapCanvas = document.createElement("canvas");
minimapCanvas.width = 148;
minimapCanvas.height = 112;
minimapHost.append(minimapCanvas);

const titleScreen = get<HTMLElement>("title-screen");
const hud = get<HTMLElement>("hud");
const choiceModal = get<HTMLElement>("choice-modal");
const equipmentModal = get<HTMLElement>("equipment-modal");
const merchantModal = get<HTMLElement>("merchant-modal");
const stageModal = get<HTMLElement>("stage-modal");
const gameoverModal = get<HTMLElement>("gameover-modal");
const interaction = get<HTMLElement>("interaction");
const toastElement = get<HTMLElement>("toast");
const flash = get<HTMLElement>("flash");
const continueButton = get<HTMLButtonElement>("continue-game");
let toastTimeout = 0;

function setVisible(element: HTMLElement, visible: boolean): void {
  element.classList.toggle("hidden", !visible);
}

function updateHud(state: HudState): void {
  const hpPercent = Math.max(0, state.hp / state.maxHp) * 100;
  const manaPercent = Math.max(0, state.mana / state.maxMana) * 100;
  const xpPercent = Math.max(0, state.xp / state.xpNeeded) * 100;
  get<HTMLElement>("hp-fill").style.width = `${hpPercent}%`;
  get<HTMLElement>("mana-fill").style.width = `${manaPercent}%`;
  get<HTMLElement>("exp-fill").style.width = `${xpPercent}%`;
  get<HTMLElement>("hp-text").textContent = `${Math.ceil(Math.max(0, state.hp))} / ${Math.round(state.maxHp)}`;
  get<HTMLElement>("mana-text").textContent = `${Math.ceil(Math.max(0, state.mana))} / ${Math.round(state.maxMana)}`;
  get<HTMLElement>("exp-text").textContent = `LV ${state.level} · ${Math.round(xpPercent)}%`;
  get<HTMLElement>("hero-level").textContent = `LV ${state.level}`;
  get<HTMLElement>("gold").textContent = state.gold.toLocaleString();
  get<HTMLElement>("keys").textContent = state.keys.toString();
  get<HTMLElement>("equipment-power").textContent = state.equipmentPower.toLocaleString();
  get<HTMLElement>("stage-number").textContent = String(state.floor).padStart(2, "0");
  get<HTMLElement>("floor-title").textContent = state.floorName;
  get<HTMLElement>("objective").textContent = state.objective;
  const minutes = Math.floor(state.time / 60);
  const seconds = Math.floor(state.time % 60);
  const timer = get<HTMLElement>("timer");
  timer.textContent = state.boss ? "BOSS" : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  timer.classList.toggle("danger", state.timerDanger);
  get<HTMLElement>("timer-caption").textContent = state.boss ? "THE ARENA IS SEALED" : state.timerDanger ? "THE GUARDIAN IS STIRRING" : "UNTIL THE GUARDIAN AWAKENS";
  get<HTMLElement>("dash-cooldown").style.height = `${state.dashCooldown * 100}%`;
  get<HTMLElement>("special-cooldown").style.height = `${state.specialCooldown * 100}%`;
  get<HTMLElement>("ultimate-charge").style.height = `${100 - state.ultimateCharge}%`;
  get<HTMLElement>("potion-count").textContent = `POTION ×${state.potionCharges}`;

  const bossHud = get<HTMLElement>("boss-hud");
  setVisible(bossHud, Boolean(state.boss));
  if (state.boss) {
    get<HTMLElement>("boss-title").textContent = state.boss.name;
    get<HTMLElement>("boss-phase").textContent = state.boss.phase;
    get<HTMLElement>("boss-fill").style.width = `${Math.max(0, state.boss.hp / state.boss.maxHp) * 100}%`;
  }
}

const ui: GameUI = {
  updateHud,
  showChoices: (kicker, title, choices) => {
    get<HTMLElement>("choice-kicker").textContent = kicker;
    get<HTMLElement>("choice-title").textContent = title;
    const cardHost = get<HTMLElement>("choice-cards");
    cardHost.replaceChildren();
    choices.forEach((choice, index) => {
      const button = document.createElement("button");
      button.className = "choice-card";
      button.style.setProperty("--rarity", rarityColors[choice.rarity]);
      button.style.setProperty("--delay", `${index * 80}ms`);
      button.innerHTML = `
        <span class="card-index">0${index + 1}</span>
        <span class="card-rarity">${choice.rarity}</span>
        <span class="card-icon">${choice.icon}</span>
        <strong>${choice.name}</strong>
        <p>${choice.description}</p>
        <small>${choice.tag}</small>
        <i>CHOOSE</i>
      `;
      button.addEventListener("click", () => {
        setVisible(choiceModal, false);
        choice.select();
      }, { once: true });
      cardHost.append(button);
    });
    setVisible(choiceModal, true);
  },
  showStageComplete: (title, rewards) => {
    get<HTMLElement>("stage-complete-title").textContent = title;
    get<HTMLButtonElement>("next-stage").textContent = title.includes("ETERNAL") ? "RETURN TO TITLE" : "DESCEND TO NEXT FLOOR";
    const rewardsHost = get<HTMLElement>("stage-rewards");
    rewardsHost.replaceChildren();
    for (const reward of rewards) {
      const element = document.createElement("div");
      element.textContent = reward;
      rewardsHost.append(element);
    }
    setVisible(stageModal, true);
    setVisible(interaction, false);
  },
  showGameOver: (summary) => {
    get<HTMLElement>("run-summary").textContent = summary;
    setVisible(gameoverModal, true);
    setVisible(interaction, false);
  },
  showMerchant: (offers, gold, close) => {
    const offerHost = get<HTMLElement>("merchant-offers");
    const render = (): void => {
      get<HTMLElement>("merchant-gold").textContent = `◆ ${game.saveData.gold.toLocaleString()} GOLD`;
      offerHost.replaceChildren();
      for (const offer of offers) {
        const button = document.createElement("button");
        button.className = "merchant-offer";
        button.style.setProperty("--rarity", rarityColors[offer.rarity]);
        button.disabled = offer.sold;
        button.innerHTML = `
          <span class="offer-icon">${offer.icon}</span>
          <div><small>${offer.rarity.toUpperCase()}</small><strong>${offer.name}</strong><p>${offer.description}</p></div>
          <b>${offer.sold ? "SOLD" : `◆ ${offer.cost}`}</b>
        `;
        button.addEventListener("click", () => {
          if (offer.buy()) render();
        });
        offerHost.append(button);
      }
    };
    get<HTMLElement>("merchant-gold").textContent = `◆ ${gold.toLocaleString()} GOLD`;
    const closeButton = get<HTMLButtonElement>("close-merchant");
    closeButton.onclick = () => {
      setVisible(merchantModal, false);
      close();
    };
    render();
    setVisible(merchantModal, true);
  },
  showBossIntro: (name, floor) => {
    get<HTMLElement>("intro-boss-name").textContent = name;
    const intro = get<HTMLElement>("boss-intro");
    intro.querySelector("p")!.textContent = `FLOOR ${String(floor).padStart(2, "0")} GUARDIAN`;
    setVisible(intro, true);
  },
  hideBossIntro: () => setVisible(get<HTMLElement>("boss-intro"), false),
  setInteraction: (visible, label = "OPEN CHEST") => {
    setVisible(interaction, visible);
    const labelElement = interaction.querySelector("span");
    if (labelElement) labelElement.textContent = label;
  },
  toast: (message, color = "#65f1d0") => {
    window.clearTimeout(toastTimeout);
    toastElement.textContent = message;
    toastElement.style.setProperty("--toast-color", color);
    setVisible(toastElement, true);
    toastTimeout = window.setTimeout(() => setVisible(toastElement, false), 2600);
  },
  flash: (color) => {
    flash.style.background = color;
    flash.animate([{ opacity: 0.32 }, { opacity: 0 }], { duration: 420, easing: "ease-out" });
  },
};

const game = new Game(canvas, minimapCanvas, ui);
continueButton.disabled = !game.hasSave;

function enterGame(floor: number): void {
  setVisible(titleScreen, false);
  setVisible(stageModal, false);
  setVisible(gameoverModal, false);
  setVisible(equipmentModal, false);
  setVisible(merchantModal, false);
  setVisible(choiceModal, false);
  setVisible(hud, true);
  game.start(floor);
}

get<HTMLButtonElement>("new-game").addEventListener("click", () => enterGame(1));
continueButton.addEventListener("click", () => enterGame(game.saveData.selectedFloor));

get<HTMLButtonElement>("equipment-button").addEventListener("click", () => {
  game.setPaused(true);
  renderEquipment();
  setVisible(equipmentModal, true);
});

get<HTMLButtonElement>("close-equipment").addEventListener("click", () => {
  setVisible(equipmentModal, false);
  game.setPaused(false);
});

get<HTMLButtonElement>("forge-button").addEventListener("click", () => {
  if (game.forgeUpgrade()) {
    const button = get<HTMLButtonElement>("forge-button");
    button.textContent = "EQUIPMENT IMPROVED";
    window.setTimeout(() => { button.textContent = "UPGRADE RANDOM GEAR"; }, 1200);
  }
});

get<HTMLButtonElement>("next-stage").addEventListener("click", () => {
  setVisible(stageModal, false);
  if (!game.continueAfterVictory()) {
    setVisible(hud, false);
    setVisible(titleScreen, true);
  }
});

get<HTMLButtonElement>("retry-button").addEventListener("click", () => {
  setVisible(gameoverModal, false);
  game.retry();
});

get<HTMLButtonElement>("title-button").addEventListener("click", () => {
  game.returnToTitle();
  setVisible(gameoverModal, false);
  setVisible(hud, false);
  setVisible(titleScreen, true);
  continueButton.disabled = !game.hasSave;
});

window.addEventListener("keydown", (event) => {
  if (event.code !== "Escape" && event.code !== "KeyI") return;
  if (!merchantModal.classList.contains("hidden")) {
    get<HTMLButtonElement>("close-merchant").click();
    return;
  }
  if (!game.isRunning || !choiceModal.classList.contains("hidden") || !stageModal.classList.contains("hidden")) return;
  const opening = equipmentModal.classList.contains("hidden");
  if (opening) renderEquipment();
  setVisible(equipmentModal, opening);
  game.setPaused(opening);
});

function renderEquipment(): void {
  const snapshot = game.equipmentSnapshot();
  const host = get<HTMLElement>("equipment-slots");
  host.replaceChildren();
  for (const slot of slots) {
    const item = snapshot.items[slot as EquipmentSlot];
    const card = document.createElement("article");
    card.className = `equipment-slot ${item ? "filled" : ""}`;
    if (item) card.style.setProperty("--rarity", rarityColors[item.rarity]);
    card.innerHTML = item
      ? `<span>${item.icon}</span><div><small>${slot.toUpperCase()}</small><strong>${item.name}</strong><p>${item.rarity} · +${item.level}</p></div>`
      : `<span>+</span><div><small>${slot.toUpperCase()}</small><strong>Empty slot</strong><p>Find equipment in the maze</p></div>`;
    host.append(card);
  }

  const stats = snapshot.stats;
  const entries: [string, string][] = [
    ["Attack", Math.round(stats.attack).toString()],
    ["Defense", Math.round(stats.defense).toString()],
    ["Maximum HP", Math.round(stats.maxHp).toString()],
    ["Critical Chance", `${Math.round(stats.critChance * 100)}%`],
    ["Critical Damage", `${Math.round(stats.critDamage * 100)}%`],
    ["Attack Speed", `${Math.round(stats.attackSpeed * 100)}%`],
    ["Movement", Math.round(stats.moveSpeed).toString()],
    ["Life Steal", `${Math.round(stats.lifeSteal * 100)}%`],
    ["Cooldown Reduction", `${Math.round(stats.cooldownReduction * 100)}%`],
    ["Element Power", Math.round(stats.elementDamage).toString()],
  ];
  const statList = get<HTMLElement>("stat-list");
  statList.replaceChildren();
  for (const [label, value] of entries) {
    const row = document.createElement("div");
    row.innerHTML = `<span>${label}</span><b>${value}</b>`;
    statList.append(row);
  }
}
