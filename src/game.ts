import { AudioSystem } from "./audio";
import {
  biomeOrder,
  biomes,
  bossNames,
  defaultSave,
  equipmentNames,
  rarityColors,
  rarityOrder,
  slotIcons,
  slots,
} from "./data";
import { Random, hash2 } from "./random";
import {
  CHUNK_TILES,
  TILE,
  Tile,
} from "./types";
import type {
  Biome,
  Boss,
  ChunkChest,
  ChunkHazard,
  Equipment,
  EquipmentSlot,
  FloatingText,
  HudState,
  MerchantOffer,
  Particle,
  Player,
  Projectile,
  Rarity,
  RewardChoice,
  SaveData,
  TileId,
} from "./types";
import { World, type Arena } from "./world";

const SAVE_KEY = "underdeep-save-v1";
const FIXED_STEP = 1 / 60;
const GRAVITY = 1550;
const MAX_FALL = 720;
const keyState = new Set<string>();
const pressed = new Set<string>();

interface GameUI {
  updateHud: (state: HudState) => void;
  drawMinimap: (draw: (context: CanvasRenderingContext2D, width: number, height: number) => void) => void;
  showChoices: (kicker: string, title: string, choices: RewardChoice[]) => void;
  showMerchant: (offers: MerchantOffer[], close: () => void) => void;
  showInventory: (save: SaveData, equipped: Map<EquipmentSlot, Equipment>) => void;
  hideInventory: () => void;
  showBossIntro: (name: string) => void;
  hideBossIntro: () => void;
  showVictory: (title: string, rewards: string[]) => void;
  showDeath: (summary: string[]) => void;
  setInteraction: (label?: string) => void;
  toast: (message: string, color?: string) => void;
  flash: (color: string) => void;
}

interface Camera {
  x: number;
  y: number;
  shake: number;
}

interface Merchant {
  x: number;
  y: number;
  available: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const approach = (value: number, target: number, amount: number): number =>
  value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);

export class Game {
  readonly audio = new AudioSystem();
  private readonly context: CanvasRenderingContext2D;
  private readonly lightCanvas = document.createElement("canvas");
  private readonly lightContext = this.lightCanvas.getContext("2d")!;
  private save = this.loadSave();
  private world = new World(this.save.seed || Date.now(), this.save.stage, this.save);
  private player = this.createPlayer();
  private boss?: Boss;
  private arena?: Arena;
  private merchant: Merchant = { x: 0, y: 0, available: true };
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];
  private equipped = new Map<EquipmentSlot, Equipment>();
  private camera: Camera = { x: 0, y: 0, shake: 0 };
  private random = new Random(Date.now());
  private running = false;
  private paused = false;
  private accumulator = 0;
  private previousTime = performance.now();
  private stageTime = 180;
  private bossIntro = 0;
  private bossDefeated = false;
  private attackHit = false;
  private minePulse = 0;
  private autosaveTimer = 0;
  private heartbeatTimer = 0;
  private footstepTimer = 0;
  private hazardCooldown = 0;
  private hudTimer = 0;
  private mouse = { x: 0, y: 0, down: false, active: false };
  private aim = { x: 1, y: 0 };
  private gamepadInteract = false;
  private previousGamepadInteract = false;
  private previousGamepadJump = false;
  private width = window.innerWidth;
  private height = window.innerHeight;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: GameUI,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
    this.hydrateEquipment();
    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame((time) => this.frame(time));
  }

  get saveData(): SaveData {
    return this.save;
  }

  get isRunning(): boolean {
    return this.running;
  }

  startNew(): void {
    this.save = structuredClone(defaultSave);
    this.save.seed = Math.floor(Math.random() * 0x7fffffff);
    this.persist();
    this.startStage(1);
  }

  continue(): void {
    if (!this.save.seed) this.save.seed = Math.floor(Math.random() * 0x7fffffff);
    this.startStage(this.save.stage);
  }

  retry(): void {
    this.startStage(this.save.stage);
  }

  nextStage(): void {
    if (this.save.stage >= 20) {
      this.running = false;
      return;
    }
    this.save.stage += 1;
    this.save.seed = Math.floor(Math.random() * 0x7fffffff);
    this.save.modifiedTiles = {};
    this.save.openedChests = [];
    this.persist();
    this.startStage(this.save.stage);
  }

  upgradePermanent(stat: keyof SaveData["permanent"]): boolean {
    if (this.save.stones <= 0) {
      this.ui.toast("An upgrade stone is required", "#ff6571");
      return false;
    }
    this.save.stones -= 1;
    this.save.permanent[stat] += 1;
    this.persist();
    this.ui.toast(`${stat.toUpperCase()} permanently increased`, "#e8b95c");
    return true;
  }

  upgradeEquipment(slot: EquipmentSlot): boolean {
    const item = this.equipped.get(slot);
    if (!item) {
      this.ui.toast(`No ${slot.toLowerCase()} equipped`, "#ff6571");
      return false;
    }
    if (item.level >= 20) {
      this.ui.toast(`${item.name} is already +20`, "#ff6571");
      return false;
    }
    if (this.save.stones <= 0) {
      this.ui.toast("An upgrade stone is required", "#ff6571");
      return false;
    }
    this.save.stones -= 1;
    item.level += 1;
    const hpRatio = this.player.hp / this.player.maxHp;
    const stats = this.computedStats();
    this.player.maxHp = stats.hp;
    this.player.hp = Math.max(1, this.player.maxHp * hpRatio);
    this.player.maxMana = stats.mana;
    this.player.attack = stats.attack;
    this.player.armor = stats.defense;
    this.player.speed = stats.speed;
    this.player.mining = stats.mining;
    this.player.crit = stats.crit;
    this.persist();
    this.audio.level();
    this.ui.toast(`${item.name} upgraded to +${item.level}`, rarityColors[item.rarity]);
    this.ui.showInventory(this.save, this.equipped);
    return true;
  }

  toggleInventory(): void {
    if (!this.running || this.bossIntro > 0) return;
    this.paused = !this.paused;
    if (this.paused) this.ui.showInventory(this.save, this.equipped);
    else this.ui.hideInventory();
  }

  closeInventory(): void {
    this.paused = false;
    this.ui.hideInventory();
  }

  returnToTitle(): void {
    this.running = false;
    this.paused = false;
    this.audio.setBossMode(false);
    this.persist();
  }

  private startStage(stage: number): void {
    this.save.stage = clamp(stage, 1, 20);
    this.save.modifiedTiles = {};
    this.save.openedChests = [];
    this.world = new World(this.save.seed, this.save.stage, this.save);
    this.hydrateEquipment();
    this.player = this.createPlayer();
    const surface = this.world.surfaceAt(0);
    this.player.x = TILE * 0.5;
    this.player.y = (surface - 1) * TILE - this.player.height / 2;
    this.merchant = {
      x: TILE * 8.5,
      y: (this.world.surfaceAt(8) - 1) * TILE - 20,
      available: true,
    };
    this.world.updateAround(this.player.x, this.player.y);
    this.camera = { x: this.player.x, y: this.player.y, shake: 0 };
    this.projectiles = [];
    this.particles = [];
    this.texts = [];
    this.boss = undefined;
    this.arena = undefined;
    this.stageTime = 180;
    this.bossIntro = 0;
    this.bossDefeated = false;
    this.running = true;
    this.paused = false;
    this.heartbeatTimer = 0;
    this.hazardCooldown = 0;
    this.hudTimer = 0;
    this.audio.setBossMode(false);
    this.persist();
    this.ui.toast(`Stage ${String(this.save.stage).padStart(2, "0")} · the world has shifted`, "#e8b95c");
  }

  private createPlayer(): Player {
    const stats = this.computedStats();
    return {
      x: 0, y: 0, vx: 0, vy: 0, width: 19, height: 37, facing: 1,
      grounded: false, onWall: 0, onLadder: false, dropping: 0,
      hp: stats.hp, maxHp: stats.hp, mana: stats.mana, maxMana: stats.mana,
      armor: stats.defense, attack: stats.attack, mining: stats.mining,
      speed: stats.speed, crit: stats.crit, level: 1, xp: 0, xpNext: 80,
      coyote: 0, jumpBuffer: 0, jumps: 0, dashCooldown: 0, dashTime: 0,
      rollTime: 0, attackCooldown: 0, attackTime: 0, combo: 0, comboTimer: 0,
      skillCooldown: 0, invulnerable: 0, potionCooldown: 0, potions: 2,
      ultimate: 0, animation: "idle", animationTime: 0,
    };
  }

  private frame(time: number): void {
    const elapsed = Math.min(0.1, (time - this.previousTime) / 1000);
    this.previousTime = time;
    this.accumulator += elapsed;
    while (this.accumulator >= FIXED_STEP) {
      if (this.running && !this.paused) this.update(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.draw(time / 1000);
    requestAnimationFrame((next) => this.frame(next));
  }

  private update(dt: number): void {
    this.audio.update(dt);
    this.world.updateAround(this.player.x, this.player.y);
    this.updateTimers(dt);
    if (this.bossIntro > 0) {
      this.bossIntro -= dt;
      this.camera.shake = Math.max(this.camera.shake, 7 + Math.sin(this.bossIntro * 20) * 4);
      if (this.bossIntro <= 0) this.finishBossIntro();
      pressed.clear();
      this.updateParticles(dt);
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) {
        this.hudTimer = 0.08;
        this.pushHud();
      }
      return;
    }

    this.updatePlayer(dt);
    this.updateMining(dt);
    this.updateHazards(dt);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updateParticles(dt);
    this.updateEnvironment(dt);
    this.checkInteractions();
    this.updateCamera(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      this.pushHud();
    }
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= 8) {
      this.autosaveTimer = 0;
      this.persist();
    }
    this.previousGamepadInteract = this.gamepadInteract;
    pressed.clear();
  }

  private updateTimers(dt: number): void {
    this.player.coyote = Math.max(0, this.player.coyote - dt);
    this.player.jumpBuffer = Math.max(0, this.player.jumpBuffer - dt);
    this.player.dashCooldown = Math.max(0, this.player.dashCooldown - dt);
    this.player.dashTime = Math.max(0, this.player.dashTime - dt);
    this.player.rollTime = Math.max(0, this.player.rollTime - dt);
    this.player.attackCooldown = Math.max(0, this.player.attackCooldown - dt);
    this.player.attackTime = Math.max(0, this.player.attackTime - dt);
    this.player.comboTimer = Math.max(0, this.player.comboTimer - dt);
    this.player.skillCooldown = Math.max(0, this.player.skillCooldown - dt);
    this.player.invulnerable = Math.max(0, this.player.invulnerable - dt);
    this.player.potionCooldown = Math.max(0, this.player.potionCooldown - dt);
    this.player.dropping = Math.max(0, this.player.dropping - dt);
    this.hazardCooldown = Math.max(0, this.hazardCooldown - dt);
    this.minePulse = Math.max(0, this.minePulse - dt);
    this.camera.shake = Math.max(0, this.camera.shake - dt * 22);
    if (!this.boss && !this.bossDefeated) {
      this.stageTime = Math.max(0, this.stageTime - dt);
      if (this.stageTime <= 20) {
        this.heartbeatTimer -= dt;
        if (this.heartbeatTimer <= 0) {
          this.heartbeatTimer = Math.max(0.42, 0.95 - (20 - this.stageTime) * 0.025);
          this.audio.heartbeat();
        }
      }
      if (this.stageTime <= 0 && this.bossIntro <= 0) this.beginBossIntro();
    }
  }

  private updatePlayer(dt: number): void {
    const gamepad = navigator.getGamepads?.()[0];
    const stickX = Math.abs(gamepad?.axes[0] ?? 0) > 0.18 ? gamepad!.axes[0] : 0;
    const stickY = Math.abs(gamepad?.axes[1] ?? 0) > 0.18 ? gamepad!.axes[1] : 0;
    const left = keyState.has("KeyA") || keyState.has("ArrowLeft");
    const right = keyState.has("KeyD") || keyState.has("ArrowRight");
    const up = keyState.has("KeyW") || keyState.has("ArrowUp");
    const down = keyState.has("KeyS") || keyState.has("ArrowDown");
    const move = clamp((right ? 1 : 0) - (left ? 1 : 0) + stickX, -1, 1);
    const climb = clamp((down ? 1 : 0) - (up ? 1 : 0) + stickY, -1, 1);
    const sprinting = keyState.has("ShiftLeft") || keyState.has("ShiftRight") || (gamepad?.buttons[10]?.pressed ?? false);
    const gamepadJump = gamepad?.buttons[0]?.pressed ?? false;
    const jumpHeld = keyState.has("Space") || gamepadJump;
    this.gamepadInteract = gamepad?.buttons[4]?.pressed ?? false;

    const jumpPressed = pressed.has("Space") || (gamepadJump && !this.previousGamepadJump);
    if (jumpPressed && down) {
      this.player.dropping = 0.25;
      this.player.y += 3;
    } else if (jumpPressed) {
      this.player.jumpBuffer = 0.13;
    }
    this.previousGamepadJump = gamepadJump;
    if (pressed.has("KeyK") || gamepad?.buttons[1]?.pressed) this.tryDash(move);
    if (pressed.has("KeyL")) this.tryRoll(move);
    if (pressed.has("KeyJ") || gamepad?.buttons[2]?.pressed) this.tryAttack();
    if (pressed.has("KeyR") || gamepad?.buttons[3]?.pressed) this.useSkill();
    if (pressed.has("KeyF")) this.useUltimate();
    if (pressed.has("KeyQ")) this.usePotion();
    if (move !== 0) this.player.facing = move < 0 ? -1 : 1;

    const centerTile = this.world.getTile(Math.floor(this.player.x / TILE), Math.floor(this.player.y / TILE));
    this.player.onLadder = this.world.isClimbable(centerTile);
    if (this.player.onLadder && Math.abs(climb) > 0.05) {
      this.player.vy = climb * 145;
      this.player.vx = approach(this.player.vx, move * this.player.speed * 0.6, 1500 * dt);
    } else if (this.player.dashTime > 0) {
      this.player.vx = this.player.facing * 650;
      this.player.vy = 0;
    } else {
      const maxSpeed = this.player.speed * (sprinting ? 1.43 : 1);
      const acceleration = this.player.grounded ? 1900 : 1050;
      this.player.vx = approach(this.player.vx, move * maxSpeed, acceleration * dt);
      if (Math.abs(move) < 0.05 && this.player.grounded) this.player.vx = approach(this.player.vx, 0, 2400 * dt);
      const liquid = this.world.isLiquid(centerTile);
      const gravityScale = liquid ? 0.24 : !jumpHeld && this.player.vy < 0 ? 1.72 : 1;
      this.player.vy = Math.min(MAX_FALL, this.player.vy + GRAVITY * gravityScale * dt);
      if (liquid) {
        this.player.vx *= 0.93;
        this.player.vy = clamp(this.player.vy, -190, 220);
        if (jumpHeld) this.player.vy -= 24;
      }
    }

    this.player.onWall = this.detectWall();
    if (!this.player.grounded && this.player.onWall !== 0 && this.player.vy > 0) {
      const wallTx = Math.floor((this.player.x + this.player.onWall * (this.player.width / 2 + 2)) / TILE);
      const headTy = Math.floor((this.player.y - this.player.height / 2) / TILE);
      const ledgeOpen = !this.world.isSolid(this.world.getTile(wallTx, headTy - 1));
      if (ledgeOpen && Math.sign(move) === this.player.onWall) this.player.vy = 0;
      else this.player.vy = Math.min(this.player.vy, 135);
    }

    if (this.player.jumpBuffer > 0) {
      if (this.player.grounded || this.player.coyote > 0) {
        this.player.vy = -475;
        this.player.grounded = false;
        this.player.coyote = 0;
        this.player.jumpBuffer = 0;
        this.player.jumps = 1;
        this.audio.jump();
        this.burst(this.player.x, this.player.y + this.player.height / 2, "#b7c9ca", 8, 75);
      } else if (this.player.onWall !== 0) {
        this.player.vx = -this.player.onWall * 330;
        this.player.vy = -450;
        this.player.facing = this.player.onWall === 1 ? -1 : 1;
        this.player.jumpBuffer = 0;
        this.player.jumps = 1;
        this.audio.jump();
      } else if (this.player.jumps < 2) {
        this.player.vy = -435;
        this.player.jumpBuffer = 0;
        this.player.jumps += 1;
        this.audio.jump();
        this.burst(this.player.x, this.player.y + 4, "#78dfe7", 12, 105);
      }
    }

    this.movePlayer(this.player.vx * dt, this.player.vy * dt);
    this.updatePlayerAnimation(move, sprinting);

    if (this.player.grounded && Math.abs(this.player.vx) > 55) {
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = sprinting ? 0.18 : 0.27;
        this.audio.step();
        this.particle(this.player.x - this.player.facing * 7, this.player.y + this.player.height / 2, -this.player.facing * 26, -30, 0.28, 2, "#8e8170", 0);
      }
    }
  }

  private movePlayer(dx: number, dy: number): void {
    this.player.grounded = false;
    this.player.x += dx;
    this.resolveHorizontal(dx);
    this.player.y += dy;
    this.resolveVertical(dy);
  }

  private resolveHorizontal(dx: number): void {
    if (dx === 0) return;
    const halfW = this.player.width / 2;
    const halfH = this.player.height / 2 - 3;
    const side = dx > 0 ? this.player.x + halfW : this.player.x - halfW;
    const tx = Math.floor(side / TILE);
    const top = Math.floor((this.player.y - halfH) / TILE);
    const bottom = Math.floor((this.player.y + halfH) / TILE);
    for (let ty = top; ty <= bottom; ty += 1) {
      if (!this.world.isSolid(this.world.getTile(tx, ty))) continue;
      this.player.x = dx > 0 ? tx * TILE - halfW - 0.01 : (tx + 1) * TILE + halfW + 0.01;
      this.player.vx = 0;
      break;
    }
  }

  private resolveVertical(dy: number): void {
    if (dy === 0) return;
    const halfW = this.player.width / 2 - 3;
    const halfH = this.player.height / 2;
    const side = dy > 0 ? this.player.y + halfH : this.player.y - halfH;
    const ty = Math.floor(side / TILE);
    const left = Math.floor((this.player.x - halfW) / TILE);
    const right = Math.floor((this.player.x + halfW) / TILE);
    for (let tx = left; tx <= right; tx += 1) {
      const tile = this.world.getTile(tx, ty);
      const platformHit = dy > 0 && this.player.dropping <= 0 && this.world.isPlatform(tile) &&
        this.player.y + halfH - dy <= ty * TILE + 3;
      if (!this.world.isSolid(tile) && !platformHit) continue;
      this.player.y = dy > 0 ? ty * TILE - halfH - 0.01 : (ty + 1) * TILE + halfH + 0.01;
      if (dy > 0) {
        if (this.player.vy > 330) {
          this.camera.shake = Math.min(7, this.player.vy / 110);
          this.burst(this.player.x, this.player.y + halfH, "#7d766c", 10, 95);
        }
        this.player.grounded = true;
        this.player.coyote = 0.12;
        this.player.jumps = 0;
      }
      this.player.vy = 0;
      break;
    }
  }

  private detectWall(): -1 | 0 | 1 {
    const halfW = this.player.width / 2;
    const top = Math.floor((this.player.y - this.player.height / 2 + 5) / TILE);
    const bottom = Math.floor((this.player.y + this.player.height / 2 - 5) / TILE);
    for (const side of [-1, 1] as const) {
      const tx = Math.floor((this.player.x + side * (halfW + 2)) / TILE);
      for (let ty = top; ty <= bottom; ty += 1) {
        if (this.world.isSolid(this.world.getTile(tx, ty))) return side;
      }
    }
    return 0;
  }

  private tryDash(move: number): void {
    if (this.player.dashCooldown > 0) return;
    if (move !== 0) this.player.facing = move < 0 ? -1 : 1;
    this.player.dashCooldown = 1.05;
    this.player.dashTime = 0.17;
    this.player.invulnerable = 0.25;
    this.audio.dash();
    this.burst(this.player.x, this.player.y, "#73e5dc", 18, 170);
  }

  private tryRoll(move: number): void {
    if (!this.player.grounded || this.player.rollTime > 0) return;
    if (move !== 0) this.player.facing = move < 0 ? -1 : 1;
    this.player.rollTime = 0.35;
    this.player.invulnerable = 0.38;
    this.player.vx = this.player.facing * 410;
    this.audio.roll();
  }

  private tryAttack(): void {
    if (this.player.attackCooldown > 0) return;
    this.player.combo = this.player.comboTimer > 0 ? this.player.combo % 3 + 1 : 1;
    this.player.comboTimer = 0.5;
    this.player.attackCooldown = this.player.combo === 3 ? 0.34 : 0.23;
    this.player.attackTime = 0.18;
    this.attackHit = false;
    this.audio.attack();
  }

  private useSkill(): void {
    if (this.player.skillCooldown > 0 || this.player.mana < 20) return;
    this.player.skillCooldown = 2.8;
    this.player.mana -= 20;
    const angle = Math.atan2(this.aim.y, this.aim.x);
    this.projectile({
      x: this.player.x + Math.cos(angle) * 25,
      y: this.player.y + Math.sin(angle) * 15,
      vx: Math.cos(angle) * 520,
      vy: Math.sin(angle) * 520,
      radius: 7,
      damage: this.player.attack * 2.2,
      life: 1.5,
      hostile: false,
      color: "#67e4ff",
    });
    this.burst(this.player.x, this.player.y, "#67e4ff", 12, 130);
  }

  private useUltimate(): void {
    if (this.player.ultimate < 100 || !this.boss) return;
    this.player.ultimate = 0;
    this.damageBoss(this.player.attack * 18, true);
    this.camera.shake = 19;
    this.ui.flash("#ffe6a0");
    this.burst(this.boss.x, this.boss.y, "#ffe6a0", 70, 330);
  }

  private usePotion(): void {
    if (this.player.potions <= 0 || this.player.potionCooldown > 0 || this.player.hp >= this.player.maxHp) return;
    this.player.potions -= 1;
    this.player.potionCooldown = 1;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.55);
    this.audio.heal();
    this.burst(this.player.x, this.player.y, "#65e09c", 25, 130);
  }

  private updateMining(dt: number): void {
    const interacting = keyState.has("KeyE") || this.mouse.down || this.gamepadInteract;
    if (!interacting || this.nearChest() || this.nearMerchant()) {
      this.world.cancelMining();
      return;
    }
    const target = this.miningTarget();
    if (!target) {
      this.world.cancelMining();
      return;
    }
    const result = this.world.mine(target.x, target.y, dt, this.player.mining);
    this.player.animation = "mine";
    this.player.animationTime += dt * 14;
    this.minePulse -= dt;
    if (this.minePulse <= 0) {
      this.minePulse = 0.14;
      this.audio.mine();
      this.particle((target.x + 0.5) * TILE, (target.y + 0.5) * TILE, (Math.random() - 0.5) * 80, -40 - Math.random() * 60, 0.35, 3, "#baaa8b", 0);
    }
    if (!result.broken) return;
    this.audio.breakBlock();
    const worldX = (target.x + 0.5) * TILE;
    const worldY = (target.y + 0.5) * TILE;
    this.burst(worldX, worldY, this.tileColor(result.tile ?? Tile.Stone, biomes.stone), 13, 140);
    if (result.resource) {
      const amount = result.resource === "stone" ? 1 : result.resource === "diamond" || result.resource === "magic" ? 2 : 1;
      this.save.resources[result.resource] += amount;
      if (result.resource === "goldOre") this.save.gold += 4;
      this.gainXp(result.resource === "stone" ? 2 : 7);
      this.texts.push({ x: worldX, y: worldY, text: `+${amount} ${result.resource.toUpperCase()}`, color: "#e8c778", life: 0.85, critical: false });
    }
    if (result.tile === Tile.Explosive) this.explodeCrystal(target.x, target.y);
  }

  private miningTarget(): { x: number; y: number } | undefined {
    let worldX = this.player.x + this.player.facing * TILE * 1.4;
    let worldY = this.player.y;
    if (this.mouse.active) {
      worldX = this.mouse.x + this.camera.x - this.width / 2;
      worldY = this.mouse.y + this.camera.y - this.height / 2;
    }
    const distance = Math.hypot(worldX - this.player.x, worldY - this.player.y);
    if (distance > TILE * 5.2) return undefined;
    const dx = worldX - this.player.x;
    const dy = worldY - this.player.y;
    const length = Math.max(1, distance);
    this.aim.x = dx / length;
    this.aim.y = dy / length;
    return { x: Math.floor(worldX / TILE), y: Math.floor(worldY / TILE) };
  }

  private explodeCrystal(tx: number, ty: number): void {
    for (let y = ty - 2; y <= ty + 2; y += 1) {
      for (let x = tx - 2; x <= tx + 2; x += 1) {
        if (Math.hypot(x - tx, y - ty) <= 2.35 && this.world.isSolid(this.world.getTile(x, y))) this.world.setTile(x, y, Tile.Air);
      }
    }
    this.camera.shake = 15;
    this.ui.flash("#ad74ff");
    this.burst((tx + 0.5) * TILE, (ty + 0.5) * TILE, "#b66dff", 42, 300);
    if (Math.hypot((tx + 0.5) * TILE - this.player.x, (ty + 0.5) * TILE - this.player.y) < TILE * 3) this.damagePlayer(24);
  }

  private updateHazards(dt: number): void {
    for (const chunk of this.world.loadedChunks) {
      for (const hazard of chunk.hazards) {
        if (!hazard.active) continue;
        hazard.phase += dt;
        if (hazard.kind === "saw") {
          hazard.x = hazard.baseX + Math.sin(hazard.phase * 1.4) * TILE * 3;
          hazard.y = hazard.baseY - 8;
        } else if (hazard.kind === "boulder") {
          hazard.x = hazard.baseX + Math.sin(hazard.phase * 0.8) * TILE * 2.4;
          hazard.phase += dt * 0.4;
        } else {
          const close = Math.abs(this.player.x - hazard.x) < TILE * 1.5 && this.player.y > hazard.y;
          if (close) hazard.vy = Math.min(500, hazard.vy + 900 * dt);
          hazard.y += hazard.vy * dt;
          const below = this.world.getTile(Math.floor(hazard.x / TILE), Math.floor((hazard.y + 10) / TILE));
          if (hazard.vy > 0 && this.world.isSolid(below)) {
            hazard.y = hazard.baseY;
            hazard.vy = 0;
          }
        }
        if (Math.hypot(hazard.x - this.player.x, hazard.y - this.player.y) < 27) this.damagePlayer(16 + this.save.stage * 1.5);
      }
    }
  }

  private updateEnvironment(dt: number): void {
    const feetX = Math.floor(this.player.x / TILE);
    const feetY = Math.floor((this.player.y + this.player.height / 2 - 2) / TILE);
    const tile = this.world.getTile(feetX, feetY);
    if (tile === Tile.Spikes) this.damagePlayer(18 + this.save.stage);
    if (tile === Tile.Lava) {
      this.damagePlayer((11 + this.save.stage * 0.8) * dt * 3);
      this.burst(this.player.x, this.player.y + 10, "#ff623e", 1, 45);
    }
    if (tile === Tile.Poison) {
      this.damagePlayer((5 + this.save.stage * 0.35) * dt * 2);
      if (Math.random() < dt * 8) this.particle(this.player.x + (Math.random() - 0.5) * 20, this.player.y + 15, 0, -35, 0.7, 4, "#91d94d", 6);
    }
    this.player.mana = Math.min(this.player.maxMana, this.player.mana + dt * 5);
    const depth = Math.max(0, Math.floor(this.player.y / TILE) - this.world.surfaceAt(Math.floor(this.player.x / TILE)));
    this.save.bestDepth = Math.max(this.save.bestDepth, depth);
  }

  private beginBossIntro(): void {
    if (this.bossIntro > 0 || this.boss) return;
    this.arena = this.world.createArena(this.player.x, this.player.y);
    this.bossIntro = 3.5;
    this.audio.silence();
    this.audio.warning();
    this.ui.showBossIntro(bossNames[this.save.stage - 1]);
    this.ui.flash("#c42a42");
    this.camera.shake = 18;
  }

  private finishBossIntro(): void {
    if (!this.arena) return;
    this.player.x = this.arena.left + TILE * 4;
    this.player.y = this.arena.bottom - TILE * 2.8;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.invulnerable = 1.4;
    const hp = 650 * Math.pow(1.22, this.save.stage - 1);
    this.boss = {
      name: bossNames[this.save.stage - 1],
      x: this.arena.right - TILE * 6,
      y: this.arena.bottom - TILE * 3.2,
      vx: 0,
      vy: 0,
      width: 58 + this.save.stage * 1.1,
      height: 64 + this.save.stage * 1.15,
      hp,
      maxHp: hp,
      phase: 1,
      cooldown: 1.4,
      contactDamage: 14 * Math.pow(1.115, this.save.stage - 1),
      flash: 0,
      dead: false,
    };
    this.ui.hideBossIntro();
    this.audio.setBossTheme(this.save.stage);
    this.audio.setBossMode(true);
    this.camera.shake = 12;
  }

  private updateBoss(dt: number): void {
    const boss = this.boss;
    if (!boss || boss.dead || !this.arena) return;
    boss.cooldown -= dt;
    boss.flash = Math.max(0, boss.flash - dt);
    const ratio = boss.hp / boss.maxHp;
    boss.phase = ratio > 0.66 ? 1 : ratio > 0.3 ? 2 : 3;
    const dx = this.player.x - boss.x;
    const distance = Math.abs(dx);
    const speed = 70 + this.save.stage * 2.6 + boss.phase * 12;
    boss.vx = approach(boss.vx, Math.sign(dx) * speed, 420 * dt);
    boss.x = clamp(boss.x + boss.vx * dt, this.arena.left + TILE * 2, this.arena.right - TILE * 2);
    boss.y = this.arena.bottom - boss.height / 2 - TILE;

    if (boss.cooldown <= 0) {
      this.bossPattern(boss);
      boss.cooldown = Math.max(0.55, 2.25 - boss.phase * 0.28 - this.save.stage * 0.025);
    }
    if (distance < (boss.width + this.player.width) / 2 + 5) this.damagePlayer(boss.contactDamage);

    if (this.player.attackTime > 0 && !this.attackHit) {
      const range = 64 + this.player.combo * 9;
      if (Math.hypot(boss.x - this.player.x, boss.y - this.player.y) < range) {
        this.attackHit = true;
        const critical = Math.random() < this.player.crit;
        this.damageBoss(this.player.attack * (1 + this.player.combo * 0.22) * (critical ? 1.8 : 1), critical);
      }
    }
  }

  private bossPattern(boss: Boss): void {
    const pattern = (this.save.stage - 1) % 6;
    const angle = Math.atan2(this.player.y - boss.y, this.player.x - boss.x);
    if (pattern === 0) {
      this.radialBossShots(boss, 7 + boss.phase * 3, "#e34c62");
    } else if (pattern === 1) {
      const count = 3 + boss.phase * 2;
      for (let index = 0; index < count; index += 1) this.bossShot(boss, angle + (index - (count - 1) / 2) * 0.14, "#b86cff");
    } else if (pattern === 2) {
      this.radialBossShots(boss, 9 + boss.phase * 2, "#6ecbff");
      boss.vx = Math.sign(this.player.x - boss.x) * 430;
      this.camera.shake = 8;
    } else if (pattern === 3) {
      for (let index = 0; index < 4 + boss.phase; index += 1) {
        const x = this.arena!.left + TILE * (3 + Math.random() * 27);
        this.projectile({ x, y: this.arena!.top + 20, vx: 0, vy: 260 + this.save.stage * 7, radius: 9, damage: boss.contactDamage * 0.85, life: 4, hostile: true, color: "#ff9d49" });
      }
    } else if (pattern === 4) {
      this.radialBossShots(boss, 6 + boss.phase * 4, "#9be35a");
      for (let index = 0; index < boss.phase; index += 1) this.bossShot(boss, angle + (Math.random() - 0.5) * 0.4, "#e5f27a");
    } else {
      this.radialBossShots(boss, 10 + boss.phase * 3, "#e8b95c");
      boss.vx = Math.sign(this.player.x - boss.x) * 560;
      this.camera.shake = 12;
    }
  }

  private radialBossShots(boss: Boss, count: number, color: string): void {
    for (let index = 0; index < count; index += 1) this.bossShot(boss, index / count * Math.PI * 2, color);
  }

  private bossShot(boss: Boss, angle: number, color: string): void {
    const speed = 205 + this.save.stage * 5 + boss.phase * 22;
    this.projectile({
      x: boss.x + Math.cos(angle) * boss.width * 0.4,
      y: boss.y + Math.sin(angle) * boss.height * 0.35,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 6 + boss.phase,
      damage: boss.contactDamage * 0.75,
      life: 4,
      hostile: true,
      color,
    });
  }

  private damageBoss(amount: number, critical: boolean): void {
    const boss = this.boss;
    if (!boss || boss.dead) return;
    boss.hp -= amount;
    boss.flash = 0.09;
    this.player.ultimate = Math.min(100, this.player.ultimate + amount / boss.maxHp * 190);
    this.audio.bossHit();
    this.texts.push({ x: boss.x, y: boss.y - boss.height / 2, text: `${Math.round(amount)}`, color: critical ? "#ffe47f" : "#f0eee6", life: 0.7, critical });
    this.burst(boss.x, boss.y, critical ? "#ffe47f" : "#e85666", critical ? 10 : 4, 150);
    if (critical) {
      this.camera.shake = Math.max(this.camera.shake, 5);
      this.ui.flash("#ffe47f");
    }
    if (boss.hp <= 0) this.completeStage();
  }

  private completeStage(): void {
    if (!this.boss || this.boss.dead) return;
    this.boss.dead = true;
    this.bossDefeated = true;
    this.audio.victory();
    this.camera.shake = 20;
    this.burst(this.boss.x, this.boss.y, "#ffc96b", 90, 390);
    if (this.arena) this.world.unlockArena(this.arena);
    const gold = 130 + this.save.stage * 52;
    const stones = 1 + Math.floor(this.save.stage / 5);
    const materials = 2 + Math.floor(this.save.stage / 4);
    const item = this.generateEquipment(2);
    this.save.gold += gold;
    this.save.stones += stones;
    this.save.materials += materials;
    this.save.permanent.attack += 1;
    this.acquireEquipment(item);
    this.persist();
    this.paused = true;
    window.setTimeout(() => {
      this.ui.showVictory(
        this.save.stage === 20 ? "THE GOD BENEATH HAS FALLEN" : `STAGE ${String(this.save.stage).padStart(2, "0")} CONQUERED`,
        [`◆ ${gold} GOLD`, `⬡ ${stones} UPGRADE STONES`, `◈ ${materials} RARE MATERIALS`, `${item.icon} ${item.name}`, "⚔ +1 PERMANENT DAMAGE"],
      );
    }, 850);
  }

  private updateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      projectile.life -= dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      if (projectile.life <= 0 || this.world.isSolid(this.world.getTile(Math.floor(projectile.x / TILE), Math.floor(projectile.y / TILE)))) {
        projectile.active = false;
        continue;
      }
      if (projectile.hostile) {
        if (Math.hypot(projectile.x - this.player.x, projectile.y - this.player.y) < projectile.radius + this.player.width / 2) {
          projectile.active = false;
          this.damagePlayer(projectile.damage);
        }
      } else if (this.boss && !this.boss.dead &&
        Math.abs(projectile.x - this.boss.x) < this.boss.width / 2 + projectile.radius &&
        Math.abs(projectile.y - this.boss.y) < this.boss.height / 2 + projectile.radius) {
        projectile.active = false;
        const critical = Math.random() < this.player.crit;
        this.damageBoss(projectile.damage * (critical ? 1.8 : 1), critical);
      }
    }
  }

  private damagePlayer(amount: number): void {
    if (this.player.invulnerable > 0 || this.hazardCooldown > 0 || !this.running) return;
    const reduced = Math.max(1, amount - this.player.armor * 0.45);
    this.player.hp -= reduced;
    this.player.invulnerable = 0.7;
    this.hazardCooldown = 0.28;
    this.player.vx = -this.player.facing * 180;
    this.player.vy = -180;
    this.camera.shake = 9;
    this.audio.hurt();
    this.ui.flash("#ff334b");
    this.texts.push({ x: this.player.x, y: this.player.y - 25, text: `-${Math.round(reduced)}`, color: "#ff6370", life: 0.8, critical: false });
    this.burst(this.player.x, this.player.y, "#e94b5b", 13, 160);
    if (this.player.hp <= 0) this.die();
  }

  private die(): void {
    this.player.hp = 0;
    this.running = false;
    this.audio.setBossMode(false);
    this.persist();
    const depth = Math.max(0, Math.floor(this.player.y / TILE) - this.world.surfaceAt(Math.floor(this.player.x / TILE)));
    this.ui.showDeath([
      `STAGE ${String(this.save.stage).padStart(2, "0")}`,
      `DEEPEST POINT ${depth}m`,
      `◆ ${this.save.gold} GOLD RETAINED`,
      `${this.save.equipment.length} RELICS FOUND`,
    ]);
  }

  private checkInteractions(): void {
    const chest = this.nearChest();
    const merchant = this.nearMerchant();
    if (chest) this.ui.setInteraction(chest.locked ? "UNLOCK TREASURE CHEST" : "OPEN TREASURE CHEST");
    else if (merchant) this.ui.setInteraction("TRADE WITH ORIN");
    else this.ui.setInteraction();
    if (!pressed.has("KeyE") && !(this.gamepadInteract && !this.previousGamepadInteract)) return;
    if (chest) this.openChest(chest);
    else if (merchant) this.openMerchant();
  }

  private nearChest(): ChunkChest | undefined {
    return this.world.nearestChest(this.player.x, this.player.y, 52);
  }

  private nearMerchant(): boolean {
    return this.merchant.available && Math.hypot(this.player.x - this.merchant.x, this.player.y - this.merchant.y) < 68;
  }

  private openChest(chest: ChunkChest): void {
    if (chest.opened || this.paused) return;
    if (chest.locked && this.save.keys < 1) {
      this.ui.toast("A vault key is needed to break the seal", "#ff6571");
      return;
    }
    if (chest.locked) this.save.keys -= 1;
    this.world.openChest(chest, this.save);
    this.paused = true;
    this.audio.chest();
    this.burst(chest.x, chest.y, rarityColors[chest.rarity], 35, 220);
    const pool = [
      this.equipmentChoice(this.generateEquipment(rarityOrder.indexOf(chest.rarity) >= 3 ? 2 : 0)),
      this.goldChoice(chest.rarity),
      this.stoneChoice(),
      this.keyChoice(),
      this.potionChoice(),
      this.skillChoice(),
      this.passiveChoice(),
      this.equipmentChoice(this.generateEquipment(1)),
    ];
    const choices = this.random.shuffle(pool).slice(0, 3);
    this.ui.showChoices("TREASURE RECOVERED", "Choose one relic", choices);
  }

  private equipmentChoice(item: Equipment): RewardChoice {
    return {
      name: item.name,
      description: `${item.slot} · ${this.describeStats(item)}${item.effect ? ` · ${item.effect}` : ""}`,
      icon: item.icon,
      rarity: item.rarity,
      tag: `${item.rarity.toUpperCase()} EQUIPMENT`,
      choose: () => {
        this.acquireEquipment(item);
        this.finishChoice(`${item.name} equipped`, rarityColors[item.rarity]);
      },
    };
  }

  private goldChoice(rarity: Rarity): RewardChoice {
    const amount = 70 + this.save.stage * 18 + rarityOrder.indexOf(rarity) * 35;
    return {
      name: "Royal Gold Cache",
      description: `Recover ${amount} gold from the old kingdoms`,
      icon: "◆",
      rarity,
      tag: "CURRENCY",
      choose: () => {
        this.save.gold += amount;
        this.finishChoice(`+${amount} gold`, "#e8b95c");
      },
    };
  }

  private stoneChoice(): RewardChoice {
    return {
      name: "Runesmith Stone",
      description: "Upgrade equipment or purchase permanent power",
      icon: "⬡",
      rarity: "Epic",
      tag: "UPGRADE MATERIAL",
      choose: () => {
        this.save.stones += 1;
        this.finishChoice("+1 upgrade stone", "#b86cff");
      },
    };
  }

  private keyChoice(): RewardChoice {
    return {
      name: "Sunken Vault Key",
      description: "Opens one sealed treasure chest",
      icon: "⚿",
      rarity: "Rare",
      tag: "EXPLORATION KEY",
      choose: () => {
        this.save.keys += 1;
        this.finishChoice("+1 vault key", "#efcc73");
      },
    };
  }

  private potionChoice(): RewardChoice {
    return {
      name: "Crimson Tonic",
      description: "Gain two potions and restore all health",
      icon: "♥",
      rarity: "Rare",
      tag: "RESTORATION",
      choose: () => {
        this.player.potions += 2;
        this.player.hp = this.player.maxHp;
        this.finishChoice("Health restored", "#64dc9c");
      },
    };
  }

  private skillChoice(): RewardChoice {
    const names = ["Fireball", "Ice Spear", "Chain Lightning", "Meteor Core", "Dash Slash", "Time Fracture"];
    const name = this.random.pick(names);
    return {
      name,
      description: "+20% skill damage and +12 maximum mana",
      icon: "✦",
      rarity: "Legendary",
      tag: "ACTIVE SKILL",
      choose: () => {
        this.player.attack *= 1.2;
        this.player.maxMana += 12;
        this.player.mana = this.player.maxMana;
        this.finishChoice(`${name} mastered`, "#ffb84d");
      },
    };
  }

  private passiveChoice(): RewardChoice {
    const options = [
      { name: "Miner's Rhythm", text: "+18% mining speed", apply: () => { this.player.mining *= 1.18; } },
      { name: "Windstep", text: "+12% movement speed", apply: () => { this.player.speed *= 1.12; } },
      { name: "Stoneblood", text: "+30 maximum health", apply: () => { this.player.maxHp += 30; this.player.hp += 30; } },
      { name: "Keen Edge", text: "+6% critical chance", apply: () => { this.player.crit += 0.06; } },
    ];
    const option = this.random.pick(options);
    return {
      name: option.name,
      description: option.text,
      icon: "☀",
      rarity: "Mythic",
      tag: "PASSIVE ABILITY",
      choose: () => {
        option.apply();
        this.finishChoice(`${option.name} awakened`, "#ff5f7e");
      },
    };
  }

  private finishChoice(message: string, color: string): void {
    this.paused = false;
    this.gainXp(28 + this.save.stage * 3);
    this.persist();
    this.ui.toast(message, color);
  }

  private openMerchant(): void {
    this.paused = true;
    const offers: MerchantOffer[] = [];
    const add = (name: string, description: string, icon: string, rarity: Rarity, price: number, action: () => void): void => {
      const offer: MerchantOffer = {
        name, description, icon, rarity, price, sold: false,
        buy: () => {
          if (offer.sold || this.save.gold < price) {
            this.ui.toast(offer.sold ? "Already purchased" : `Need ${price} gold`, "#ff6571");
            return false;
          }
          this.save.gold -= price;
          offer.sold = true;
          action();
          this.audio.buy();
          this.persist();
          return true;
        },
      };
      offers.push(offer);
    };
    const weapon = this.generateEquipment(1, "Weapon");
    const armor = this.generateEquipment(1, "Armor");
    const artifact = this.generateEquipment(2, "Artifact");
    add(weapon.name, this.describeStats(weapon), weapon.icon, weapon.rarity, 120 + this.save.stage * 18, () => this.acquireEquipment(weapon));
    add(armor.name, this.describeStats(armor), armor.icon, armor.rarity, 110 + this.save.stage * 17, () => this.acquireEquipment(armor));
    add("Deepwell Elixir", "Three potions and full restoration", "♥", "Rare", 85 + this.save.stage * 5, () => { this.player.potions += 3; this.player.hp = this.player.maxHp; });
    add("Runesmith Bundle", "Two upgrade stones", "⬡", "Epic", 190 + this.save.stage * 11, () => { this.save.stones += 2; });
    add("Ancient Vault Key", "Opens one sealed treasure chest", "⚿", "Rare", 95 + this.save.stage * 4, () => { this.save.keys += 1; });
    add(artifact.name, this.describeStats(artifact), artifact.icon, artifact.rarity, 290 + this.save.stage * 24, () => this.acquireEquipment(artifact));
    add("Permanent Delver's Mark", "+1 movement and mining power forever", "☀", "Mythic", 480 + this.save.stage * 32, () => {
      this.save.permanent.speed += 1;
      this.save.permanent.mining += 1;
      this.player.speed += 3;
      this.player.mining += 0.04;
    });
    this.ui.showMerchant(offers, () => {
      this.paused = false;
    });
  }

  private generateEquipment(bonus = 0, forcedSlot?: EquipmentSlot): Equipment {
    const slot = forcedSlot ?? this.random.pick(slots);
    const roll = this.random.next() + this.save.stage * 0.018 + bonus * 0.13;
    const rarityIndex = roll > 1.3 ? 5 : roll > 1.1 ? 4 : roll > 0.88 ? 3 : roll > 0.6 ? 2 : roll > 0.28 ? 1 : 0;
    const rarity = rarityOrder[rarityIndex];
    const scale = 1 + rarityIndex * 0.48 + this.save.stage * 0.075;
    const stats: Equipment["stats"] = {};
    if (slot === "Weapon") stats.attack = Math.round(7 * scale);
    if (slot === "Helmet") { stats.hp = Math.round(11 * scale); stats.crit = 0.008 * (rarityIndex + 1); }
    if (slot === "Armor") { stats.defense = Math.round(3 * scale); stats.hp = Math.round(7 * scale); }
    if (slot === "Boots") stats.speed = Math.round(5 * scale);
    if (slot === "Ring") { stats.crit = 0.014 * (rarityIndex + 1); stats.attack = Math.round(scale * 2); }
    if (slot === "Amulet") { stats.mana = Math.round(8 * scale); stats.cooldown = 0.012 * (rarityIndex + 1); }
    if (slot === "Artifact") { stats.mining = 0.08 * (rarityIndex + 1); stats.attack = Math.round(2.5 * scale); }
    if (slot === "Pet") { stats.speed = Math.round(2.5 * scale); stats.defense = Math.round(scale); }
    return {
      id: `${Date.now()}-${Math.floor(this.random.next() * 1e9)}`,
      name: this.random.pick(equipmentNames[slot]),
      slot,
      rarity,
      level: 1,
      icon: slotIcons[slot],
      stats,
      effect: rarityIndex >= 3 ? this.random.pick(["Emberwake", "Crystal Echo", "Abyss Ward", "Goldfinder", "Timebend"]) : undefined,
    };
  }

  private acquireEquipment(item: Equipment): void {
    this.save.equipment.push(item);
    this.save.equipped[item.slot] = item.id;
    this.equipped.set(item.slot, item);
    const oldRatio = this.player.hp / this.player.maxHp;
    const stats = this.computedStats();
    this.player.maxHp = stats.hp;
    this.player.hp = Math.max(1, this.player.maxHp * oldRatio);
    this.player.maxMana = stats.mana;
    this.player.mana = Math.min(this.player.mana, this.player.maxMana);
    this.player.attack = stats.attack;
    this.player.armor = stats.defense;
    this.player.speed = stats.speed;
    this.player.mining = stats.mining;
    this.player.crit = stats.crit;
  }

  private gainXp(amount: number): void {
    this.player.xp += amount;
    if (this.player.xp < this.player.xpNext) return;
    this.player.xp -= this.player.xpNext;
    this.player.level += 1;
    this.player.xpNext = Math.round(this.player.xpNext * 1.34);
    this.player.maxHp += 8;
    this.player.hp = this.player.maxHp;
    this.player.attack += 2;
    this.audio.level();
    this.ui.toast(`Level ${this.player.level} · power increased`, "#8cf4da");
  }

  private computedStats(): { attack: number; defense: number; hp: number; speed: number; crit: number; mining: number; mana: number } {
    const result = {
      attack: 16 + this.save.permanent.attack * 1.5,
      defense: 2 + this.save.permanent.defense,
      hp: 115 + this.save.permanent.hp * 7,
      speed: 210 + this.save.permanent.speed * 3,
      crit: 0.06 + this.save.permanent.crit * 0.006,
      mining: 1 + this.save.permanent.mining * 0.04,
      mana: 80,
    };
    this.equipped.forEach((item) => {
      const scale = 1 + item.level * 0.08;
      if (item.stats.attack) result.attack += item.stats.attack * scale;
      if (item.stats.defense) result.defense += item.stats.defense * scale;
      if (item.stats.hp) result.hp += item.stats.hp * scale;
      if (item.stats.speed) result.speed += item.stats.speed * scale;
      if (item.stats.crit) result.crit += item.stats.crit * scale;
      if (item.stats.mining) result.mining += item.stats.mining * scale;
      if (item.stats.mana) result.mana += item.stats.mana * scale;
    });
    return result;
  }

  private describeStats(item: Equipment): string {
    const labels: Record<string, string> = { attack: "ATK", defense: "DEF", hp: "HP", speed: "SPEED", crit: "CRIT", mining: "MINING", mana: "MANA", cooldown: "COOLDOWN" };
    return Object.entries(item.stats).map(([key, value]) => `+${value < 1 ? Math.round(value * 100) + "%" : Math.round(value)} ${labels[key]}`).join(" · ");
  }

  private updatePlayerAnimation(move: number, sprinting: boolean): void {
    let animation = "idle";
    if (this.player.attackTime > 0) animation = this.player.grounded ? "attack" : "airAttack";
    else if (this.player.rollTime > 0) animation = "roll";
    else if (this.player.dashTime > 0) animation = "dash";
    else if (this.player.onLadder && Math.abs(this.player.vy) > 5) animation = "climb";
    else if (!this.player.grounded && this.player.onWall !== 0 && this.player.vy === 0) animation = "ledge";
    else if (!this.player.grounded && this.player.onWall !== 0 && this.player.vy > 0) animation = "wallSlide";
    else if (!this.player.grounded && this.player.vy < -40) animation = this.player.jumps > 1 ? "doubleJump" : "jump";
    else if (!this.player.grounded && this.player.vy > 60) animation = "fall";
    else if (Math.abs(move) > 0.1) animation = sprinting ? "sprint" : "run";
    if (this.player.animation !== animation) {
      this.player.animation = animation;
      this.player.animationTime = 0;
    } else {
      this.player.animationTime += FIXED_STEP * (sprinting ? 11 : 8);
    }
  }

  private updateCamera(dt: number): void {
    const lookX = this.player.x + this.player.facing * Math.min(110, Math.abs(this.player.vx) * 0.22);
    const lookY = this.player.y - 35 + clamp(this.player.vy * 0.08, -45, 70);
    this.camera.x += (lookX - this.camera.x) * Math.min(1, dt * 5.8);
    this.camera.y += (lookY - this.camera.y) * Math.min(1, dt * 5.2);
  }

  private updateParticles(dt: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 210 * dt;
      particle.vx *= 0.985;
    }
    for (const text of this.texts) {
      text.life -= dt;
      text.y -= dt * 38;
    }
    this.texts = this.texts.filter((text) => text.life > 0);
  }

  private particle(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, glow: number): void {
    const existing = this.particles.find((particle) => !particle.active);
    const data: Particle = { active: true, x, y, vx, vy, life, maxLife: life, size, color, glow };
    if (existing) Object.assign(existing, data);
    else if (this.particles.length < 900) this.particles.push(data);
  }

  private burst(x: number, y: number, color: string, count: number, speed: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.2 + Math.random() * 0.8);
      this.particle(x, y, Math.cos(angle) * velocity, Math.sin(angle) * velocity, 0.25 + Math.random() * 0.55, 2 + Math.random() * 3, color, 8);
    }
  }

  private projectile(data: Omit<Projectile, "active">): void {
    const existing = this.projectiles.find((projectile) => !projectile.active);
    if (existing) Object.assign(existing, data, { active: true });
    else this.projectiles.push({ ...data, active: true });
  }

  private pushHud(): void {
    const tileX = Math.floor(this.player.x / TILE);
    const tileY = Math.floor(this.player.y / TILE);
    const biome = this.world.getBiomeAt(tileX, tileY);
    this.audio.setBiome(biome.id);
    const nearestChest = this.world.nearestChest(this.player.x, this.player.y);
    const treasureDistance = nearestChest ? Math.round(Math.hypot(nearestChest.x - this.player.x, nearestChest.y - this.player.y) / TILE) : undefined;
    const merchantDistance = Math.round(Math.hypot(this.merchant.x - this.player.x, this.merchant.y - this.player.y) / TILE);
    const weapon = this.equipped.get("Weapon")?.name ?? "Delver Pick";
    const depth = Math.max(0, tileY - this.world.surfaceAt(tileX));
    const objective = this.boss
      ? `Defeat ${this.boss.name}`
      : this.stageTime <= 60 ? "Find Orin · prepare for the guardian" : "Mine ore · recover treasure · descend";
    this.ui.updateHud({
      hp: this.player.hp, maxHp: this.player.maxHp,
      mana: this.player.mana, maxMana: this.player.maxMana,
      xp: this.player.xp, xpNext: this.player.xpNext,
      level: this.player.level, armor: Math.round(this.player.armor), weapon,
      gold: this.save.gold, stage: this.save.stage, time: this.stageTime,
      biome: biome.name, objective, bossWarning: !this.boss && this.stageTime <= 20,
      boss: this.boss && !this.boss.dead ? { name: this.boss.name, hp: this.boss.hp, maxHp: this.boss.maxHp, phase: this.boss.phase } : undefined,
      depth, treasureDistance, merchantDistance,
      dash: this.player.dashCooldown / 1.05,
      skill: this.player.skillCooldown / 2.8,
      potions: this.player.potions,
      ultimate: this.player.ultimate,
      buffs: this.activeBuffs(),
    });
    this.ui.drawMinimap((context, width, height) => this.drawMinimap(context, width, height));
  }

  private activeBuffs(): string[] {
    const buffs: string[] = [];
    if (this.equipped.get("Artifact")) buffs.push("✦");
    if (this.equipped.get("Pet")) buffs.push("◆");
    if (this.player.invulnerable > 0) buffs.push("◇");
    if (this.world.isLiquid(this.world.getTile(Math.floor(this.player.x / TILE), Math.floor(this.player.y / TILE)))) buffs.push("≈");
    return buffs;
  }

  private draw(time: number): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    const tileX = Math.floor(this.player.x / TILE);
    const tileY = Math.floor(this.player.y / TILE);
    const biome = this.world.getBiomeAt(tileX, tileY);
    this.drawParallax(ctx, biome, time);
    if (!this.running && this.save.seed === 0) return;
    const shakeX = this.camera.shake > 0 ? (Math.random() - 0.5) * this.camera.shake : 0;
    const shakeY = this.camera.shake > 0 ? (Math.random() - 0.5) * this.camera.shake : 0;
    const introZoom = this.bossIntro > 0 ? 1 + (1 - this.bossIntro / 3.5) * 0.13 : 1;
    const focusX = this.bossIntro > 0 && this.arena ? this.arena.center.x : this.camera.x;
    const focusY = this.bossIntro > 0 && this.arena ? this.arena.center.y : this.camera.y;
    ctx.save();
    ctx.translate(this.width / 2 + shakeX, this.height / 2 + shakeY);
    ctx.scale(introZoom, introZoom);
    ctx.translate(-focusX, -focusY);
    this.drawWorld(ctx, biome, time);
    this.drawMerchant(ctx, time);
    this.drawHazards(ctx, time);
    this.drawChests(ctx, time);
    this.drawProjectiles(ctx);
    this.drawBoss(ctx, time);
    this.drawPlayer(ctx, time);
    this.drawParticles(ctx);
    ctx.restore();
    this.drawLighting(biome, time);
    this.drawScreenFog(biome, time);
  }

  private drawParallax(ctx: CanvasRenderingContext2D, biome: Biome, time: number): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, biome.sky);
    gradient.addColorStop(1, "#030408");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    const layers = [
      { color: biome.far, speed: 0.05, baseline: 0.52, amplitude: 55 },
      { color: biome.mid, speed: 0.1, baseline: 0.63, amplitude: 70 },
      { color: biome.near, speed: 0.18, baseline: 0.75, amplitude: 85 },
      { color: this.shiftColor(biome.near, -18), speed: 0.28, baseline: 0.88, amplitude: 70 },
      { color: "#05060a", speed: 0.4, baseline: 0.98, amplitude: 45 },
    ];
    for (let layer = 0; layer < layers.length; layer += 1) {
      const entry = layers[layer];
      const offset = -this.camera.x * entry.speed;
      ctx.fillStyle = entry.color;
      ctx.beginPath();
      ctx.moveTo(0, this.height);
      for (let x = -80; x <= this.width + 80; x += 38) {
        const world = x + offset;
        const y = this.height * entry.baseline +
          Math.sin(world * 0.012 + layer) * entry.amplitude * 0.32 +
          Math.sin(world * 0.027 + time * 0.04) * entry.amplitude * 0.19;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(this.width, this.height);
      ctx.closePath();
      ctx.fill();
    }
    for (let index = 0; index < 45; index += 1) {
      const x = modNumber(hash2(index, 0, this.save.seed) * this.width - this.camera.x * (0.02 + index % 3 * 0.01), this.width);
      const y = hash2(index, 1, this.save.seed) * this.height * 0.7;
      ctx.fillStyle = `rgba(210,230,220,${0.08 + hash2(index, 2, this.save.seed) * 0.18})`;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1 + index % 2, 1 + index % 2);
    }
  }

  private drawWorld(ctx: CanvasRenderingContext2D, biome: Biome, time: number): void {
    const left = Math.floor((this.camera.x - this.width / 2) / TILE) - 2;
    const right = Math.ceil((this.camera.x + this.width / 2) / TILE) + 2;
    const top = Math.floor((this.camera.y - this.height / 2) / TILE) - 2;
    const bottom = Math.ceil((this.camera.y + this.height / 2) / TILE) + 2;
    for (let ty = top; ty <= bottom; ty += 1) {
      for (let tx = left; tx <= right; tx += 1) {
        const tile = this.world.getTile(tx, ty);
        if (tile === Tile.Air) continue;
        this.drawTile(ctx, tile, tx * TILE, ty * TILE, tx, ty, biome, time);
      }
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, tile: TileId, x: number, y: number, tx: number, ty: number, biome: Biome, time: number): void {
    if (tile === Tile.Water || tile === Tile.Lava || tile === Tile.Poison) {
      const color = tile === Tile.Water ? "#2a8fc1" : tile === Tile.Lava ? "#ff4b25" : "#76af35";
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.72;
      ctx.fillRect(x, y + 3 + Math.sin(time * 2.4 + tx * 0.7) * 2, TILE, TILE);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.18;
      ctx.fillRect(x + 2, y + 5 + Math.sin(time * 3 + tx) * 2, TILE - 4, 2);
      ctx.globalAlpha = 1;
      return;
    }
    if (tile === Tile.Spikes) {
      ctx.fillStyle = "#929ba0";
      for (let index = 0; index < 3; index += 1) {
        ctx.beginPath();
        ctx.moveTo(x + index * 8, y + TILE);
        ctx.lineTo(x + index * 8 + 4, y + 4);
        ctx.lineTo(x + index * 8 + 8, y + TILE);
        ctx.fill();
      }
      return;
    }
    if (tile === Tile.Platform) {
      ctx.fillStyle = biome.edge;
      ctx.fillRect(x, y + 4, TILE, 5);
      ctx.fillStyle = "#1a1714";
      ctx.fillRect(x + 3, y + 9, 3, 8);
      ctx.fillRect(x + TILE - 6, y + 9, 3, 8);
      return;
    }
    if (tile === Tile.Ladder || tile === Tile.Rope) {
      ctx.strokeStyle = tile === Tile.Ladder ? "#9a7247" : "#9f8a61";
      ctx.lineWidth = 3;
      if (tile === Tile.Ladder) {
        ctx.beginPath();
        ctx.moveTo(x + 6, y); ctx.lineTo(x + 6, y + TILE);
        ctx.moveTo(x + 18, y); ctx.lineTo(x + 18, y + TILE);
        for (let rung = 4; rung < TILE; rung += 7) { ctx.moveTo(x + 6, y + rung); ctx.lineTo(x + 18, y + rung); }
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x + 12, y); ctx.lineTo(x + 12 + Math.sin(time * 2 + ty) * 2, y + TILE);
        ctx.stroke();
      }
      return;
    }

    const color = this.tileColor(tile, biome);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, TILE, TILE);
    const above = this.world.getTile(tx, ty - 1);
    if (!this.world.isSolid(above)) {
      ctx.fillStyle = tile === Tile.Dirt ? biome.accent : this.shiftColor(color, 24);
      ctx.fillRect(x, y, TILE, 4);
      ctx.fillStyle = "rgba(255,255,255,0.09)";
      ctx.fillRect(x + 2, y + 4, TILE - 4, 2);
    }
    const pattern = hash2(tx, ty, this.save.seed);
    ctx.fillStyle = pattern > 0.5 ? this.shiftColor(color, -16) : this.shiftColor(color, 12);
    ctx.fillRect(x + 4 + Math.floor(pattern * 9), y + 9, 4, 3);
    ctx.fillRect(x + 15, y + 17, 3, 2);
    if (tile >= Tile.Copper && tile <= Tile.Obsidian || tile === Tile.Explosive) {
      const oreColors: Partial<Record<TileId, string>> = {
        [Tile.Copper]: "#d87f4f", [Tile.Iron]: "#adb9bd", [Tile.Gold]: "#f3c454",
        [Tile.Crystal]: "#b66dff", [Tile.Diamond]: "#7cecff", [Tile.Magic]: "#706aff",
        [Tile.Obsidian]: "#ba4b68", [Tile.Explosive]: "#ec6cff",
      };
      ctx.fillStyle = oreColors[tile] ?? "#fff";
      ctx.shadowBlur = tile >= Tile.Crystal ? 10 : 0;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fillRect(x + 4, y + 6, 5, 5);
      ctx.fillRect(x + 13, y + 12, 6, 4);
      ctx.fillRect(x + 8, y + 18, 3, 3);
      ctx.shadowBlur = 0;
    }
    const mining = this.world.getMiningProgress(tx, ty);
    if (mining > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + mining * 0.65})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 2); ctx.lineTo(x + 9, y + 9); ctx.lineTo(x + 15, y + 14); ctx.lineTo(x + 11, y + 22);
      ctx.moveTo(x + 9, y + 9); ctx.lineTo(x + 2, y + 12);
      ctx.moveTo(x + 15, y + 14); ctx.lineTo(x + 22, y + 10);
      ctx.stroke();
    }
  }

  private tileColor(tile: TileId, biome: Biome): string {
    const colors: Partial<Record<TileId, string>> = {
      [Tile.Dirt]: "#70513d", [Tile.Stone]: biome.stone, [Tile.Copper]: biome.stone,
      [Tile.Iron]: biome.stone, [Tile.Gold]: biome.stone, [Tile.Crystal]: "#3c3152",
      [Tile.Diamond]: "#34525d", [Tile.Magic]: "#262044", [Tile.Obsidian]: "#2a202a",
      [Tile.Ice]: "#37677d", [Tile.Factory]: "#3d484a", [Tile.Explosive]: "#43304d",
    };
    return colors[tile] ?? biome.stone;
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, time: number): void {
    const p = this.player;
    const bob = p.grounded ? Math.sin(p.animationTime * Math.PI * 2) * (p.animation === "idle" ? 1.2 : 2.2) : 0;
    const run = p.animation === "run" || p.animation === "sprint";
    const leg = run ? Math.sin(p.animationTime * Math.PI * 2) * 6 : 0;
    const roll = p.animation === "roll";
    const alpha = p.invulnerable > 0 && Math.floor(time * 20) % 2 ? 0.45 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.round(p.x), Math.round(p.y + bob));
    ctx.scale(p.facing, 1);
    if (roll) ctx.rotate(p.animationTime * 7 * p.facing);
    if (p.dashTime > 0) {
      for (let index = 1; index <= 4; index += 1) {
        ctx.globalAlpha = 0.12 / index;
        this.drawPlayerBody(ctx, -index * 12, 0, leg);
      }
      ctx.globalAlpha = alpha;
    }
    this.drawPlayerBody(ctx, 0, 0, leg);
    if (p.attackTime > 0) {
      const progress = 1 - p.attackTime / 0.18;
      ctx.strokeStyle = "#f2d084";
      ctx.lineWidth = 5;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#f2d084";
      ctx.beginPath();
      ctx.arc(8, -3, 34 + p.combo * 5, -1.2 + progress * 0.8, 0.9 + progress * 0.8);
      ctx.stroke();
    }
    if (p.animation === "mine") {
      ctx.save();
      ctx.translate(5, -5);
      ctx.rotate(-0.7 + Math.sin(p.animationTime) * 0.8);
      ctx.fillStyle = "#b8c2c5";
      ctx.fillRect(0, -18, 4, 30);
      ctx.fillRect(-8, -19, 20, 4);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawPlayerBody(ctx: CanvasRenderingContext2D, x: number, y: number, leg: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#162431";
    ctx.fillRect(-8, 11, 6, 11 + Math.max(0, leg));
    ctx.fillRect(3, 11, 6, 11 + Math.max(0, -leg));
    ctx.fillStyle = "#263a4b";
    ctx.fillRect(-11, -8, 22, 23);
    ctx.fillStyle = "#d49d63";
    ctx.fillRect(-13, -5, 4, 13);
    ctx.fillRect(9, -5, 4, 13);
    ctx.fillStyle = "#d9b47e";
    ctx.fillRect(-9, -22, 18, 15);
    ctx.fillStyle = "#263442";
    ctx.fillRect(-11, -25, 22, 8);
    ctx.fillRect(-13, -21, 4, 13);
    ctx.fillStyle = "#79e7d2";
    ctx.fillRect(2, -17, 4, 3);
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#79e7d2";
    ctx.fillRect(4, -17, 2, 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#dcae55";
    ctx.fillRect(-3, -5, 6, 9);
    ctx.restore();
  }

  private drawBoss(ctx: CanvasRenderingContext2D, time: number): void {
    const boss = this.boss;
    if (!boss || boss.dead) return;
    const color = biomeOrder[(this.save.stage - 1) % biomeOrder.length];
    const accent = biomes[color].accent;
    ctx.save();
    ctx.translate(boss.x, boss.y + Math.sin(time * 2.1) * 3);
    ctx.shadowBlur = 25;
    ctx.shadowColor = accent;
    ctx.fillStyle = boss.flash > 0 ? "#ffffff" : this.shiftColor(accent, -80);
    ctx.beginPath();
    ctx.roundRect(-boss.width / 2, -boss.height / 2, boss.width, boss.height, 16);
    ctx.fill();
    ctx.fillStyle = this.shiftColor(accent, -35);
    ctx.fillRect(-boss.width * 0.42, -boss.height * 0.25, boss.width * 0.84, boss.height * 0.38);
    const variant = (this.save.stage - 1) % 5;
    ctx.fillStyle = this.shiftColor(accent, -18);
    if (variant === 0) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * boss.width * 0.3, -boss.height * 0.42);
        ctx.lineTo(side * boss.width * 0.48, -boss.height * 0.72);
        ctx.lineTo(side * boss.width * 0.08, -boss.height * 0.48);
        ctx.fill();
      }
    } else if (variant === 1) {
      for (let index = -2; index <= 2; index += 1) {
        ctx.save();
        ctx.translate(index * boss.width * 0.18, -boss.height * 0.48);
        ctx.rotate(index * 0.14);
        ctx.fillRect(-4, -15 - Math.abs(index) * 2, 8, 22);
        ctx.restore();
      }
    } else if (variant === 2) {
      ctx.beginPath();
      ctx.ellipse(0, -boss.height * 0.46, boss.width * 0.62, boss.height * 0.22, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      for (let dot = -2; dot <= 2; dot += 1) ctx.fillRect(dot * 12 - 2, -boss.height * 0.56 + Math.abs(dot) * 3, 5, 5);
    } else if (variant === 3) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, boss.width * 0.58, 0, Math.PI * 2);
      ctx.stroke();
      for (let spoke = 0; spoke < 8; spoke += 1) {
        const angle = spoke / 8 * Math.PI * 2 + time;
        ctx.fillRect(Math.cos(angle) * boss.width * 0.62 - 4, Math.sin(angle) * boss.width * 0.62 - 4, 8, 8);
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(-boss.width * 0.3, -8);
      ctx.lineTo(-boss.width * 0.9, -boss.height * 0.38);
      ctx.lineTo(-boss.width * 0.62, boss.height * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(boss.width * 0.3, -8);
      ctx.lineTo(boss.width * 0.9, -boss.height * 0.38);
      ctx.lineTo(boss.width * 0.62, boss.height * 0.25);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = accent;
    ctx.fillRect(-boss.width * 0.25, -boss.height * 0.16, boss.width * 0.16, 7);
    ctx.fillRect(boss.width * 0.09, -boss.height * 0.16, boss.width * 0.16, 7);
    ctx.fillStyle = "#08090d";
    ctx.fillRect(-boss.width * 0.22, -boss.height * 0.13, 5, 3);
    ctx.fillRect(boss.width * 0.14, -boss.height * 0.13, 5, 3);
    ctx.fillStyle = this.shiftColor(accent, 25);
    for (let index = 0; index < boss.phase + 2; index += 1) {
      const angle = time * (0.5 + boss.phase * 0.15) + index / (boss.phase + 2) * Math.PI * 2;
      const x = Math.cos(angle) * (boss.width * 0.7);
      const y = Math.sin(angle) * (boss.height * 0.5);
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
    ctx.restore();
  }

  private drawMerchant(ctx: CanvasRenderingContext2D, time: number): void {
    if (!this.merchant.available || this.boss) return;
    const x = this.merchant.x;
    const y = this.merchant.y + Math.sin(time * 2) * 1.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#e8b95c";
    ctx.fillStyle = "#5a3c2a";
    ctx.fillRect(-14, -12, 28, 31);
    ctx.fillStyle = "#c89b5b";
    ctx.fillRect(-11, -25, 22, 16);
    ctx.fillStyle = "#241b1a";
    ctx.fillRect(-14, -29, 28, 7);
    ctx.fillStyle = "#ffe29a";
    ctx.fillRect(-6, -19, 4, 3);
    ctx.fillRect(4, -19, 4, 3);
    ctx.fillStyle = "#e8b95c";
    ctx.fillRect(17, -12, 4, 27);
    ctx.beginPath();
    ctx.arc(19, -16, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff1ad";
    ctx.beginPath();
    ctx.arc(19, -16, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#8f7b58";
    ctx.font = "bold 7px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ORIN", 0, 31);
    ctx.restore();
  }

  private drawChests(ctx: CanvasRenderingContext2D, time: number): void {
    for (const chunk of this.world.loadedChunks) {
      for (const chest of chunk.chests) {
        if (chest.opened) continue;
        const color = rarityColors[chest.rarity];
        ctx.save();
        ctx.translate(chest.x, chest.y + Math.sin(time * 2.4 + chest.x) * 1.2);
        ctx.shadowBlur = 14;
        ctx.shadowColor = color;
        ctx.fillStyle = "#5d351d";
        ctx.fillRect(-14, -7, 28, 16);
        ctx.fillStyle = "#a96c31";
        ctx.fillRect(-14, -10, 28, 7);
        ctx.fillStyle = color;
        ctx.fillRect(-2, -9, 4, 18);
        ctx.fillRect(-14, -4, 28, 3);
        if (chest.locked) {
          ctx.fillStyle = "#f3c55e";
          ctx.fillRect(-4, -1, 8, 8);
        }
        ctx.restore();
      }
    }
  }

  private drawHazards(ctx: CanvasRenderingContext2D, time: number): void {
    for (const chunk of this.world.loadedChunks) {
      for (const hazard of chunk.hazards) {
        if (!hazard.active) continue;
        ctx.save();
        ctx.translate(hazard.x, hazard.y);
        if (hazard.kind === "boulder") {
          ctx.rotate(hazard.phase);
          ctx.fillStyle = "#62636a";
          ctx.beginPath();
          ctx.arc(0, 0, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#85878d";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = "#3d3e43";
          ctx.fillRect(-4, -8, 5, 5);
        } else if (hazard.kind === "saw") {
          ctx.rotate(time * 5);
          ctx.fillStyle = "#aeb6b8";
          for (let index = 0; index < 12; index += 1) {
            ctx.rotate(Math.PI / 6);
            ctx.fillRect(-2, -17, 4, 9);
          }
          ctx.beginPath();
          ctx.arc(0, 0, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#5e6568";
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "#6b5e52";
          ctx.fillRect(-10, -10, 20, 20);
          ctx.fillStyle = "#97836c";
          ctx.fillRect(-7, -7, 6, 4);
        }
        ctx.restore();
      }
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D): void {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      ctx.save();
      ctx.fillStyle = projectile.color;
      ctx.shadowBlur = 16;
      ctx.shadowColor = projectile.color;
      ctx.beginPath();
      ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      if (particle.glow) {
        ctx.shadowBlur = particle.glow;
        ctx.shadowColor = particle.color;
      }
      ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const text of this.texts) {
      ctx.globalAlpha = clamp(text.life / 0.35, 0, 1);
      ctx.fillStyle = text.color;
      ctx.font = `${text.critical ? "bold " : ""}${text.critical ? 18 : 11}px monospace`;
      ctx.shadowBlur = text.critical ? 8 : 2;
      ctx.shadowColor = text.color;
      ctx.fillText(text.text, text.x, text.y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  private drawLighting(biome: Biome, time: number): void {
    const ctx = this.lightContext;
    ctx.clearRect(0, 0, this.width, this.height);
    const darkness = biome.id === "surface" ? 0.25 : biome.id === "abyss" ? 0.83 : 0.66;
    ctx.fillStyle = `rgba(2,3,8,${darkness})`;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "destination-out";
    const playerX = this.player.x - this.camera.x + this.width / 2;
    const playerY = this.player.y - this.camera.y + this.height / 2;
    this.cutLight(ctx, playerX, playerY, 150 + Math.sin(time * 2.5) * 5, 0.88);
    const merchantX = this.merchant.x - this.camera.x + this.width / 2;
    const merchantY = this.merchant.y - this.camera.y + this.height / 2;
    if (!this.boss) this.cutLight(ctx, merchantX, merchantY, 95, 0.8);
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      this.cutLight(ctx, projectile.x - this.camera.x + this.width / 2, projectile.y - this.camera.y + this.height / 2, 58, 0.65);
    }
    ctx.globalCompositeOperation = "source-over";
    this.context.drawImage(this.lightCanvas, 0, 0);
  }

  private cutLight(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, opacity: number): void {
    const gradient = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);
    gradient.addColorStop(0, `rgba(0,0,0,${opacity})`);
    gradient.addColorStop(0.55, `rgba(0,0,0,${opacity * 0.72})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawScreenFog(biome: Biome, time: number): void {
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = biome.id === "surface" ? 0.05 : 0.12;
    for (let index = 0; index < 8; index += 1) {
      const x = modNumber(index * 240 + time * (9 + index) - this.camera.x * 0.03, this.width + 300) - 150;
      const y = this.height * (0.35 + index * 0.08);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 150);
      gradient.addColorStop(0, biome.fog);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - 150, y - 70, 300, 140);
    }
    ctx.restore();
    if ((!this.boss && this.stageTime < 20) || this.bossIntro > 0) {
      const alpha = this.bossIntro > 0 ? 0.35 : (20 - this.stageTime) / 20 * 0.18;
      ctx.fillStyle = `rgba(30,0,8,${alpha})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, width, height);
    const scale = 2;
    const centerTx = Math.floor(this.player.x / TILE);
    const centerTy = Math.floor(this.player.y / TILE);
    const columns = Math.floor(width / scale);
    const rows = Math.floor(height / scale);
    for (let sy = 0; sy < rows; sy += 1) {
      for (let sx = 0; sx < columns; sx += 1) {
        const tx = centerTx + sx - Math.floor(columns / 2);
        const ty = centerTy + sy - Math.floor(rows / 2);
        const tile = this.world.getTile(tx, ty);
        if (tile === Tile.Air) continue;
        ctx.fillStyle = this.world.isLiquid(tile) ? "#2f7894" : tile === Tile.Spikes ? "#c04b58" : "#35404b";
        ctx.fillRect(sx * scale, sy * scale, scale, scale);
      }
    }
    for (const chunk of this.world.loadedChunks) {
      for (const chest of chunk.chests) {
        if (chest.opened) continue;
        const x = width / 2 + (chest.x / TILE - centerTx) * scale;
        const y = height / 2 + (chest.y / TILE - centerTy) * scale;
        if (x < 0 || y < 0 || x > width || y > height) continue;
        ctx.fillStyle = rarityColors[chest.rarity];
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }
    const merchantX = width / 2 + (this.merchant.x / TILE - centerTx) * scale;
    const merchantY = height / 2 + (this.merchant.y / TILE - centerTy) * scale;
    ctx.fillStyle = "#e8b95c";
    ctx.fillRect(merchantX - 2, merchantY - 2, 5, 5);
    if (this.arena) {
      const x = width / 2 + (this.arena.center.x / TILE - centerTx) * scale;
      const y = height / 2 + (this.arena.center.y / TILE - centerTy) * scale;
      ctx.fillStyle = "#e74d62";
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    ctx.fillStyle = "#72f4d5";
    ctx.beginPath();
    ctx.moveTo(width / 2, height / 2 - 4);
    ctx.lineTo(width / 2 - 3, height / 2 + 3);
    ctx.lineTo(width / 2 + 3, height / 2 + 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(232,185,92,0.16)";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  private shiftColor(hex: string, amount: number): string {
    const value = Number.parseInt(hex.slice(1), 16);
    const red = clamp((value >> 16) + amount, 0, 255);
    const green = clamp(((value >> 8) & 255) + amount, 0, 255);
    const blue = clamp((value & 255) + amount, 0, 255);
    return `rgb(${red},${green},${blue})`;
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
      const parsed = JSON.parse(stored) as Partial<SaveData>;
      return {
        ...structuredClone(defaultSave),
        ...parsed,
        permanent: { ...defaultSave.permanent, ...parsed.permanent },
        resources: { ...defaultSave.resources, ...parsed.resources },
      };
    } catch {
      return structuredClone(defaultSave);
    }
  }

  private persist(): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
  }

  private bindInput(): void {
    window.addEventListener("keydown", (event) => {
      if (!keyState.has(event.code)) pressed.add(event.code);
      keyState.add(event.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    });
    window.addEventListener("keyup", (event) => keyState.delete(event.code));
    this.canvas.addEventListener("pointermove", (event) => {
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
      this.mouse.active = true;
      const dx = event.clientX - this.width / 2;
      const dy = event.clientY - this.height / 2;
      const length = Math.max(1, Math.hypot(dx, dy));
      this.aim.x = dx / length;
      this.aim.y = dy / length;
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 0) this.mouse.down = true;
      this.audio.unlock();
    });
    window.addEventListener("pointerup", () => { this.mouse.down = false; });
    this.canvas.addEventListener("pointerleave", () => { this.mouse.active = false; });
    window.addEventListener("gamepadconnected", () => this.audio.unlock());
  }

  private resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.lightCanvas.width = this.width;
    this.lightCanvas.height = this.height;
    this.context.imageSmoothingEnabled = false;
    this.lightContext.imageSmoothingEnabled = false;
  }
}

function modNumber(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
