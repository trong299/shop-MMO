# UNDERDEEP

A from-scratch side-scrolling mining roguelite built with strict TypeScript and Canvas 2D.

## Features

- Deterministic infinite 64×64 tile chunks with dynamic loading and unloading
- Ten underground biomes, mineable ores, treasure, ruins, hazards, and merchant camps
- Responsive running, sprinting, variable jump, coyote time, jump buffer, double jump, wall slide/jump, ledge grab, dash, roll, ladders, ropes, and drop-through platforms
- Three-card treasure choices, eight equipment slots, six rarities, upgrades, resources, and autosave
- Twenty timed stages with exactly one cinematic multi-phase boss per stage
- Keyboard and gamepad support, synthesized adaptive audio, parallax, fog, lighting, particles, and dark-gold animated UI

## Run

```bash
npm install
npm run dev
```

## Controls

- `A / D` or left stick: move
- `Shift`: sprint
- `Space`: jump / double jump / wall jump
- `K` or gamepad B: dash
- `L`: roll
- `J` or gamepad X: attack
- `R` or gamepad Y: skill
- `Q`: use potion
- `E` or gamepad A: interact / mine
- `S`: drop through platforms
- `I`: equipment

Pixel Platformer art is CC0 by Kenney. All terrain rendering, effects, animation, world generation, and game logic are original to this project.
