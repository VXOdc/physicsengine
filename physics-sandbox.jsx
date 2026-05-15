import { useState, useEffect, useRef, useCallback } from "react";

// ─── PHYSICS ENGINE CORE ────────────────────────────────────────────────────

class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s) { return new Vec2(this.x * s, this.y * s); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  norm() { const l = this.len(); return l > 0 ? new Vec2(this.x / l, this.y / l) : new Vec2(); }
  perp() { return new Vec2(-this.y, this.x); }
  clone() { return new Vec2(this.x, this.y); }
}

let _id = 0;
class Body {
  constructor({ x, y, type = "circle", radius = 20, width = 40, height = 40,
    mass = 1, restitution = 0.6, friction = 0.3, color = "#00ffaa" }) {
    this.id = _id++;
    this.pos = new Vec2(x, y);
    this.vel = new Vec2((Math.random() - 0.5) * 2, 0);
    this.acc = new Vec2();
    this.type = type;
    this.radius = radius;
    this.width = width;
    this.height = height;
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.restitution = restitution;
    this.friction = friction;
    this.color = color;
    this.angle = 0;
    this.angularVel = (Math.random() - 0.5) * 0.05;
    this.isStatic = mass === 0;
    this.age = 0;
    this.colliding = false;
  }
}

class PhysicsEngine {
  constructor() {
    this.bodies = [];
    this.gravity = 9.8;
    this.globalFriction = 0.3;
    this.globalRestitution = 0.6;
    this.paused = false;
    this.time = 0;
    this.collisionPoints = [];
  }

  addBody(cfg) {
    const b = new Body({
      restitution: this.globalRestitution,
      friction: this.globalFriction,
      ...cfg,
    });
    this.bodies.push(b);
    return b;
  }

  removeBody(id) {
    this.bodies = this.bodies.filter(b => b.id !== id);
  }

  reset() {
    this.bodies = [];
    this.collisionPoints = [];
    _id = 0;
  }

  step(dt, canvasW, canvasH) {
    if (this.paused) return;
    dt = Math.min(dt, 0.033);
    this.time += dt;
    this.collisionPoints = [];

    for (const b of this.bodies) {
      if (b.isStatic) continue;
      b.colliding = false;
      // gravity
      b.acc = new Vec2(0, this.gravity * 100);
      // integrate
      b.vel = b.vel.add(b.acc.scale(dt));
      b.vel = b.vel.scale(1 - 0.002); // air drag
      b.pos = b.pos.add(b.vel.scale(dt));
      b.angle += b.angularVel;
      b.age += dt;

      // wall collisions
      this._wallCollide(b, canvasW, canvasH);
    }

    // body–body collisions
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        this._resolveCollision(this.bodies[i], this.bodies[j]);
      }
    }

    // remove bodies that fell far out
    this.bodies = this.bodies.filter(b => b.pos.y < canvasH + 200 && b.pos.y > -500);
  }

  _wallCollide(b, W, H) {
    const e = b.restitution;
    if (b.type === "circle") {
      const r = b.radius;
      if (b.pos.x - r < 0) { b.pos.x = r; b.vel.x = Math.abs(b.vel.x) * e; b.angularVel *= 0.8; }
      if (b.pos.x + r > W) { b.pos.x = W - r; b.vel.x = -Math.abs(b.vel.x) * e; b.angularVel *= 0.8; }
      if (b.pos.y + r > H) {
        b.pos.y = H - r;
        b.vel.y = -Math.abs(b.vel.y) * e;
        b.vel.x *= (1 - b.friction * 0.1);
        b.angularVel *= 0.85;
      }
      if (b.pos.y - r < 0) { b.pos.y = r; b.vel.y = Math.abs(b.vel.y) * e; }
    } else {
      const hw = b.width / 2, hh = b.height / 2;
      if (b.pos.x - hw < 0) { b.pos.x = hw; b.vel.x = Math.abs(b.vel.x) * e; }
      if (b.pos.x + hw > W) { b.pos.x = W - hw; b.vel.x = -Math.abs(b.vel.x) * e; }
      if (b.pos.y + hh > H) {
        b.pos.y = H - hh;
        b.vel.y = -Math.abs(b.vel.y) * e;
        b.vel.x *= (1 - b.friction * 0.1);
        b.angularVel *= 0.85;
      }
      if (b.pos.y - hh < 0) { b.pos.y = hh; b.vel.y = Math.abs(b.vel.y) * e; }
    }
  }

  _resolveCollision(a, b) {
    let normal, depth, cp;

    if (a.type === "circle" && b.type === "circle") {
      const d = b.pos.sub(a.pos);
      const dist = d.len();
      const minDist = a.radius + b.radius;
      if (dist >= minDist || dist < 0.001) return;
      normal = d.norm();
      depth = minDist - dist;
      cp = a.pos.add(normal.scale(a.radius));
    } else if (a.type === "rect" && b.type === "rect") {
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const ox = (a.width / 2 + b.width / 2) - Math.abs(dx);
      const oy = (a.height / 2 + b.height / 2) - Math.abs(dy);
      if (ox <= 0 || oy <= 0) return;
      if (ox < oy) {
        normal = new Vec2(dx < 0 ? -1 : 1, 0);
        depth = ox;
      } else {
        normal = new Vec2(0, dy < 0 ? -1 : 1);
        depth = oy;
      }
      cp = new Vec2((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2);
    } else {
      // circle-rect
      let circle = a.type === "circle" ? a : b;
      let rect = a.type === "rect" ? a : b;
      const dx = circle.pos.x - Math.max(rect.pos.x - rect.width / 2, Math.min(circle.pos.x, rect.pos.x + rect.width / 2));
      const dy = circle.pos.y - Math.max(rect.pos.y - rect.height / 2, Math.min(circle.pos.y, rect.pos.y + rect.height / 2));
      const distSq = dx * dx + dy * dy;
      if (distSq >= circle.radius * circle.radius) return;
      const dist = Math.sqrt(distSq);
      normal = dist > 0.001 ? new Vec2(dx / dist, dy / dist) : new Vec2(0, -1);
      depth = circle.radius - dist;
      cp = circle.pos.sub(normal.scale(circle.radius));
      if (a.type === "rect") normal = normal.scale(-1);
    }

    // separation
    const totalInvMass = a.invMass + b.invMass;
    if (totalInvMass === 0) return;
    const sep = normal.scale(depth / totalInvMass);
    a.pos = a.pos.sub(sep.scale(a.invMass));
    b.pos = b.pos.add(sep.scale(b.invMass));

    // impulse
    const relVel = b.vel.sub(a.vel);
    const velAlongNormal = relVel.dot(normal);
    if (velAlongNormal > 0) return;

    const e = Math.min(a.restitution, b.restitution);
    const j = -(1 + e) * velAlongNormal / totalInvMass;
    const impulse = normal.scale(j);
    a.vel = a.vel.sub(impulse.scale(a.invMass));
    b.vel = b.vel.add(impulse.scale(b.invMass));

    a.colliding = true;
    b.colliding = true;
    if (cp) this.collisionPoints.push(cp);
  }
}

// ─── RENDERER ───────────────────────────────────────────────────────────────

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  clear() {
    const ctx = this.ctx;
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < this.canvas.width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.canvas.height); ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.canvas.width, y); ctx.stroke();
    }
  }

  drawBody(b, debug) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.pos.x, b.pos.y);
    ctx.rotate(b.angle);

    const alpha = Math.min(1, b.age * 3);
    const col = b.colliding ? "#ffffff" : b.color;

    if (b.type === "circle") {
      // glow
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, b.radius);
      grad.addColorStop(0, col + "cc");
      grad.addColorStop(0.6, col + "88");
      grad.addColorStop(1, col + "00");
      ctx.beginPath();
      ctx.arc(0, 0, b.radius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.globalAlpha = alpha * 0.5;
      ctx.fill();

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = col + "33";
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();

      // spin indicator
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(b.radius * 0.8, 0);
      ctx.strokeStyle = col + "99";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      const hw = b.width / 2, hh = b.height / 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col + "22";
      ctx.fillRect(-hw, -hh, b.width, b.height);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(-hw, -hh, b.width, b.height);
      // corner accents
      const cs = 6;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].forEach(([cx, cy]) => {
        const sx = cx < 0 ? cs : -cs;
        const sy = cy < 0 ? cs : -cs;
        ctx.beginPath(); ctx.moveTo(cx + sx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy); ctx.stroke();
      });
    }

    ctx.restore();

    if (debug) {
      // velocity vector
      const speed = b.vel.len();
      if (speed > 5) {
        ctx.save();
        ctx.strokeStyle = "#ffff00cc";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(b.pos.x, b.pos.y);
        ctx.lineTo(b.pos.x + b.vel.x * 0.12, b.pos.y + b.vel.y * 0.12);
        ctx.stroke();
        // arrowhead
        const ang = Math.atan2(b.vel.y, b.vel.x);
        const tipX = b.pos.x + b.vel.x * 0.12;
        const tipY = b.pos.y + b.vel.y * 0.12;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - 8 * Math.cos(ang - 0.4), tipY - 8 * Math.sin(ang - 0.4));
        ctx.lineTo(tipX - 8 * Math.cos(ang + 0.4), tipY - 8 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fillStyle = "#ffff00cc";
        ctx.fill();
        ctx.restore();
      }

      // bounding box
      ctx.save();
      ctx.strokeStyle = "rgba(0,200,255,0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      if (b.type === "circle") {
        ctx.strokeRect(b.pos.x - b.radius, b.pos.y - b.radius, b.radius * 2, b.radius * 2);
      } else {
        ctx.strokeRect(b.pos.x - b.width / 2, b.pos.y - b.height / 2, b.width, b.height);
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  drawCollisionPoints(points) {
    const ctx = this.ctx;
    for (const pt of points) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ff4444";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#ff444488";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ─── COLOR PALETTES ─────────────────────────────────────────────────────────

const PALETTES = {
  neon: ["#00ffaa", "#00ccff", "#ff00ff", "#ffff00", "#ff6600"],
  warm: ["#ff6b35", "#f7931e", "#ffcd3c", "#c5283d", "#e9724c"],
  cool: ["#4ecdc4", "#45b7d1", "#96ceb4", "#88d8b0", "#a8dadc"],
  mono: ["#ffffff", "#cccccc", "#aaaaaa", "#888888", "#666666"],
};

const PRESETS = {
  rain: { gravity: 15, spawnRate: 8, spawnType: "circle", spawnPos: "top-random", name: "☔ Rain" },
  chaos: { gravity: 5, spawnRate: 6, spawnType: "mixed", spawnPos: "random", name: "🌀 Chaos" },
  moon: { gravity: 1.6, spawnRate: 2, spawnType: "circle", spawnPos: "center", name: "🌙 Moon" },
  stack: { gravity: 12, spawnRate: 3, spawnType: "rect", spawnPos: "top-center", name: "📦 Stack" },
};

// ─── MAIN APP ────────────────────────────────────────────────────────────────

export default function PhysicsSandbox() {
  const canvasRef = useRef(null);
  const engineRef = useRef(new PhysicsEngine());
  const rendererRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const spawnTimerRef = useRef(0);

  const [paused, setPaused] = useState(false);
  const [debug, setDebug] = useState(false);
  const [bodyCount, setBodyCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [palette, setPalette] = useState("neon");
  const [activePreset, setActivePreset] = useState(null);

  const [settings, setSettings] = useState({
    gravity: 9.8,
    friction: 0.3,
    restitution: 0.6,
    spawnRate: 0,
    spawnType: "circle",
    spawnPos: "random",
  });

  const settingsRef = useRef(settings);
  const pausedRef = useRef(false);
  const debugRef = useRef(false);
  const paletteRef = useRef(palette);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { pausedRef.current = paused; engineRef.current.paused = paused; }, [paused]);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  useEffect(() => { paletteRef.current = palette; }, [palette]);

  const getColor = useCallback(() => {
    const p = PALETTES[paletteRef.current];
    return p[Math.floor(Math.random() * p.length)];
  }, []);

  const spawnBody = useCallback((x, y, type) => {
    const eng = engineRef.current;
    const s = settingsRef.current;
    eng.globalFriction = s.friction;
    eng.globalRestitution = s.restitution;
    const t = type || s.spawnType;
    const actualType = t === "mixed" ? (Math.random() > 0.5 ? "circle" : "rect") : t;
    const r = 12 + Math.random() * 16;
    eng.addBody({
      x, y, type: actualType,
      radius: r,
      width: r * 2, height: r * 2,
      mass: 1 + Math.random() * 2,
      color: getColor(),
    });
  }, [getColor]);

  const getSpawnPos = useCallback((W, H) => {
    const pos = settingsRef.current.spawnPos;
    if (pos === "top-random") return { x: 20 + Math.random() * (W - 40), y: 30 };
    if (pos === "top-center") return { x: W / 2 + (Math.random() - 0.5) * 60, y: 30 };
    if (pos === "center") return { x: W / 2 + (Math.random() - 0.5) * 100, y: H / 2 };
    return { x: 20 + Math.random() * (W - 40), y: 20 + Math.random() * (H - 40) };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    rendererRef.current = new Renderer(canvas);

    // click to spawn
    const onClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      spawnBody(e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("click", onClick);

    let fpsCounter = 0, fpsTimer = 0;

    const loop = (ts) => {
      const dt = lastTimeRef.current ? Math.min((ts - lastTimeRef.current) / 1000, 0.05) : 0.016;
      lastTimeRef.current = ts;

      const eng = engineRef.current;
      const rnd = rendererRef.current;
      const s = settingsRef.current;

      eng.gravity = s.gravity;
      eng.globalFriction = s.friction;
      eng.globalRestitution = s.restitution;

      // auto-spawn
      if (!pausedRef.current && s.spawnRate > 0) {
        spawnTimerRef.current += dt;
        const interval = 1 / s.spawnRate;
        if (spawnTimerRef.current >= interval) {
          spawnTimerRef.current = 0;
          const { x, y } = getSpawnPos(canvas.width, canvas.height);
          spawnBody(x, y);
          // cap at 150
          if (eng.bodies.length > 150) eng.bodies.shift();
        }
      }

      eng.step(dt, canvas.width, canvas.height);
      rnd.clear();
      for (const b of eng.bodies) rnd.drawBody(b, debugRef.current);
      if (debugRef.current) rnd.drawCollisionPoints(eng.collisionPoints);

      fpsCounter++;
      fpsTimer += dt;
      if (fpsTimer >= 0.5) {
        setFps(Math.round(fpsCounter / fpsTimer));
        fpsCounter = 0; fpsTimer = 0;
        setBodyCount(eng.bodies.length);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("click", onClick);
    };
  }, [spawnBody, getSpawnPos]);

  const applyPreset = (key) => {
    const p = PRESETS[key];
    setSettings(s => ({ ...s, gravity: p.gravity, spawnRate: p.spawnRate, spawnType: p.spawnType, spawnPos: p.spawnPos }));
    setActivePreset(key);
  };

  const update = (key, val) => {
    setSettings(s => ({ ...s, [key]: val }));
    setActivePreset(null);
  };

  const reset = () => {
    engineRef.current.reset();
    setBodyCount(0);
    setActivePreset(null);
  };

  const Slider = ({ label, k, min, max, step = 0.1, unit = "" }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: "#888", fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>{label}</span>
        <span style={{ color: "#00ffaa", fontSize: 12, fontFamily: "monospace" }}>
          {typeof settings[k] === "number" ? settings[k].toFixed(step < 1 ? 1 : 0) : settings[k]}{unit}
        </span>
      </div>
      <div style={{ position: "relative", height: 4, background: "#1a1a2e", borderRadius: 2 }}>
        <div style={{
          position: "absolute", left: 0, top: 0, height: "100%",
          width: `${((settings[k] - min) / (max - min)) * 100}%`,
          background: "linear-gradient(90deg, #00ffaa, #00ccff)",
          borderRadius: 2, transition: "width 0.1s"
        }} />
        <input type="range" min={min} max={max} step={step}
          value={settings[k]}
          onChange={e => update(k, parseFloat(e.target.value))}
          style={{
            position: "absolute", inset: 0, width: "100%", opacity: 0,
            cursor: "pointer", height: "100%", margin: 0
          }}
        />
      </div>
    </div>
  );

  return (
    <div style={{
      display: "flex", height: "100vh", background: "#0a0a0f",
      fontFamily: "'Courier New', monospace", color: "#fff", overflow: "hidden"
    }}>
      {/* CANVAS */}
      <div style={{ flex: 1, position: "relative" }}>
        <canvas ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
        />

        {/* HUD */}
        <div style={{
          position: "absolute", top: 16, left: 16,
          display: "flex", gap: 8, alignItems: "center"
        }}>
          <div style={{
            background: "#0a0a0fcc", border: "1px solid #ffffff11",
            borderRadius: 6, padding: "6px 12px",
            fontSize: 11, letterSpacing: 1, color: "#444"
          }}>
            <span style={{ color: fps > 50 ? "#00ffaa" : fps > 30 ? "#ffaa00" : "#ff4444" }}>
              {fps}
            </span> FPS &nbsp;·&nbsp;
            <span style={{ color: "#00ccff" }}>{bodyCount}</span> BODIES
          </div>
          {paused && (
            <div style={{
              background: "#ffaa0022", border: "1px solid #ffaa0044",
              borderRadius: 6, padding: "6px 12px",
              fontSize: 11, letterSpacing: 1, color: "#ffaa00"
            }}>⏸ PAUSED</div>
          )}
        </div>

        {/* click hint */}
        {bodyCount === 0 && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", pointerEvents: "none"
          }}>
            <div style={{
              textAlign: "center", color: "#ffffff22",
              fontSize: 14, letterSpacing: 2
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⊕</div>
              CLICK TO SPAWN OBJECTS
            </div>
          </div>
        )}
      </div>

      {/* CONTROL PANEL */}
      <div style={{
        width: 260, background: "#0d0d18",
        borderLeft: "1px solid #ffffff0a",
        display: "flex", flexDirection: "column",
        overflowY: "auto"
      }}>

        {/* Header */}
        <div style={{
          padding: "20px 20px 16px",
          borderBottom: "1px solid #ffffff08"
        }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#444", marginBottom: 4 }}>
            PHYSICS ENGINE
          </div>
          <div style={{ fontSize: 18, fontWeight: "bold", letterSpacing: 1, color: "#fff" }}>
            SANDBOX
          </div>
          <div style={{
            marginTop: 6, height: 2,
            background: "linear-gradient(90deg, #00ffaa, #00ccff, transparent)"
          }} />
        </div>

        {/* Controls */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #ffffff08" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#444", marginBottom: 12 }}>
            SIMULATION
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {[
              { label: paused ? "▶ PLAY" : "⏸ PAUSE", action: () => setPaused(p => !p), accent: paused ? "#00ffaa" : "#ffaa00" },
              { label: "↺ RESET", action: reset, accent: "#ff4466" },
            ].map(({ label, action, accent }) => (
              <button key={label} onClick={action} style={{
                flex: 1, padding: "8px 0", background: "transparent",
                border: `1px solid ${accent}44`, borderRadius: 4,
                color: accent, fontSize: 10, letterSpacing: 1,
                cursor: "pointer", transition: "all 0.15s"
              }}
                onMouseEnter={e => e.target.style.background = accent + "22"}
                onMouseLeave={e => e.target.style.background = "transparent"}
              >{label}</button>
            ))}
          </div>
          <button
            onClick={() => setDebug(d => !d)}
            style={{
              width: "100%", padding: "8px 0", background: debug ? "#00ccff11" : "transparent",
              border: `1px solid ${debug ? "#00ccff66" : "#ffffff11"}`, borderRadius: 4,
              color: debug ? "#00ccff" : "#444", fontSize: 10, letterSpacing: 1,
              cursor: "pointer", transition: "all 0.15s"
            }}
          >
            {debug ? "✓" : "○"} DEBUG MODE
          </button>
        </div>

        {/* Physics */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #ffffff08" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#444", marginBottom: 12 }}>
            PHYSICS
          </div>
          <Slider label="Gravity" k="gravity" min={-5} max={20} step={0.1} unit=" m/s²" />
          <Slider label="Friction" k="friction" min={0} max={1} step={0.01} />
          <Slider label="Bounce" k="restitution" min={0} max={1} step={0.01} />
        </div>

        {/* Spawn */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #ffffff08" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#444", marginBottom: 12 }}>
            SPAWN SYSTEM
          </div>
          <Slider label="Auto Rate" k="spawnRate" min={0} max={10} step={0.5} unit="/s" />

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 1, color: "#888", marginBottom: 6, textTransform: "uppercase" }}>Type</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["circle", "rect", "mixed"].map(t => (
                <button key={t} onClick={() => update("spawnType", t)} style={{
                  flex: 1, padding: "6px 0", fontSize: 9, letterSpacing: 1,
                  background: settings.spawnType === t ? "#00ffaa22" : "transparent",
                  border: `1px solid ${settings.spawnType === t ? "#00ffaa66" : "#ffffff11"}`,
                  borderRadius: 4, color: settings.spawnType === t ? "#00ffaa" : "#555",
                  cursor: "pointer", textTransform: "uppercase"
                }}>{t}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, color: "#888", marginBottom: 6, textTransform: "uppercase" }}>Spawn Position</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {[
                { k: "top-random", l: "Top" },
                { k: "top-center", l: "Center↑" },
                { k: "center", l: "Middle" },
                { k: "random", l: "Random" },
              ].map(({ k, l }) => (
                <button key={k} onClick={() => update("spawnPos", k)} style={{
                  flex: "1 1 40%", padding: "6px 0", fontSize: 9, letterSpacing: 1,
                  background: settings.spawnPos === k ? "#00ccff22" : "transparent",
                  border: `1px solid ${settings.spawnPos === k ? "#00ccff66" : "#ffffff11"}`,
                  borderRadius: 4, color: settings.spawnPos === k ? "#00ccff" : "#555",
                  cursor: "pointer", textTransform: "uppercase"
                }}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Palette */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #ffffff08" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#444", marginBottom: 10 }}>
            COLOR PALETTE
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {Object.entries(PALETTES).map(([name, cols]) => (
              <button key={name} onClick={() => setPalette(name)} style={{
                flex: 1, padding: "8px 0", background: "transparent",
                border: `1px solid ${palette === name ? "#ffffff44" : "#ffffff11"}`,
                borderRadius: 4, cursor: "pointer", display: "flex",
                justifyContent: "center", gap: 2
              }}>
                {cols.slice(0, 3).map((c, i) => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
                ))}
              </button>
            ))}
          </div>
        </div>

        {/* Presets */}
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#444", marginBottom: 10 }}>
            PRESETS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <button key={key} onClick={() => { reset(); setTimeout(() => applyPreset(key), 50); }} style={{
                width: "100%", padding: "10px 14px", textAlign: "left",
                background: activePreset === key ? "#ffffff0a" : "transparent",
                border: `1px solid ${activePreset === key ? "#ffffff22" : "#ffffff08"}`,
                borderRadius: 4, color: activePreset === key ? "#fff" : "#555",
                fontSize: 11, letterSpacing: 1, cursor: "pointer",
                transition: "all 0.15s"
              }}
                onMouseEnter={e => { if (activePreset !== key) e.currentTarget.style.color = "#888"; }}
                onMouseLeave={e => { if (activePreset !== key) e.currentTarget.style.color = "#555"; }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: "auto", padding: "12px 20px",
          borderTop: "1px solid #ffffff08",
          fontSize: 9, color: "#333", letterSpacing: 1
        }}>
          CLICK CANVAS TO SPAWN · BUILT WITH REACT + CANVAS
        </div>
      </div>

      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #00ffaa;
          cursor: pointer;
          margin-top: -5px;
          box-shadow: 0 0 6px #00ffaa88;
        }
        input[type=range]::-webkit-slider-runnable-track {
          height: 4px;
          background: transparent;
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ffffff11; border-radius: 2px; }
      `}</style>
    </div>
  );
}
