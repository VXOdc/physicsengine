# ⚡ Custom 2D Physics Sandbox Engine

A real-time browser-based 2D physics sandbox built with React and the Canvas API. Spawn objects, tweak physics live, and watch simulations unfold.

🔗 **[Live Demo](https://your-project.vercel.app)** &nbsp;|&nbsp; ⭐ Star if you find it useful

![Physics Sandbox Preview](./preview.gif)

---

## ✨ Features

- **Rigid Body Physics** — circles and rectangles with mass, velocity, and angular rotation
- **Real-time Collision Detection** — circle↔circle, rect↔rect, and circle↔rect with impulse-based resolution
- **Live Physics Sliders** — adjust gravity, friction, and bounciness mid-simulation
- **Auto Spawn System** — timer-based object spawning with configurable rate, type, and position
- **Click to Spawn** — click anywhere on the canvas to drop objects
- **Preset Simulations** — Rain, Chaos, Moon Gravity, and Box Stack modes
- **Debug Mode** — velocity vectors, bounding boxes, and collision point visualization
- **Color Palettes** — Neon, Warm, Cool, and Monochrome themes
- **FPS Counter + Body Count** — live performance stats in the HUD



---

## 🕹️ Controls

| Action | How |
|---|---|
| Spawn object | Click anywhere on canvas |
| Auto spawn | Adjust "Auto Rate" slider |
| Pause / Resume | Click ⏸ PAUSE button |
| Reset world | Click ↺ RESET button |
| Toggle debug | Click DEBUG MODE button |
| Change gravity | Drag Gravity slider |
| Load preset | Click any preset button |

---

## 🏗️ Project Structure

```
src/
├── App.jsx              # Main app with physics engine + renderer + UI
├── main.jsx             # React entry point
└── index.css            # Global styles

public/
└── index.html
```

The engine is self-contained in `App.jsx` with clear class separation:

- `Vec2` — 2D vector math
- `Body` — rigid body with position, velocity, shape, material
- `PhysicsEngine` — gravity, integration, collision detection + resolution
- `Renderer` — Canvas 2D drawing with glow effects and debug overlays

---

## ⚙️ Physics Details

### Integration
Uses semi-implicit Euler integration per frame with a capped delta time (max 33ms) to prevent tunneling at low framerates.

### Collision Resolution
Impulse-based resolution using the relative velocity along the collision normal:

```
j = -(1 + e) * (relVel · normal) / (1/mA + 1/mB)
```

Where `e` is the coefficient of restitution. Positional correction is applied to prevent sinking.

### Supported Collision Pairs
- Circle ↔ Circle (distance-based)
- AABB ↔ AABB (axis overlap)
- Circle ↔ AABB (closest-point clamping)

---

## 🎮 Presets

| Preset | Gravity | Spawn Rate | Description |
|---|---|---|---|
| ☔ Rain | 15 m/s² | 8/s | Balls fall from above |
| 🌀 Chaos | 5 m/s² | 6/s | Mixed shapes everywhere |
| 🌙 Moon | 1.6 m/s² | 2/s | Low gravity floater |
| 📦 Stack | 12 m/s² | 3/s | Boxes stack and collapse |

---

