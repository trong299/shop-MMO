import { AudioSystem } from "./audio";
import {
  baseStats,
  enemyKinds,
  getStageConfig,
  itemNames,
  rarityColors,
  rarityOrder,
  slotIcons,
  slots,
  TILE_SIZE,
  upgrades,
} from "./data";
import { generateMaze, Random } from "./maze";
import type {
  EnemyKind,
  Equipment,
  EquipmentSlot,
  Maze,
  Rarity,
  SaveData,
  StageConfig,
  Upgrade,
  Vec2,
} from "./types";

type ChoiceOption = {
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  tag: string;
  select: () => void;
};

export interface HudState {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  xp: number;
  xpNeeded: number;
  level: number;
  gold: number;
  floor: number;
  floorName: string;
  time: number;
  objective: string;
  boss?: { name: string; hp: number; maxHp: number; phase: string };
}

export interface GameUI {
  updateHud: (state: HudState) => void;
  showChoices: (kicker: string, title: string, choices: ChoiceOption[]) => void;
  showStageComplete: (title: string, rewards: string[]) => void;
  showGameOver: (summary: string) => void;
  setInteraction: (visible: boolean, label?: string) => void;
  toast: (message: string, color?: string) => void;
  flash: (color: string) => void;
}

interface Player {
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  attack: number;
  defense: number;
  speed: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  lifeSteal: number;
  level: number;
  xp: number;
  xpNeeded: number;
  shootCooldown: number;
  dashCooldown: number;
  dashTimer: number;
  dashReady: number;
  invulnerable: number;
  facing: number;
  projectiles: number;
  projectilePierce: number;
  thorns: number;
  auraDamage: number;
  auraTimer: number;
  chainChance: number;
  shield: number;
  shieldMax: number;
  shieldRegen: number;
}

interface Enemy {
  id: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  kind: EnemyKind;
  elite: boolean;
  boss: boolean;
  name: string;
  hitFlash: number;
  attackCooldown: number;
  specialCooldown: number;
  chargeTimer: number;
  phase: number;
  dead: boolean;
}

interface Projectile {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  pierce: number;
  enemy: boolean;
  color: string;
}

interface Chest {
  x: number;
  y: number;
  opened: boolean;
  pulse: number;
  secret: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  critical: boolean;
}

const SAVE_KEY = "arcane-labyrinth-save-v1";
const defaultSave: SaveData = {
  version: 1,
  unlockedFloor: 1,
  selectedFloor: 1,
  gold: 0,
  stones: 0,
  crystals: 0,
  permanentPower: 0,
  equipment: [],
  equipped: {},
};

const keyMap = new Set<string>();

export class Game {
  readonly audio = new AudioSystem();
  readonly upgradeStacks = new Map<string, number>();
  readonly minimapCanvas: HTMLCanvasElement;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly ui: GameUI;
  private readonly random = new Random();
  private readonly sprites = new Map<number, HTMLImageElement>();
  private readonly projectiles: Projectile[] = [];
  private readonly particles: Particle[] = [];
  private readonly texts: FloatingText[] = [];
  private readonly enemies: Enemy[] = [];
  private readonly chests: Chest[] = [];
  private readonly visitedTraps = new Set<string>();
  private readonly equipped = new Map<EquipmentSlot, Equipment>();
  private readonly mouse = { x: 0, y: 0, down: false, active: false };

  private save: SaveData;
  private stage!: StageConfig;
  private maze!: Maze;
  player!: Player;
  private running = false;
  private paused = false;
  private gameOver = false;
  private bossSpawned = false;
  private bossDefeated = false;
  private elapsed = 0;
  private timeLeft = 0;
  private spawnTimer = 0;
  private flowTimer = 0;
  private mapTimer = 0;
  private screenShake = 0;
  private lastTime = 0;
  private animationFrame = 0;
  private enemyId = 0;
  private distanceMap: number[][] = [];
  private nearestChest: Chest | null = null;
  private gamepadAttack = false;
  private lastInputX = 1;
  private lastInputY = 0;

  constructor(canvas: HTMLCanvasElement, minimapCanvas: HTMLCanvasElement, ui: GameUI) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
    this.context.imageSmoothingEnabled = false;
    this.minimapCanvas = minimapCanvas;
    this.ui = ui;
    this.save = this.loadSave();
    this.hydrateEquipment();
    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    for (let index = 0; index < 132; index += 1) this.loadSprite(index);
  }

  get hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null;
  }

  get saveData(): SaveData {
    return this.save;
  }

  get isRunning(): boolean {
    return this.running;
  }

  setPaused(paused: boolean): void {
    if (!this.running || this.gameOver) return;
    this.paused = paused;
  }

  start(floor = this.save.selectedFloor): void {
    this.audio.unlock();
    this.stage = getStageConfig(Math.max(1, Math.min(this.save.unlockedFloor, floor)));
    this.save.selectedFloor = this.stage.floor;
    this.persistSave();
    this.maze = generateMaze(
      this.stage.mazeWidth,
      this.stage.mazeHeight,
      this.stage.treasureCount,
      this.stage.trapCount,
      Date.now(),
    );
    const spawn = this.cellCenter(this.maze.spawn);
    const stats = this.computedStats();
    this.player = {
      x: spawn.x,
      y: spawn.y,
      radius: 13,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      mana: 100,
      maxMana: 100,
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.moveSpeed,
      attackSpeed: stats.attackSpeed,
      critChance: stats.critChance,
      critDamage: stats.critDamage,
      lifeSteal: stats.lifeSteal,
      level: 1,
      xp: 0,
      xpNeeded: 40,
      shootCooldown: 0,
      dashCooldown: 1.65 * (1 - stats.cooldownReduction),
      dashTimer: 0,
      dashReady: 0,
      invulnerable: 0,
      facing: 0,
      projectiles: 1,
      projectilePierce: 0,
      thorns: 0,
      auraDamage: stats.elementDamage,
      auraTimer: 0,
      chainChance: 0,
      shield: 0,
      shieldMax: 0,
      shieldRegen: 0,
    };
    this.running = true;
    this.paused = false;
    this.gameOver = false;
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.elapsed = 0;
    this.timeLeft = this.stage.duration;
    this.spawnTimer = 1;
    this.flowTimer = 0;
    this.mapTimer = 0;
    this.enemies.length = 0;
    this.chests.length = 0;
    this.projectiles.length = 0;
    this.particles.length = 0;
    this.texts.length = 0;
    this.upgradeStacks.clear();
    this.visitedTraps.clear();
    this.audio.setBossMode(false);

    this.maze.treasure.forEach((point, index) => {
      const center = this.cellCenter(point);
      this.chests.push({ ...center, opened: false, pulse: index * 0.8, secret: false });
    });
    this.maze.secrets.forEach((point, index) => {
      const center = this.cellCenter(point);
      this.chests.push({ ...center, opened: false, pulse: index, secret: true });
    });
    this.revealAroundPlayer();
    this.updateFlowField();
    this.lastTime = performance.now();
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame((time) => this.loop(time));
    this.ui.toast(`${this.stage.name} · Floor ${String(this.stage.floor).padStart(2, "0")}`, this.stage.palette[3]);
  }

  returnToTitle(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.audio.setBossMode(false);
  }

  continueAfterVictory(): void {
    const next = Math.min(20, this.stage.floor + 1);
    this.start(next);
  }

  retry(): void {
    this.start(this.stage?.floor ?? this.save.selectedFloor);
  }

  forgeUpgrade(): boolean {
    const items = [...this.equipped.values()].filter((item) => item.level < 20);
    const cost = 50 + (items[0]?.level ?? 0) * 25;
    if (items.length === 0 || this.save.gold < cost) {
      this.ui.toast(items.length === 0 ? "No equipment to upgrade" : `Need ${cost} gold`, "#ff6b74");
      return false;
    }
    const item = this.random.pick(items);
    this.save.gold -= cost;
    item.level += 1;
    const stored = this.save.equipment.find((entry) => entry.id === item.id);
    if (stored) stored.level = item.level;
    this.persistSave();
    this.ui.toast(`${item.name} improved to +${item.level}`, rarityColors[item.rarity]);
    return true;
  }

  equipmentSnapshot(): { items: Partial<Record<EquipmentSlot, Equipment>>; stats: ReturnType<Game["computedStats"]> } {
    const items: Partial<Record<EquipmentSlot, Equipment>> = {};
    this.equipped.forEach((item, slot) => { items[slot] = item; });
    return { items, stats: this.computedStats() };
  }

  private loop(time: number): void {
    const dt = Math.min(0.033, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;
    if (this.running) {
      if (!this.paused && !this.gameOver) this.update(dt);
      this.draw();
      this.animationFrame = requestAnimationFrame((next) => this.loop(next));
    }
  }

  private update(dt: number): void {
    this.elapsed += dt;
    this.audio.update(dt);
    this.player.shootCooldown -= dt;
    this.player.dashReady -= dt;
    this.player.dashTimer -= dt;
    this.player.invulnerable -= dt;
    this.player.auraTimer -= dt;
    this.player.shieldRegen -= dt;
    this.screenShake = Math.max(0, this.screenShake - dt * 18);

    this.updateInput(dt);
    this.revealAroundPlayer();

    if (!this.bossSpawned) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const living = this.enemies.filter((enemy) => !enemy.dead).length;
        if (living < this.stage.enemyCount + Math.floor(this.elapsed / 25)) this.spawnEnemy();
        this.spawnTimer = Math.max(0.45, 1.8 - this.stage.floor * 0.035);
      }
      if (this.timeLeft <= 0) this.spawnBoss();
    }

    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.updateFlowField();
      this.flowTimer = 0.3;
    }

    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateTraps();
    this.updateParticles(dt);
    this.checkChestInteraction();
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.drawMinimap();
      this.mapTimer = 0.15;
    }
    this.pushHud();
  }

  private updateInput(dt: number): void {
    let dx = Number(keyMap.has("KeyD") || keyMap.has("ArrowRight")) - Number(keyMap.has("KeyA") || keyMap.has("ArrowLeft"));
    let dy = Number(keyMap.has("KeyS") || keyMap.has("ArrowDown")) - Number(keyMap.has("KeyW") || keyMap.has("ArrowUp"));
    let aimX = 0;
    let aimY = 0;
    this.gamepadAttack = false;

    const gamepad = navigator.getGamepads?.()[0];
    if (gamepad) {
      const deadzone = 0.18;
      if (Math.abs(gamepad.axes[0] ?? 0) > deadzone) dx = gamepad.axes[0];
      if (Math.abs(gamepad.axes[1] ?? 0) > deadzone) dy = gamepad.axes[1];
      aimX = Math.abs(gamepad.axes[2] ?? 0) > deadzone ? gamepad.axes[2] : 0;
      aimY = Math.abs(gamepad.axes[3] ?? 0) > deadzone ? gamepad.axes[3] : 0;
      this.gamepadAttack = Math.hypot(aimX, aimY) > deadzone || (gamepad.buttons[7]?.value ?? 0) > 0.2;
      if (gamepad.buttons[0]?.pressed && this.nearestChest) this.openChest(this.nearestChest);
      if (gamepad.buttons[1]?.pressed && this.player.dashReady <= 0) this.dash(dx, dy);
    }

    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 0) {
      dx /= magnitude;
      dy /= magnitude;
      this.lastInputX = dx;
      this.lastInputY = dy;
      const multiplier = this.player.dashTimer > 0 ? 3.4 : 1;
      this.movePlayer(dx * this.player.speed * multiplier * dt, dy * this.player.speed * multiplier * dt);
    }

    let angle = this.player.facing;
    if (this.mouse.active) {
      angle = Math.atan2(this.mouse.y - this.canvas.height / 2, this.mouse.x - this.canvas.width / 2);
    } else if (Math.hypot(aimX, aimY) > 0.2) {
      angle = Math.atan2(aimY, aimX);
    } else {
      const nearest = this.nearestEnemy();
      if (nearest) angle = Math.atan2(nearest.y - this.player.y, nearest.x - this.player.x);
    }
    this.player.facing = angle;
    if ((this.mouse.down || this.gamepadAttack || keyMap.has("KeyJ")) && this.player.shootCooldown <= 0) this.shoot(angle);
  }

  private movePlayer(dx: number, dy: number): void {
    const nextX = this.player.x + dx;
    if (this.circleWalkable(nextX, this.player.y, this.player.radius)) this.player.x = nextX;
    const nextY = this.player.y + dy;
    if (this.circleWalkable(this.player.x, nextY, this.player.radius)) this.player.y = nextY;
  }

  private dash(dx: number, dy: number): void {
    if (this.player.dashReady > 0) return;
    if (Math.hypot(dx, dy) === 0) {
      dx = this.lastInputX;
      dy = this.lastInputY;
    }
    this.lastInputX = dx;
    this.lastInputY = dy;
    this.player.dashTimer = 0.17;
    this.player.dashReady = this.player.dashCooldown;
    this.player.invulnerable = 0.25;
    this.audio.dash();
    for (let i = 0; i < 14; i += 1) this.addParticle(this.player.x, this.player.y, "#65f1d0", 3, 120);
  }

  private shoot(angle: number): void {
    const count = this.player.projectiles;
    const spread = Math.min(0.42, (count - 1) * 0.11);
    for (let index = 0; index < count; index += 1) {
      const offset = count === 1 ? 0 : -spread + (spread * 2 * index) / (count - 1);
      const shotAngle = angle + offset;
      this.activateProjectile({
        x: this.player.x + Math.cos(shotAngle) * 18,
        y: this.player.y + Math.sin(shotAngle) * 18,
        vx: Math.cos(shotAngle) * 530,
        vy: Math.sin(shotAngle) * 530,
        radius: 5,
        damage: this.player.attack,
        life: 1.2,
        pierce: this.player.projectilePierce,
        enemy: false,
        color: "#70f3d1",
      });
    }
    this.player.shootCooldown = 0.34 / this.player.attackSpeed;
    this.audio.shoot();
  }

  private spawnEnemy(forceElite = false): void {
    const playerCell = this.worldToCell(this.player.x, this.player.y);
    const candidates = this.maze.floors.filter((point) => {
      const distance = Math.abs(point.x - playerCell.x) + Math.abs(point.y - playerCell.y);
      return distance > 7 && distance < 16 && this.maze.cells[point.y][point.x].discovered;
    });
    const fallback = this.maze.floors.filter((point) => Math.abs(point.x - playerCell.x) + Math.abs(point.y - playerCell.y) > 8);
    const point = this.random.pick(candidates.length > 0 ? candidates : fallback);
    if (!point) return;
    const center = this.cellCenter(point);
    const unlockedKinds = enemyKinds.slice(0, Math.min(enemyKinds.length, 2 + Math.floor(this.stage.floor / 2)));
    const kind = this.random.pick(unlockedKinds);
    const elite = forceElite || this.random.next() < this.stage.eliteChance;
    const scale = elite ? 2.5 : 1;
    this.enemies.push({
      id: ++this.enemyId,
      ...center,
      radius: kind.radius * (elite ? 1.25 : 1),
      hp: this.stage.enemyHp * scale * (0.85 + this.random.next() * 0.3),
      maxHp: this.stage.enemyHp * scale,
      damage: this.stage.enemyDamage * (elite ? 1.7 : 1),
      speed: kind.speed * (1 + this.stage.floor * 0.006),
      kind,
      elite,
      boss: false,
      name: elite ? `Elite ${kind.name}` : kind.name,
      hitFlash: 0,
      attackCooldown: this.random.next(),
      specialCooldown: 1 + this.random.next() * 2,
      chargeTimer: 0,
      phase: 1,
      dead: false,
    });
  }

  private spawnBoss(): void {
    this.bossSpawned = true;
    this.audio.setBossMode(true);
    this.audio.boss();
    const center = this.cellCenter(this.maze.boss);
    const kind = enemyKinds[Math.min(enemyKinds.length - 1, Math.floor(this.stage.floor / 3) + 2)];
    this.enemies.push({
      id: ++this.enemyId,
      ...center,
      radius: 31,
      hp: this.stage.bossHp,
      maxHp: this.stage.bossHp,
      damage: this.stage.enemyDamage * 2.2,
      speed: 76 + this.stage.floor * 1.5,
      kind,
      elite: true,
      boss: true,
      name: this.stage.bossName,
      hitFlash: 0,
      attackCooldown: 1,
      specialCooldown: 1.5,
      chargeTimer: 0,
      phase: 1,
      dead: false,
    });
    this.maze.cells[this.maze.boss.y][this.maze.boss.x].discovered = true;
    this.ui.flash("#d756ff");
    this.ui.toast(`${this.stage.bossName} has awakened`, "#ff6b9d");
    this.screenShake = 14;
  }

  private updateEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.hitFlash -= dt;
      enemy.attackCooldown -= dt;
      enemy.specialCooldown -= dt;
      enemy.chargeTimer -= dt;
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const nx = dx / distance;
      const ny = dy / distance;

      if (enemy.boss) {
        const hpRatio = enemy.hp / enemy.maxHp;
        enemy.phase = hpRatio > 0.66 ? 1 : hpRatio > 0.3 ? 2 : 3;
        if (enemy.specialCooldown <= 0) {
          if (enemy.phase === 1) this.radialBurst(enemy, 8, "#e75d88");
          else if (enemy.phase === 2) {
            this.radialBurst(enemy, 12, "#b56cff");
            for (let i = 0; i < 2; i += 1) this.spawnEnemy(true);
          } else {
            this.radialBurst(enemy, 18, "#ff734d");
            enemy.chargeTimer = 0.55;
            this.screenShake = 10;
          }
          enemy.specialCooldown = Math.max(0.7, 2.5 - enemy.phase * 0.4);
        }
      } else if (enemy.kind.behavior === "ranged" && distance < 370 && enemy.specialCooldown <= 0) {
        this.enemyShot(enemy, Math.atan2(dy, dx));
        enemy.specialCooldown = 1.5 + this.random.next();
      } else if (enemy.kind.behavior === "charger" && distance < 300 && enemy.specialCooldown <= 0) {
        enemy.chargeTimer = 0.45;
        enemy.specialCooldown = 3;
      }

      const movement = enemy.chargeTimer > 0
        ? { x: nx * enemy.speed * 2.7, y: ny * enemy.speed * 2.7 }
        : this.enemyDirection(enemy, nx, ny);
      const speedMultiplier = enemy.boss ? 1 + (enemy.phase - 1) * 0.2 : 1;
      this.moveEnemy(enemy, movement.x * speedMultiplier * dt, movement.y * speedMultiplier * dt);

      if (distance < this.player.radius + enemy.radius + 3 && enemy.attackCooldown <= 0) {
        this.damagePlayer(enemy.damage);
        enemy.attackCooldown = enemy.boss ? 0.6 : 0.9;
        if (this.player.thorns > 0) this.damageEnemy(enemy, enemy.damage * this.player.thorns, false);
      }
    }

    if (this.player.auraDamage > 0 && this.player.auraTimer <= 0) {
      this.player.auraTimer = 0.6;
      for (const enemy of this.enemies) {
        if (!enemy.dead && Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y) < 115) {
          this.damageEnemy(enemy, this.player.auraDamage, false, "#ff9d47");
        }
      }
      for (let i = 0; i < 12; i += 1) this.addParticle(this.player.x, this.player.y, "#ff7a3d", 3, 90);
    }
  }

  private enemyDirection(enemy: Enemy, directX: number, directY: number): Vec2 {
    const cell = this.worldToCell(enemy.x, enemy.y);
    const currentDistance = this.distanceMap[cell.y]?.[cell.x] ?? Infinity;
    let best = { x: directX, y: directY };
    let bestDistance = currentDistance;
    for (const offset of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const distance = this.distanceMap[cell.y + offset.y]?.[cell.x + offset.x] ?? Infinity;
      if (distance < bestDistance) {
        bestDistance = distance;
        const target = this.cellCenter({ x: cell.x + offset.x, y: cell.y + offset.y });
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const magnitude = Math.max(1, Math.hypot(dx, dy));
        best = { x: dx / magnitude, y: dy / magnitude };
      }
    }
    return { x: best.x * enemy.speed, y: best.y * enemy.speed };
  }

  private moveEnemy(enemy: Enemy, dx: number, dy: number): void {
    const nextX = enemy.x + dx;
    if (this.circleWalkable(nextX, enemy.y, enemy.radius)) enemy.x = nextX;
    const nextY = enemy.y + dy;
    if (this.circleWalkable(enemy.x, nextY, enemy.radius)) enemy.y = nextY;
  }

  private enemyShot(enemy: Enemy, angle: number): void {
    this.activateProjectile({
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(angle) * 235,
      vy: Math.sin(angle) * 235,
      radius: enemy.boss ? 7 : 5,
      damage: enemy.damage * 0.75,
      life: 2.4,
      pierce: 0,
      enemy: true,
      color: enemy.boss ? "#ff5f82" : "#c37aff",
    });
  }

  private radialBurst(enemy: Enemy, count: number, color: string): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + this.elapsed * 0.4;
      this.activateProjectile({
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(angle) * (190 + enemy.phase * 20),
        vy: Math.sin(angle) * (190 + enemy.phase * 20),
        radius: 6,
        damage: enemy.damage * 0.65,
        life: 3,
        pierce: 0,
        enemy: true,
        color,
      });
    }
  }

  private updateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      projectile.life -= dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      if (projectile.life <= 0 || !this.circleWalkable(projectile.x, projectile.y, projectile.radius)) {
        projectile.active = false;
        continue;
      }

      if (projectile.enemy) {
        if (Math.hypot(projectile.x - this.player.x, projectile.y - this.player.y) < projectile.radius + this.player.radius) {
          projectile.active = false;
          this.damagePlayer(projectile.damage);
        }
        continue;
      }

      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) >= projectile.radius + enemy.radius) continue;
        const critical = this.random.next() < this.player.critChance;
        const damage = projectile.damage * (critical ? this.player.critDamage : 1);
        this.damageEnemy(enemy, damage, critical);
        if (this.player.lifeSteal > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + damage * this.player.lifeSteal);
        if (this.player.chainChance > 0 && this.random.next() < this.player.chainChance) this.chainLightning(enemy, damage * 0.55);
        projectile.pierce -= 1;
        if (projectile.pierce < 0) projectile.active = false;
        break;
      }
    }
  }

  private damageEnemy(enemy: Enemy, amount: number, critical: boolean, color?: string): void {
    if (enemy.dead) return;
    enemy.hp -= amount;
    enemy.hitFlash = 0.09;
    this.audio.hit(critical);
    this.texts.push({
      x: enemy.x,
      y: enemy.y - enemy.radius,
      text: String(Math.round(amount)),
      color: color ?? (critical ? "#ffd866" : "#ecf8ff"),
      life: 0.65,
      critical,
    });
    for (let i = 0; i < (critical ? 8 : 3); i += 1) this.addParticle(enemy.x, enemy.y, color ?? enemy.kind.accent, critical ? 4 : 2, 110);
    if (critical) this.screenShake = Math.max(this.screenShake, 4);
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  private killEnemy(enemy: Enemy): void {
    enemy.dead = true;
    for (let i = 0; i < (enemy.boss ? 60 : enemy.elite ? 22 : 10); i += 1) {
      this.addParticle(enemy.x, enemy.y, enemy.boss ? "#ffca69" : enemy.kind.color, enemy.boss ? 6 : 3, enemy.boss ? 260 : 150);
    }
    if (enemy.boss) {
      this.completeStage();
      return;
    }
    const xp = enemy.kind.xp * (enemy.elite ? 4 : 1);
    this.gainXp(xp);
    const gold = Math.max(1, Math.round((2 + this.stage.floor * 0.5) * (enemy.elite ? 4 : 1)));
    this.save.gold += gold;
    if (enemy.elite) this.ui.toast(`Elite defeated · +${gold} gold`, "#ffbf58");
  }

  private chainLightning(source: Enemy, amount: number): void {
    const target = this.enemies
      .filter((enemy) => !enemy.dead && enemy.id !== source.id && Math.hypot(enemy.x - source.x, enemy.y - source.y) < 150)
      .sort((a, b) => Math.hypot(a.x - source.x, a.y - source.y) - Math.hypot(b.x - source.x, b.y - source.y))[0];
    if (!target) return;
    this.damageEnemy(target, amount, false, "#80dfff");
    const steps = 8;
    for (let index = 0; index < steps; index += 1) {
      const t = index / steps;
      this.particles.push({
        x: source.x + (target.x - source.x) * t,
        y: source.y + (target.y - source.y) * t,
        vx: 0,
        vy: 0,
        life: 0.18,
        maxLife: 0.18,
        size: 3,
        color: "#8deaff",
      });
    }
  }

  private damagePlayer(rawDamage: number): void {
    if (this.player.invulnerable > 0 || this.gameOver) return;
    let damage = Math.max(1, rawDamage - this.player.defense * 0.7);
    if (this.player.shield > 0) {
      const absorbed = Math.min(this.player.shield, damage);
      this.player.shield -= absorbed;
      damage -= absorbed;
    }
    this.player.hp -= damage;
    this.player.invulnerable = 0.4;
    this.player.shieldRegen = 4;
    this.audio.hurt();
    this.ui.flash("#ff304f");
    this.screenShake = 8;
    this.texts.push({ x: this.player.x, y: this.player.y - 22, text: `-${Math.round(damage)}`, color: "#ff657d", life: 0.7, critical: false });
    if (this.player.hp <= 0) this.endRun();
  }

  private gainXp(amount: number): void {
    this.player.xp += amount;
    while (this.player.xp >= this.player.xpNeeded) {
      this.player.xp -= this.player.xpNeeded;
      this.player.level += 1;
      this.player.xpNeeded = Math.round(this.player.xpNeeded * 1.28);
      this.audio.level();
      this.presentLevelChoices();
      break;
    }
  }

  private presentLevelChoices(): void {
    this.paused = true;
    const available = upgrades.filter((upgrade) => (this.upgradeStacks.get(upgrade.id) ?? 0) < upgrade.maxStacks);
    const choices = this.random.shuffle([...available]).slice(0, 3).map((upgrade) => this.upgradeChoice(upgrade));
    this.ui.showChoices("ARCANE ASCENSION", `LEVEL ${this.player.level} — CHOOSE A POWER`, choices);
  }

  private upgradeChoice(upgrade: Upgrade): ChoiceOption {
    return {
      name: upgrade.name,
      description: upgrade.description,
      icon: upgrade.icon,
      rarity: upgrade.rarity,
      tag: `LEVEL ${(this.upgradeStacks.get(upgrade.id) ?? 0) + 1}/${upgrade.maxStacks}`,
      select: () => {
        upgrade.apply(this);
        const stacks = (this.upgradeStacks.get(upgrade.id) ?? 0) + 1;
        this.upgradeStacks.set(upgrade.id, stacks);
        if (upgrade.id === "shield") {
          this.player.shieldMax = this.player.shield;
          this.player.shieldRegen = 0;
        }
        this.paused = false;
        this.ui.toast(`${upgrade.name} acquired`, rarityColors[upgrade.rarity]);
      },
    };
  }

  private checkChestInteraction(): void {
    this.nearestChest = this.chests
      .filter((chest) => !chest.opened && Math.hypot(chest.x - this.player.x, chest.y - this.player.y) < 64)
      .sort((a, b) => Math.hypot(a.x - this.player.x, a.y - this.player.y) - Math.hypot(b.x - this.player.x, b.y - this.player.y))[0] ?? null;
    this.ui.setInteraction(Boolean(this.nearestChest), this.nearestChest?.secret ? "OPEN SECRET CACHE" : "OPEN CHEST");
  }

  private openChest(chest: Chest): void {
    if (chest.opened || this.paused) return;
    chest.opened = true;
    this.paused = true;
    this.audio.chest();
    for (let i = 0; i < 28; i += 1) this.addParticle(chest.x, chest.y, chest.secret ? "#d278ff" : "#ffd36b", 4, 190);
    const options: ChoiceOption[] = [];
    const upgradePool = this.random.shuffle([...upgrades]).filter(
      (upgrade) => (this.upgradeStacks.get(upgrade.id) ?? 0) < upgrade.maxStacks,
    );
    options.push(this.upgradeChoice(upgradePool[0]));
    options.push(this.equipmentChoice(this.generateEquipment(chest.secret ? 2 : 0)));
    if (this.random.next() < 0.5) {
      const gold = 45 + this.stage.floor * 12;
      options.push({
        name: "Labyrinth Hoard",
        description: `Gain ${gold} gold and restore 25 health`,
        icon: "◆",
        rarity: chest.secret ? "Epic" : "Rare",
        tag: "IMMEDIATE",
        select: () => {
          this.save.gold += gold;
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
          this.paused = false;
          this.ui.toast(`+${gold} gold`, "#ffd36b");
        },
      });
    } else {
      options.push(this.upgradeChoice(upgradePool[1]));
    }
    this.ui.showChoices(chest.secret ? "SECRET CACHE DISCOVERED" : "TREASURE FOUND", "CHOOSE YOUR REWARD", options);
  }

  private equipmentChoice(item: Equipment): ChoiceOption {
    return {
      name: item.name,
      description: `${item.slot} · ${this.describeStats(item)}`,
      icon: item.icon,
      rarity: item.rarity,
      tag: `${item.rarity.toUpperCase()} EQUIPMENT`,
      select: () => {
        this.acquireEquipment(item);
        this.paused = false;
        this.ui.toast(`${item.name} equipped`, rarityColors[item.rarity]);
      },
    };
  }

  private generateEquipment(rarityBonus = 0): Equipment {
    const slot = this.random.pick(slots);
    const roll = this.random.next() + this.stage.floor * 0.018 + rarityBonus * 0.12;
    let rarityIndex = roll > 1.28 ? 5 : roll > 1.08 ? 4 : roll > 0.9 ? 3 : roll > 0.62 ? 2 : roll > 0.3 ? 1 : 0;
    rarityIndex = Math.min(rarityOrder.length - 1, rarityIndex);
    const rarity = rarityOrder[rarityIndex];
    const multiplier = 1 + rarityIndex * 0.55 + this.stage.floor * 0.08;
    const stats: Equipment["stats"] = {};
    if (slot === "Weapon") stats.attack = Math.round(7 * multiplier);
    if (slot === "Helmet") { stats.maxHp = Math.round(10 * multiplier); stats.critChance = 0.01 * (rarityIndex + 1); }
    if (slot === "Armor") { stats.defense = Math.round(3 * multiplier); stats.maxHp = Math.round(8 * multiplier); }
    if (slot === "Boots") stats.moveSpeed = Math.round(8 * multiplier);
    if (slot === "Ring") { stats.critChance = 0.018 * (rarityIndex + 1); stats.critDamage = 0.08 * (rarityIndex + 1); }
    if (slot === "Amulet") { stats.lifeSteal = 0.008 * (rarityIndex + 1); stats.attack = Math.round(2 * multiplier); }
    if (slot === "Artifact") { stats.elementDamage = Math.round(3 * multiplier); stats.cooldownReduction = 0.015 * (rarityIndex + 1); }
    const names = itemNames[slot];
    return {
      id: `${Date.now()}-${Math.floor(this.random.next() * 1e8)}`,
      name: this.random.pick(names),
      slot,
      rarity,
      level: 0,
      icon: slotIcons[slot],
      stats,
      effect: rarityIndex >= 3 ? ["Burning attacks", "Frozen retaliation", "Echoing strikes", "Guardian spirit"][rarityIndex % 4] : undefined,
    };
  }

  private acquireEquipment(item: Equipment): void {
    this.save.equipment.push(item);
    this.save.equipped[item.slot] = item.id;
    this.equipped.set(item.slot, item);
    const stats = this.computedStats();
    const hpRatio = this.player.hp / this.player.maxHp;
    this.player.maxHp = stats.maxHp;
    this.player.hp = Math.min(this.player.maxHp, Math.max(1, this.player.maxHp * hpRatio));
    this.player.attack = stats.attack;
    this.player.defense = stats.defense;
    this.player.speed = stats.moveSpeed;
    this.player.attackSpeed = stats.attackSpeed;
    this.player.critChance = stats.critChance;
    this.player.critDamage = stats.critDamage;
    this.player.lifeSteal = stats.lifeSteal;
    this.persistSave();
  }

  private updateTraps(): void {
    const cell = this.worldToCell(this.player.x, this.player.y);
    const current = this.maze.cells[cell.y]?.[cell.x];
    if (!current || current.room !== "trap") return;
    const key = `${cell.x}:${cell.y}`;
    if (this.visitedTraps.has(key)) return;
    this.visitedTraps.add(key);
    this.damagePlayer(12 + this.stage.floor * 2);
    this.ui.toast("A hidden rune erupts beneath you", "#ff775f");
    for (let i = 0; i < 18; i += 1) this.addParticle(this.player.x, this.player.y, "#ff633f", 4, 160);
  }

  private updateParticles(dt: number): void {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.97;
      particle.vy *= 0.97;
    }
    for (const text of this.texts) {
      text.life -= dt;
      text.y -= 36 * dt;
    }
    while (this.particles.length > 650) this.particles.shift();
    while (this.texts.length > 80) this.texts.shift();
  }

  private completeStage(): void {
    if (this.bossDefeated) return;
    this.bossDefeated = true;
    this.paused = true;
    this.audio.setBossMode(false);
    this.audio.victory();
    const gold = 160 + this.stage.floor * 45;
    const stones = 2 + Math.ceil(this.stage.floor / 3);
    const crystals = this.stage.floor >= 5 ? Math.ceil(this.stage.floor / 5) : 0;
    this.save.gold += gold;
    this.save.stones += stones;
    this.save.crystals += crystals;
    this.save.unlockedFloor = Math.max(this.save.unlockedFloor, Math.min(20, this.stage.floor + 1));
    this.save.selectedFloor = Math.min(20, this.stage.floor + 1);
    if (this.stage.floor === 20) this.save.permanentPower += 1;
    const bossItem = this.generateEquipment(2);
    this.acquireEquipment(bossItem);
    this.persistSave();
    const rewards = [`◆ ${gold} GOLD`, `⬡ ${stones} UPGRADE STONES`, `✦ ${crystals} CRYSTALS`, `${bossItem.icon} ${bossItem.name}`];
    window.setTimeout(() => {
      this.ui.showStageComplete(
        this.stage.floor === 20 ? "THE ETERNAL MAZE CONQUERED" : `FLOOR ${String(this.stage.floor).padStart(2, "0")} CLEARED`,
        rewards,
      );
    }, 800);
  }

  private endRun(): void {
    this.gameOver = true;
    this.paused = true;
    this.persistSave();
    this.ui.showGameOver(
      `Reached Floor ${this.stage.floor} · Level ${this.player.level} · ${Math.floor(this.elapsed)}s survived · ${this.save.gold} total gold`,
    );
  }

  private draw(): void {
    const ctx = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    const cameraX = this.player.x - width / 2 - shakeX;
    const cameraY = this.player.y - height / 2 - shakeY;
    ctx.fillStyle = "#070910";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(-cameraX, -cameraY);
    this.drawMaze(cameraX, cameraY, width, height);
    this.drawTraps();
    this.drawChests();
    this.drawProjectiles();
    this.drawEnemies();
    this.drawPlayer();
    this.drawParticles();
    this.drawTexts();
    ctx.restore();

    this.drawLighting();
  }

  private drawMaze(cameraX: number, cameraY: number, width: number, height: number): void {
    const ctx = this.context;
    const startX = Math.max(0, Math.floor(cameraX / TILE_SIZE) - 1);
    const startY = Math.max(0, Math.floor(cameraY / TILE_SIZE) - 1);
    const endX = Math.min(this.maze.width, Math.ceil((cameraX + width) / TILE_SIZE) + 1);
    const endY = Math.min(this.maze.height, Math.ceil((cameraY + height) / TILE_SIZE) + 1);
    const [voidColor, floorColor, wallColor, accent] = this.stage.palette;

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const cell = this.maze.cells[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        if (cell.wall) {
          ctx.fillStyle = voidColor;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          const exposed = this.maze.cells[y + 1]?.[x] && !this.maze.cells[y + 1][x].wall;
          if (exposed) {
            ctx.fillStyle = wallColor;
            ctx.fillRect(px, py + TILE_SIZE * 0.45, TILE_SIZE, TILE_SIZE * 0.55);
            ctx.fillStyle = `${accent}22`;
            ctx.fillRect(px + 3, py + TILE_SIZE * 0.48, TILE_SIZE - 6, 3);
            ctx.fillStyle = "#090b12";
            for (let brick = 0; brick < 3; brick += 1) {
              ctx.fillRect(px + 4 + brick * 16 + (y % 2) * 5, py + 31 + (brick % 2) * 8, 10, 2);
            }
          }
          continue;
        }

        const shade = cell.variant * 3;
        ctx.fillStyle = this.shiftColor(floorColor, shade);
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = `${accent}10`;
        ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        ctx.fillStyle = "#05070b33";
        if (cell.variant === 0) ctx.fillRect(px + 9, py + 13, 3, 2);
        if (cell.variant === 1) ctx.fillRect(px + 31, py + 32, 5, 2);
        if (cell.room === "boss") {
          ctx.strokeStyle = `${accent}66`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px + 24, py + 24, 17 + Math.sin(this.elapsed * 2) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (cell.room === "secret") {
          ctx.fillStyle = `${accent}24`;
          ctx.fillRect(px + 5, py + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        }
      }
    }
  }

  private drawTraps(): void {
    const ctx = this.context;
    for (const point of this.maze.traps) {
      const key = `${point.x}:${point.y}`;
      if (!this.maze.cells[point.y][point.x].discovered && !this.visitedTraps.has(key)) continue;
      const center = this.cellCenter(point);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.strokeStyle = this.visitedTraps.has(key) ? "#9a3c36" : "#6d4e45";
      ctx.lineWidth = 2;
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.fillStyle = this.visitedTraps.has(key) ? "#ff6845" : "#9d795d";
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
  }

  private drawChests(): void {
    const ctx = this.context;
    for (const chest of this.chests) {
      if (chest.opened) continue;
      chest.pulse += 0.02;
      const glow = 8 + Math.sin(chest.pulse * 2) * 3;
      ctx.save();
      ctx.shadowBlur = glow;
      ctx.shadowColor = chest.secret ? "#b85eff" : "#ffd05b";
      const sprite = this.sprites.get(16);
      if (sprite?.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, chest.x - 18, chest.y - 20, 36, 36);
      } else {
        ctx.fillStyle = chest.secret ? "#7c48a8" : "#9c6030";
        ctx.fillRect(chest.x - 15, chest.y - 10, 30, 20);
        ctx.fillStyle = chest.secret ? "#d08bff" : "#ffd56a";
        ctx.fillRect(chest.x - 15, chest.y - 13, 30, 8);
        ctx.fillRect(chest.x - 3, chest.y - 13, 6, 23);
      }
      ctx.restore();
    }
  }

  private drawEnemies(): void {
    const ctx = this.context;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const bob = Math.sin(this.elapsed * 6 + enemy.id) * 2;
      ctx.save();
      ctx.translate(enemy.x, enemy.y + bob);
      if (enemy.elite) {
        ctx.strokeStyle = enemy.boss ? "#ffce66" : "#c36cff";
        ctx.lineWidth = enemy.boss ? 4 : 2;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius + 7 + Math.sin(this.elapsed * 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = enemy.boss ? 22 : enemy.elite ? 12 : 5;
      ctx.shadowColor = enemy.kind.color;
      if (enemy.hitFlash > 0) ctx.globalCompositeOperation = "screen";
      const sprite = this.sprites.get(enemy.kind.sprite);
      const size = enemy.radius * 2.8;
      if (sprite?.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      } else {
        ctx.fillStyle = enemy.hitFlash > 0 ? "#ffffff" : enemy.kind.color;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (enemy.elite || enemy.hp < enemy.maxHp) {
        const barWidth = enemy.boss ? 70 : 36;
        ctx.fillStyle = "#080a10cc";
        ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.radius - 13, barWidth, 5);
        ctx.fillStyle = enemy.boss ? "#ff596f" : "#b56cff";
        ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.radius - 13, barWidth * Math.max(0, enemy.hp / enemy.maxHp), 5);
      }
    }
  }

  private drawPlayer(): void {
    const ctx = this.context;
    const blink = this.player.invulnerable > 0 && Math.floor(this.elapsed * 20) % 2 === 0;
    if (blink) return;
    ctx.save();
    ctx.translate(this.player.x, this.player.y + Math.sin(this.elapsed * 7) * 1.5);
    ctx.rotate(this.player.facing + Math.PI / 2);
    ctx.shadowBlur = 14;
    ctx.shadowColor = "#4ce3bd";
    const sprite = this.sprites.get(84);
    if (sprite?.complete && sprite.naturalWidth > 0) {
      ctx.rotate(-this.player.facing - Math.PI / 2);
      ctx.scale(Math.cos(this.player.facing) < 0 ? -1 : 1, 1);
      ctx.drawImage(sprite, -19, -22, 38, 38);
    } else {
      ctx.fillStyle = "#dce9ef";
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(12, 13);
      ctx.lineTo(0, 8);
      ctx.lineTo(-12, 13);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    if (this.player.shield > 0) {
      ctx.strokeStyle = "#73d7ff88";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y, 22 + Math.sin(this.elapsed * 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.player.auraDamage > 0) {
      const gradient = ctx.createRadialGradient(this.player.x, this.player.y, 20, this.player.x, this.player.y, 105);
      gradient.addColorStop(0, "#ff9a3a22");
      gradient.addColorStop(1, "#ff5c2700");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y, 105, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawProjectiles(): void {
    const ctx = this.context;
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      ctx.save();
      ctx.fillStyle = projectile.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = projectile.color;
      ctx.beginPath();
      ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawParticles(): void {
    const ctx = this.context;
    for (const particle of this.particles) {
      if (particle.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts(): void {
    const ctx = this.context;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const text of this.texts) {
      if (text.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, text.life * 3);
      ctx.font = `${text.critical ? "bold 19px" : "bold 14px"} monospace`;
      ctx.strokeStyle = "#090b12";
      ctx.lineWidth = 4;
      ctx.strokeText(text.text, text.x, text.y);
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, text.x, text.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawLighting(): void {
    const ctx = this.context;
    const gradient = ctx.createRadialGradient(
      this.canvas.width / 2,
      this.canvas.height / 2,
      120,
      this.canvas.width / 2,
      this.canvas.height / 2,
      Math.max(this.canvas.width, this.canvas.height) * 0.7,
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.5, "rgba(4,5,10,.15)");
    gradient.addColorStop(1, "rgba(1,2,6,.78)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "rgba(5,8,15,.12)";
    for (let y = 0; y < this.canvas.height; y += 4) ctx.fillRect(0, y, this.canvas.width, 1);
  }

  private drawMinimap(): void {
    const ctx = this.minimapCanvas.getContext("2d");
    if (!ctx) return;
    const scale = Math.min(this.minimapCanvas.width / this.maze.width, this.minimapCanvas.height / this.maze.height);
    const offsetX = (this.minimapCanvas.width - this.maze.width * scale) / 2;
    const offsetY = (this.minimapCanvas.height - this.maze.height * scale) / 2;
    ctx.clearRect(0, 0, this.minimapCanvas.width, this.minimapCanvas.height);
    ctx.fillStyle = "#070a10";
    ctx.fillRect(0, 0, this.minimapCanvas.width, this.minimapCanvas.height);
    for (let y = 0; y < this.maze.height; y += 1) {
      for (let x = 0; x < this.maze.width; x += 1) {
        const cell = this.maze.cells[y][x];
        if (!cell.discovered || cell.wall) continue;
        ctx.fillStyle = cell.room === "boss" && this.bossSpawned ? "#df547e" : cell.room === "treasure" ? "#e4b94f" : "#4c596b";
        ctx.fillRect(offsetX + x * scale, offsetY + y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    const playerCell = this.worldToCell(this.player.x, this.player.y);
    ctx.fillStyle = "#72f4d4";
    ctx.fillRect(offsetX + playerCell.x * scale - 1, offsetY + playerCell.y * scale - 1, Math.max(3, scale + 2), Math.max(3, scale + 2));
  }

  private revealAroundPlayer(): void {
    const cell = this.worldToCell(this.player.x, this.player.y);
    for (let y = cell.y - 3; y <= cell.y + 3; y += 1) {
      for (let x = cell.x - 3; x <= cell.x + 3; x += 1) {
        if (this.maze.cells[y]?.[x] && Math.hypot(x - cell.x, y - cell.y) <= 3.4) this.maze.cells[y][x].discovered = true;
      }
    }
  }

  private updateFlowField(): void {
    this.distanceMap = Array.from({ length: this.maze.height }, () => Array(this.maze.width).fill(Infinity));
    const start = this.worldToCell(this.player.x, this.player.y);
    const queue: Vec2[] = [start];
    this.distanceMap[start.y][start.x] = 0;
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++];
      const nextDistance = this.distanceMap[current.y][current.x] + 1;
      for (const offset of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
        const x = current.x + offset.x;
        const y = current.y + offset.y;
        if (!this.maze.cells[y]?.[x] || this.maze.cells[y][x].wall || this.distanceMap[y][x] <= nextDistance) continue;
        this.distanceMap[y][x] = nextDistance;
        queue.push({ x, y });
      }
    }
  }

  private pushHud(): void {
    const boss = this.enemies.find((enemy) => enemy.boss && !enemy.dead);
    this.ui.updateHud({
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      mana: this.player.shield > 0 ? this.player.shield : this.player.mana,
      maxMana: this.player.shield > 0 ? Math.max(1, this.player.shieldMax) : this.player.maxMana,
      xp: this.player.xp,
      xpNeeded: this.player.xpNeeded,
      level: this.player.level,
      gold: this.save.gold,
      floor: this.stage.floor,
      floorName: this.stage.name,
      time: this.timeLeft,
      objective: this.bossSpawned ? `Find and defeat ${this.stage.bossName}` : "Explore · Fight · Grow stronger",
      boss: boss ? {
        name: boss.name,
        hp: boss.hp,
        maxHp: boss.maxHp,
        phase: boss.phase === 1 ? "PHASE I" : boss.phase === 2 ? "PHASE II" : "ENRAGED",
      } : undefined,
    });
  }

  private computedStats(): typeof baseStats {
    const result = { ...baseStats };
    result.attack *= 1 + this.save.permanentPower * 0.05;
    result.maxHp *= 1 + this.save.permanentPower * 0.05;
    this.equipped.forEach((item) => {
      const levelMultiplier = 1 + item.level * 0.08;
      for (const [key, value] of Object.entries(item.stats) as [keyof typeof result, number][]) {
        result[key] += value * levelMultiplier;
      }
    });
    return result;
  }

  private describeStats(item: Equipment): string {
    const labels: Record<keyof typeof baseStats, string> = {
      attack: "ATK",
      defense: "DEF",
      maxHp: "HP",
      critChance: "CRIT",
      critDamage: "CRIT DMG",
      attackSpeed: "ATK SPD",
      moveSpeed: "MOVE",
      lifeSteal: "DRAIN",
      luck: "LUCK",
      cooldownReduction: "COOLDOWN",
      elementDamage: "ELEMENT",
    };
    return (Object.entries(item.stats) as [keyof typeof baseStats, number][])
      .map(([key, value]) => `+${value < 1 ? Math.round(value * 100) + "%" : Math.round(value)} ${labels[key]}`)
      .join(" · ");
  }

  private hydrateEquipment(): void {
    this.equipped.clear();
    for (const slot of slots) {
      const id = this.save.equipped[slot];
      const item = this.save.equipment.find((entry) => entry.id === id);
      if (item) this.equipped.set(slot, item);
    }
  }

  private loadSave(): SaveData {
    try {
      const stored = localStorage.getItem(SAVE_KEY);
      if (!stored) return structuredClone(defaultSave);
      return { ...structuredClone(defaultSave), ...(JSON.parse(stored) as SaveData) };
    } catch {
      return structuredClone(defaultSave);
    }
  }

  private persistSave(): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
  }

  private activateProjectile(data: Omit<Projectile, "active">): void {
    const projectile = this.projectiles.find((entry) => !entry.active);
    if (projectile) Object.assign(projectile, data, { active: true });
    else this.projectiles.push({ ...data, active: true });
  }

  private addParticle(x: number, y: number, color: string, size: number, speed: number): void {
    const angle = this.random.next() * Math.PI * 2;
    const velocity = speed * (0.3 + this.random.next() * 0.7);
    const life = 0.25 + this.random.next() * 0.45;
    this.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life,
      maxLife: life,
      size,
      color,
    });
  }

  private nearestEnemy(): Enemy | undefined {
    return this.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => Math.hypot(a.x - this.player.x, a.y - this.player.y) - Math.hypot(b.x - this.player.x, b.y - this.player.y))[0];
  }

  private circleWalkable(x: number, y: number, radius: number): boolean {
    const points = [
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius },
    ];
    return points.every((point) => {
      const cell = this.worldToCell(point.x, point.y);
      return Boolean(this.maze.cells[cell.y]?.[cell.x] && !this.maze.cells[cell.y][cell.x].wall);
    });
  }

  private cellCenter(point: Vec2): Vec2 {
    return { x: point.x * TILE_SIZE + TILE_SIZE / 2, y: point.y * TILE_SIZE + TILE_SIZE / 2 };
  }

  private worldToCell(x: number, y: number): Vec2 {
    return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) };
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.context.imageSmoothingEnabled = false;
  }

  private bindInput(): void {
    window.addEventListener("keydown", (event) => {
      keyMap.add(event.code);
      if (event.code === "Space") {
        event.preventDefault();
        if (this.running && !this.paused) this.dash(this.lastInputX, this.lastInputY);
      }
      if (event.code === "KeyE" && this.nearestChest && !this.paused) this.openChest(this.nearestChest);
    });
    window.addEventListener("keyup", (event) => keyMap.delete(event.code));
    this.canvas.addEventListener("pointermove", (event) => {
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
      this.mouse.active = true;
    });
    this.canvas.addEventListener("pointerdown", () => {
      this.mouse.down = true;
      this.audio.unlock();
    });
    window.addEventListener("pointerup", () => { this.mouse.down = false; });
    this.canvas.addEventListener("pointerleave", () => { this.mouse.active = false; });
  }

  private loadSprite(index: number): void {
    const image = new Image();
    image.src = `/assets/kenney/Tiles/tile_${String(index).padStart(4, "0")}.png`;
    this.sprites.set(index, image);
  }

  private shiftColor(hex: string, amount: number): string {
    const value = Number.parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (value >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((value >> 8) & 0xff) + amount));
    const b = Math.max(0, Math.min(255, (value & 0xff) + amount));
    return `rgb(${r},${g},${b})`;
  }
}
