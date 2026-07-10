import type { Maze, MazeCell, RoomType, Vec2 } from "./types";

export class Random {
  private state: number;

  constructor(seed = Date.now()) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

const directions: Vec2[] = [
  { x: 0, y: -2 },
  { x: 2, y: 0 },
  { x: 0, y: 2 },
  { x: -2, y: 0 },
];

function distance(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function floorNeighbors(cells: MazeCell[][], x: number, y: number): number {
  return [
    cells[y - 1]?.[x],
    cells[y + 1]?.[x],
    cells[y]?.[x - 1],
    cells[y]?.[x + 1],
  ].filter((cell) => cell && !cell.wall).length;
}

function markRoom(cells: MazeCell[][], point: Vec2, room: RoomType): void {
  cells[point.y][point.x].room = room;
}

export function generateMaze(
  requestedWidth: number,
  requestedHeight: number,
  treasureCount: number,
  trapCount: number,
  seed = Date.now(),
): Maze {
  const width = requestedWidth % 2 === 0 ? requestedWidth + 1 : requestedWidth;
  const height = requestedHeight % 2 === 0 ? requestedHeight + 1 : requestedHeight;
  const random = new Random(seed);
  const cells: MazeCell[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      x,
      y,
      wall: true,
      discovered: false,
      room: "passage" as RoomType,
      variant: random.int(0, 3),
    })),
  );

  const spawn = { x: 1, y: 1 };
  const stack: Vec2[] = [spawn];
  cells[spawn.y][spawn.x].wall = false;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const options = random.shuffle([...directions]).filter(({ x, y }) => {
      const nx = current.x + x;
      const ny = current.y + y;
      return nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1 && cells[ny][nx].wall;
    });

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const direction = options[0];
    const next = { x: current.x + direction.x, y: current.y + direction.y };
    cells[current.y + direction.y / 2][current.x + direction.x / 2].wall = false;
    cells[next.y][next.x].wall = false;
    stack.push(next);
  }

  const loopAttempts = Math.floor((width * height) / 22);
  for (let i = 0; i < loopAttempts; i += 1) {
    const x = random.int(1, width - 2);
    const y = random.int(1, height - 2);
    if (!cells[y][x].wall) continue;
    const horizontal = !cells[y][x - 1].wall && !cells[y][x + 1].wall;
    const vertical = !cells[y - 1][x].wall && !cells[y + 1][x].wall;
    if (horizontal || vertical) cells[y][x].wall = false;
  }

  const floors: Vec2[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (!cells[y][x].wall) floors.push({ x, y });
    }
  }

  const ordered = [...floors].sort((a, b) => distance(b, spawn) - distance(a, spawn));
  const boss = ordered[0];
  const deadEnds = random.shuffle(
    floors.filter((point) => floorNeighbors(cells, point.x, point.y) === 1 && distance(point, spawn) > 8),
  );
  const available = random.shuffle(
    floors.filter((point) => distance(point, spawn) > 6 && distance(point, boss) > 5),
  );

  const treasure: Vec2[] = [];
  for (const point of [...deadEnds, ...available]) {
    if (treasure.length >= treasureCount) break;
    if (!treasure.some((other) => distance(point, other) < 5)) treasure.push(point);
  }

  const traps = random
    .shuffle(available.filter((point) => !treasure.includes(point)))
    .slice(0, trapCount);
  const elites = random
    .shuffle(available.filter((point) => !treasure.includes(point) && !traps.includes(point)))
    .slice(0, Math.max(2, Math.floor(treasureCount / 2)));

  const secrets: Vec2[] = [];
  const secretWalls = random.shuffle(
    floors.flatMap((floor) =>
      [
        { x: floor.x + 1, y: floor.y },
        { x: floor.x - 1, y: floor.y },
        { x: floor.x, y: floor.y + 1 },
        { x: floor.x, y: floor.y - 1 },
      ].filter(
        (point) =>
          point.x > 1 &&
          point.y > 1 &&
          point.x < width - 2 &&
          point.y < height - 2 &&
          cells[point.y][point.x].wall,
      ),
    ),
  );
  for (const point of secretWalls) {
    if (secrets.length >= 2) break;
    if (secrets.some((other) => distance(point, other) < 5)) continue;
    cells[point.y][point.x].wall = false;
    secrets.push(point);
    floors.push(point);
  }

  markRoom(cells, spawn, "spawn");
  markRoom(cells, boss, "boss");
  treasure.forEach((point) => markRoom(cells, point, "treasure"));
  traps.forEach((point) => markRoom(cells, point, "trap"));
  elites.forEach((point) => markRoom(cells, point, "elite"));
  secrets.forEach((point) => markRoom(cells, point, "secret"));

  for (const point of available.slice(0, Math.floor(available.length / 9))) {
    if (cells[point.y][point.x].room === "passage") markRoom(cells, point, "monster");
  }

  return { width, height, cells, spawn, boss, treasure, traps, elites, secrets, floors };
}
