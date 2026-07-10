import "./styles.css";
import { rarityColors, slots } from "./data";
import { Game } from "./game";
const get = (id) => document.getElementById(id);
const canvas = get("game");
const minimapHost = get("minimap");
const minimapCanvas = document.createElement("canvas");
minimapCanvas.width = 148;
minimapCanvas.height = 112;
minimapHost.append(minimapCanvas);
const titleScreen = get("title-screen");
const hud = get("hud");
const choiceModal = get("choice-modal");
const equipmentModal = get("equipment-modal");
const stageModal = get("stage-modal");
const gameoverModal = get("gameover-modal");
const interaction = get("interaction");
const toastElement = get("toast");
const flash = get("flash");
const continueButton = get("continue-game");
let toastTimeout = 0;
function setVisible(element, visible) {
    element.classList.toggle("hidden", !visible);
}
function updateHud(state) {
    const hpPercent = Math.max(0, state.hp / state.maxHp) * 100;
    const manaPercent = Math.max(0, state.mana / state.maxMana) * 100;
    const xpPercent = Math.max(0, state.xp / state.xpNeeded) * 100;
    get("hp-fill").style.width = `${hpPercent}%`;
    get("mana-fill").style.width = `${manaPercent}%`;
    get("exp-fill").style.width = `${xpPercent}%`;
    get("hp-text").textContent = `${Math.ceil(Math.max(0, state.hp))} / ${Math.round(state.maxHp)}`;
    get("mana-text").textContent = `${Math.ceil(Math.max(0, state.mana))} / ${Math.round(state.maxMana)}`;
    get("exp-text").textContent = `LV ${state.level} · ${Math.round(xpPercent)}%`;
    get("gold").textContent = state.gold.toLocaleString();
    get("stage-number").textContent = String(state.floor).padStart(2, "0");
    get("objective").textContent = `${state.floorName} · ${state.objective}`;
    const minutes = Math.floor(state.time / 60);
    const seconds = Math.floor(state.time % 60);
    get("timer").textContent = state.boss ? "BOSS" : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const bossHud = get("boss-hud");
    setVisible(bossHud, Boolean(state.boss));
    if (state.boss) {
        get("boss-title").textContent = state.boss.name;
        get("boss-phase").textContent = state.boss.phase;
        get("boss-fill").style.width = `${Math.max(0, state.boss.hp / state.boss.maxHp) * 100}%`;
    }
}
const ui = {
    updateHud,
    showChoices: (kicker, title, choices) => {
        get("choice-kicker").textContent = kicker;
        get("choice-title").textContent = title;
        const cardHost = get("choice-cards");
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
        get("stage-complete-title").textContent = title;
        const rewardsHost = get("stage-rewards");
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
        get("run-summary").textContent = summary;
        setVisible(gameoverModal, true);
        setVisible(interaction, false);
    },
    setInteraction: (visible, label = "OPEN CHEST") => {
        setVisible(interaction, visible);
        const labelElement = interaction.querySelector("span");
        if (labelElement)
            labelElement.textContent = label;
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
function enterGame(floor) {
    setVisible(titleScreen, false);
    setVisible(stageModal, false);
    setVisible(gameoverModal, false);
    setVisible(equipmentModal, false);
    setVisible(choiceModal, false);
    setVisible(hud, true);
    game.start(floor);
}
get("new-game").addEventListener("click", () => enterGame(1));
continueButton.addEventListener("click", () => enterGame(game.saveData.selectedFloor));
get("equipment-button").addEventListener("click", () => {
    game.setPaused(true);
    renderEquipment();
    setVisible(equipmentModal, true);
});
get("close-equipment").addEventListener("click", () => {
    setVisible(equipmentModal, false);
    game.setPaused(false);
});
get("forge-button").addEventListener("click", () => {
    if (game.forgeUpgrade()) {
        const button = get("forge-button");
        button.textContent = "EQUIPMENT IMPROVED";
        window.setTimeout(() => { button.textContent = "UPGRADE RANDOM GEAR"; }, 1200);
    }
});
get("next-stage").addEventListener("click", () => {
    setVisible(stageModal, false);
    game.continueAfterVictory();
});
get("retry-button").addEventListener("click", () => {
    setVisible(gameoverModal, false);
    game.retry();
});
get("title-button").addEventListener("click", () => {
    game.returnToTitle();
    setVisible(gameoverModal, false);
    setVisible(hud, false);
    setVisible(titleScreen, true);
    continueButton.disabled = !game.hasSave;
});
window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" && event.code !== "KeyI")
        return;
    if (!game.isRunning || !choiceModal.classList.contains("hidden") || !stageModal.classList.contains("hidden"))
        return;
    const opening = equipmentModal.classList.contains("hidden");
    if (opening)
        renderEquipment();
    setVisible(equipmentModal, opening);
    game.setPaused(opening);
});
function renderEquipment() {
    const snapshot = game.equipmentSnapshot();
    const host = get("equipment-slots");
    host.replaceChildren();
    for (const slot of slots) {
        const item = snapshot.items[slot];
        const card = document.createElement("article");
        card.className = `equipment-slot ${item ? "filled" : ""}`;
        if (item)
            card.style.setProperty("--rarity", rarityColors[item.rarity]);
        card.innerHTML = item
            ? `<span>${item.icon}</span><div><small>${slot.toUpperCase()}</small><strong>${item.name}</strong><p>${item.rarity} · +${item.level}</p></div>`
            : `<span>+</span><div><small>${slot.toUpperCase()}</small><strong>Empty slot</strong><p>Find equipment in the maze</p></div>`;
        host.append(card);
    }
    const stats = snapshot.stats;
    const entries = [
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
    const statList = get("stat-list");
    statList.replaceChildren();
    for (const [label, value] of entries) {
        const row = document.createElement("div");
        row.innerHTML = `<span>${label}</span><b>${value}</b>`;
        statList.append(row);
    }
}
