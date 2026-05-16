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
  clone() { return new Vec2(this.x, this.y); }
}

let _id = 0;
class Body {
  constructor({ x, y, type = "circle", radius = 20, width = 40, height = 40,
    mass = 1, restitution = 0.6, friction = 0.3, color = "#c8b8a2" }) {
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
    this.trail = [];
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
    const b = new Body({ restitution: this.globalRestitution, friction: this.globalFriction, ...cfg });
    this.bodies.push(b); return b;
  }
  removeBody(id) { this.bodies = this.bodies.filter(b => b.id !== id); }
  reset() { this.bodies = []; this.collisionPoints = []; _id = 0; }
  step(dt, W, H, trailEnabled) {
    if (this.paused) return;
    dt = Math.min(dt, 0.033);
    this.time += dt;
    this.collisionPoints = [];
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      b.colliding = false;
      b.acc = new Vec2(0, this.gravity * 100);
      b.vel = b.vel.add(b.acc.scale(dt));
      b.vel = b.vel.scale(1 - 0.002);
      b.pos = b.pos.add(b.vel.scale(dt));
      b.angle += b.angularVel;
      b.age += dt;
      if (trailEnabled) {
        b.trail.push({ x: b.pos.x, y: b.pos.y });
        if (b.trail.length > 18) b.trail.shift();
      } else {
        b.trail = [];
      }
      this._wallCollide(b, W, H);
    }
    for (let i = 0; i < this.bodies.length; i++)
      for (let j = i + 1; j < this.bodies.length; j++)
        this._resolveCollision(this.bodies[i], this.bodies[j]);
    this.bodies = this.bodies.filter(b => b.pos.y < H + 200 && b.pos.y > -500);
  }
  _wallCollide(b, W, H) {
    const e = b.restitution;
    if (b.type === "circle") {
      const r = b.radius;
      if (b.pos.x - r < 0) { b.pos.x = r; b.vel.x = Math.abs(b.vel.x) * e; b.angularVel *= 0.8; }
      if (b.pos.x + r > W) { b.pos.x = W - r; b.vel.x = -Math.abs(b.vel.x) * e; b.angularVel *= 0.8; }
      if (b.pos.y + r > H) { b.pos.y = H - r; b.vel.y = -Math.abs(b.vel.y) * e; b.vel.x *= (1 - b.friction * 0.1); b.angularVel *= 0.85; }
      if (b.pos.y - r < 0) { b.pos.y = r; b.vel.y = Math.abs(b.vel.y) * e; }
    } else {
      const hw = b.width / 2, hh = b.height / 2;
      if (b.pos.x - hw < 0) { b.pos.x = hw; b.vel.x = Math.abs(b.vel.x) * e; }
      if (b.pos.x + hw > W) { b.pos.x = W - hw; b.vel.x = -Math.abs(b.vel.x) * e; }
      if (b.pos.y + hh > H) { b.pos.y = H - hh; b.vel.y = -Math.abs(b.vel.y) * e; b.vel.x *= (1 - b.friction * 0.1); b.angularVel *= 0.85; }
      if (b.pos.y - hh < 0) { b.pos.y = hh; b.vel.y = Math.abs(b.vel.y) * e; }
    }
  }
  _resolveCollision(a, b) {
    let normal, depth, cp;
    if (a.type === "circle" && b.type === "circle") {
      const d = b.pos.sub(a.pos); const dist = d.len(); const minDist = a.radius + b.radius;
      if (dist >= minDist || dist < 0.001) return;
      normal = d.norm(); depth = minDist - dist; cp = a.pos.add(normal.scale(a.radius));
    } else if (a.type === "rect" && b.type === "rect") {
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      const ox = (a.width / 2 + b.width / 2) - Math.abs(dx);
      const oy = (a.height / 2 + b.height / 2) - Math.abs(dy);
      if (ox <= 0 || oy <= 0) return;
      if (ox < oy) { normal = new Vec2(dx < 0 ? -1 : 1, 0); depth = ox; }
      else { normal = new Vec2(0, dy < 0 ? -1 : 1); depth = oy; }
      cp = new Vec2((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2);
    } else {
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
    const totalInvMass = a.invMass + b.invMass;
    if (totalInvMass === 0) return;
    const sep = normal.scale(depth / totalInvMass);
    a.pos = a.pos.sub(sep.scale(a.invMass));
    b.pos = b.pos.add(sep.scale(b.invMass));
    const relVel = b.vel.sub(a.vel);
    const velAlongNormal = relVel.dot(normal);
    if (velAlongNormal > 0) return;
    const e = Math.min(a.restitution, b.restitution);
    const j = -(1 + e) * velAlongNormal / totalInvMass;
    const impulse = normal.scale(j);
    a.vel = a.vel.sub(impulse.scale(a.invMass));
    b.vel = b.vel.add(impulse.scale(b.invMass));
    a.colliding = true; b.colliding = true;
    if (cp) this.collisionPoints.push(cp);
  }
}

// ─── RENDERER ───────────────────────────────────────────────────────────────

class Renderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext("2d"); }

  clear(dark, showGrid) {
    const ctx = this.ctx;
    ctx.fillStyle = dark ? "#18181b" : "#f5f2ee";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (showGrid) {
      ctx.fillStyle = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.045)";
      for (let x = 0; x < this.canvas.width; x += 32)
        for (let y = 0; y < this.canvas.height; y += 32) {
          ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
        }
    }
  }

  drawTrail(b) {
    if (!b.trail || b.trail.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    for (let i = 1; i < b.trail.length; i++) {
      const alpha = (i / b.trail.length) * 0.35;
      ctx.beginPath();
      ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
      ctx.lineTo(b.trail[i].x, b.trail[i].y);
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = (i / b.trail.length) * (b.radius * 0.6);
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBody(b, debug, dark) {
    const ctx = this.ctx;
    this.drawTrail(b);
    ctx.save();
    ctx.translate(b.pos.x, b.pos.y);
    ctx.rotate(b.angle);
    const alpha = Math.min(1, b.age * 4);
    const col = b.colliding ? (dark ? "#ffffff" : "#1a1a1a") : b.color;

    if (b.type === "circle") {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-b.radius * 0.25, -b.radius * 0.28, b.radius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(b.radius * 0.72, 0);
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      const hw = b.width / 2, hh = b.height / 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, b.width, b.height, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, b.width, hh * 0.5, [3, 3, 0, 0]);
      ctx.fill();
    }
    ctx.restore();

    if (debug) {
      const speed = b.vel.len();
      if (speed > 5) {
        ctx.save();
        ctx.strokeStyle = "rgba(180,60,60,0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(b.pos.x, b.pos.y);
        ctx.lineTo(b.pos.x + b.vel.x * 0.12, b.pos.y + b.vel.y * 0.12);
        ctx.stroke();
        const ang = Math.atan2(b.vel.y, b.vel.x);
        const tipX = b.pos.x + b.vel.x * 0.12, tipY = b.pos.y + b.vel.y * 0.12;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - 7 * Math.cos(ang - 0.4), tipY - 7 * Math.sin(ang - 0.4));
        ctx.lineTo(tipX - 7 * Math.cos(ang + 0.4), tipY - 7 * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fillStyle = "rgba(180,60,60,0.7)"; ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = "rgba(80,130,200,0.35)";
      ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      if (b.type === "circle")
        ctx.strokeRect(b.pos.x - b.radius, b.pos.y - b.radius, b.radius * 2, b.radius * 2);
      else
        ctx.strokeRect(b.pos.x - b.width / 2, b.pos.y - b.height / 2, b.width, b.height);
      ctx.setLineDash([]); ctx.restore();
    }
  }

  drawCollisionPoints(points) {
    const ctx = this.ctx;
    for (const pt of points) {
      ctx.save();
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(200,60,60,0.8)"; ctx.fill();
      ctx.restore();
    }
  }
}

// ─── DATA ───────────────────────────────────────────────────────────────────

const PALETTES = {
  terracotta: ["#c47a5a", "#d4956b", "#a85c3c", "#e8b49a", "#8b4513"],
  slate:      ["#4a6274", "#6b8a9e", "#8faab8", "#2d4a5c", "#3d6070"],
  sage:       ["#6b8c6b", "#8aab7e", "#4a6b4a", "#9ebf92", "#527a52"],
  graphite:   ["#3a3a3a", "#5c5c5c", "#787878", "#262626", "#505050"],
};

const PRESETS = {
  rain:  { gravity: 15, spawnRate: 8,   spawnType: "circle", spawnPos: "top-random", label: "Rain"  },
  chaos: { gravity: 5,  spawnRate: 6,   spawnType: "mixed",  spawnPos: "random",     label: "Chaos" },
  moon:  { gravity: 1.6,spawnRate: 2,   spawnType: "circle", spawnPos: "center",     label: "Moon"  },
  stack: { gravity: 12, spawnRate: 3,   spawnType: "rect",   spawnPos: "top-center", label: "Stack" },
};

// ─── THEME ──────────────────────────────────────────────────────────────────

function makeTheme(dark) {
  return dark ? {
    bg: "#18181b", panel: "#1f1f23", border: "#2e2e34",
    text: "#e8e4de", muted: "#666", accent: "#c47a5a", danger: "#c05050", radius: 4, dark: true,
  } : {
    bg: "#f5f2ee", panel: "#efebe5", border: "#ddd8d0",
    text: "#1c1917", muted: "#9c8f82", accent: "#8b4513", danger: "#a33", radius: 4, dark: false,
  };
}

// ─── UI PRIMITIVES ──────────────────────────────────────────────────────────

const Label = ({ children, T }) => (
  <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, fontFamily: "inherit" }}>
    {children}
  </span>
);

function Toggle({ label, value, onChange, T }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Label T={T}>{label}</Label>
      <button onClick={() => onChange(!value)} style={{
        width: 36, height: 20, borderRadius: 10, border: "none",
        background: value ? T.accent : T.border,
        cursor: "pointer", position: "relative", transition: "background 0.18s", flexShrink: 0,
      }}>
        <div style={{
          position: "absolute", top: 3, left: value ? 18 : 3,
          width: 14, height: 14, borderRadius: "50%",
          background: "#fff", transition: "left 0.18s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)"
        }} />
      </button>
    </div>
  );
}

function Slider({ label, min, max, step = 0.1, unit = "", value, onChange, T }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <Label T={T}>{label}</Label>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.accent }}>
          {typeof value === "number" ? value.toFixed(step < 1 ? 1 : 0) : value}{unit}
        </span>
      </div>
      <div style={{ position: "relative", height: 4, background: T.border, borderRadius: T.radius }}>
        <div style={{
          position: "absolute", left: 0, top: 0, height: "100%",
          width: `${pct}%`, background: T.accent, borderRadius: T.radius, transition: "width 0.08s"
        }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%", margin: 0 }}
        />
      </div>
    </div>
  );
}

function SegmentControl({ options, value, onChange, T }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
      {options.map(({ key, label }) => {
        const active = value === key;
        return (
          <button key={key} onClick={() => onChange(key)} style={{
            flex: 1, padding: "6px 0", fontSize: 10, letterSpacing: "0.06em",
            textTransform: "uppercase", fontFamily: "inherit",
            background: active ? T.accent : "transparent",
            border: `1px solid ${active ? T.accent : T.border}`,
            borderRadius: T.radius, color: active ? "#fff" : T.muted,
            cursor: "pointer", transition: "all 0.12s"
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function Btn({ label, onClick, variant = "default", active = false, T }) {
  const c = variant === "danger"
    ? { border: T.danger, color: T.danger, bg: "transparent" }
    : { border: active ? T.accent : T.border, color: active ? T.accent : T.text, bg: active ? T.accent + "18" : "transparent" };
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "8px 0",
      border: `1px solid ${c.border}`, borderRadius: T.radius,
      background: c.bg, color: c.color,
      fontSize: 11, letterSpacing: "0.06em", fontFamily: "inherit",
      cursor: "pointer", transition: "all 0.12s"
    }}
      onMouseEnter={e => e.currentTarget.style.opacity = "0.72"}
      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
    >{label}</button>
  );
}

function SectionHead({ label, T }) {
  return (
    <div style={{ padding: "14px 20px 8px", borderTop: `1px solid ${T.border}` }}>
      <Label T={T}>{label}</Label>
    </div>
  );
}

function TabBar({ active, onChange, T }) {
  const tabs = ["Simulate", "Spawn", "Display", "Settings"];
  return (
    <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)} style={{
          flex: 1, padding: "10px 0", fontSize: 10, letterSpacing: "0.08em",
          textTransform: "uppercase", fontFamily: "inherit",
          background: "transparent", border: "none",
          borderBottom: active === t ? `2px solid ${T.accent}` : "2px solid transparent",
          color: active === t ? T.accent : T.muted,
          cursor: "pointer", transition: "all 0.12s", marginBottom: -1
        }}>{t}</button>
      ))}
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────

export default function PhysicsSandbox() {
  const canvasRef     = useRef(null);
  const engineRef     = useRef(new PhysicsEngine());
  const rendererRef   = useRef(null);
  const rafRef        = useRef(null);
  const lastTimeRef   = useRef(null);
  const spawnTimerRef = useRef(0);

  const [tab, setTab]             = useState("Simulate");
  const [paused, setPaused]       = useState(false);
  const [debug, setDebug]         = useState(false);
  const [bodyCount, setBodyCount] = useState(0);
  const [fps, setFps]             = useState(0);
  const [palette, setPalette]     = useState("terracotta");
  const [activePreset, setActivePreset] = useState(null);

  const [darkMode, setDarkMode]     = useState(false);
  const [showGrid, setShowGrid]     = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const [bodyLimit, setBodyLimit]   = useState(150);

  const [settings, setSettings] = useState({
    gravity: 9.8, friction: 0.3, restitution: 0.6,
    spawnRate: 0, spawnType: "circle", spawnPos: "random",
  });

  const T = makeTheme(darkMode);

  const settingsRef   = useRef(settings);
  const pausedRef     = useRef(false);
  const debugRef      = useRef(false);
  const paletteRef    = useRef(palette);
  const darkRef       = useRef(darkMode);
  const showGridRef   = useRef(showGrid);
  const showTrailsRef = useRef(showTrails);
  const bodyLimitRef  = useRef(bodyLimit);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { pausedRef.current = paused; engineRef.current.paused = paused; }, [paused]);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  useEffect(() => { paletteRef.current = palette; }, [palette]);
  useEffect(() => { darkRef.current = darkMode; }, [darkMode]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => { showTrailsRef.current = showTrails; }, [showTrails]);
  useEffect(() => { bodyLimitRef.current = bodyLimit; }, [bodyLimit]);

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
    eng.addBody({ x, y, type: actualType, radius: r, width: r * 2, height: r * 2, mass: 1 + Math.random() * 2, color: getColor() });
  }, [getColor]);

  const getSpawnPos = useCallback((W, H) => {
    const pos = settingsRef.current.spawnPos;
    if (pos === "top-random") return { x: 20 + Math.random() * (W - 40), y: 30 };
    if (pos === "top-center") return { x: W / 2 + (Math.random() - 0.5) * 60, y: 30 };
    if (pos === "center")     return { x: W / 2 + (Math.random() - 0.5) * 100, y: H / 2 };
    return { x: 20 + Math.random() * (W - 40), y: 20 + Math.random() * (H - 40) };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener("resize", resize);
    rendererRef.current = new Renderer(canvas);

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

      if (!pausedRef.current && s.spawnRate > 0) {
        spawnTimerRef.current += dt;
        const interval = 1 / s.spawnRate;
        if (spawnTimerRef.current >= interval) {
          spawnTimerRef.current = 0;
          const { x, y } = getSpawnPos(canvas.width, canvas.height);
          spawnBody(x, y);
          if (eng.bodies.length > bodyLimitRef.current) eng.bodies.shift();
        }
      }

      eng.step(dt, canvas.width, canvas.height, showTrailsRef.current);
      rnd.clear(darkRef.current, showGridRef.current);
      for (const b of eng.bodies) rnd.drawBody(b, debugRef.current, darkRef.current);
      if (debugRef.current) rnd.drawCollisionPoints(eng.collisionPoints);

      fpsCounter++; fpsTimer += dt;
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
  const update = (key, val) => { setSettings(s => ({ ...s, [key]: val })); setActivePreset(null); };
  const reset  = () => { engineRef.current.reset(); setBodyCount(0); setActivePreset(null); };

  const fpsColor = fps > 50 ? "#4a7c4a" : fps > 30 ? "#8a6a20" : "#a33";

  function renderTab() {
    if (tab === "Simulate") return (
      <>
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Btn label={paused ? "Resume" : "Pause"} onClick={() => setPaused(p => !p)} active={paused} T={T} />
            <Btn label="Reset" onClick={reset} variant="danger" T={T} />
          </div>
          <div style={{ display: "flex", marginBottom: 16 }}>
            <Btn label={debug ? "Debug On" : "Debug Off"} onClick={() => setDebug(d => !d)} active={debug} T={T} />
          </div>
        </div>
        <SectionHead label="Physics" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <Slider label="Gravity"     min={-5} max={20} step={0.1} unit=" m/s²" value={settings.gravity}     onChange={v => update("gravity", v)}     T={T} />
          <Slider label="Friction"    min={0}  max={1}  step={0.01}             value={settings.friction}    onChange={v => update("friction", v)}    T={T} />
          <Slider label="Restitution" min={0}  max={1}  step={0.01}             value={settings.restitution} onChange={v => update("restitution", v)} T={T} />
        </div>
        <SectionHead label="Presets" T={T} />
        <div style={{ padding: "8px 20px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
          {Object.entries(PRESETS).map(([key, preset]) => {
            const active = activePreset === key;
            return (
              <button key={key}
                onClick={() => { reset(); setTimeout(() => applyPreset(key), 50); }}
                style={{
                  width: "100%", padding: "9px 12px", textAlign: "left",
                  background: active ? T.accent : "transparent",
                  border: `1px solid ${active ? T.accent : T.border}`,
                  borderRadius: T.radius, color: active ? "#fff" : T.text,
                  fontSize: 12, fontFamily: "inherit", cursor: "pointer", transition: "all 0.12s"
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = T.text; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = T.border; }}
              >{preset.label}</button>
            );
          })}
        </div>
      </>
    );

    if (tab === "Spawn") return (
      <>
        <SectionHead label="Auto Spawn" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <Slider label="Rate" min={0} max={10} step={0.5} unit="/s" value={settings.spawnRate} onChange={v => update("spawnRate", v)} T={T} />
        </div>
        <SectionHead label="Shape" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <SegmentControl
            options={[{ key: "circle", label: "Circle" }, { key: "rect", label: "Rect" }, { key: "mixed", label: "Mixed" }]}
            value={settings.spawnType} onChange={v => update("spawnType", v)} T={T}
          />
        </div>
        <SectionHead label="Origin" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <SegmentControl
            options={[{ key: "top-random", label: "Top" }, { key: "top-center", label: "T-Ctr" }, { key: "center", label: "Mid" }, { key: "random", label: "Rand" }]}
            value={settings.spawnPos} onChange={v => update("spawnPos", v)} T={T}
          />
        </div>
        <SectionHead label="Palette" T={T} />
        <div style={{ padding: "12px 20px 16px", display: "flex", gap: 6 }}>
          {Object.entries(PALETTES).map(([name, cols]) => (
            <button key={name} onClick={() => setPalette(name)} title={name} style={{
              flex: 1, height: 32, background: "transparent",
              border: `1px solid ${palette === name ? T.text : T.border}`,
              borderRadius: T.radius, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 2, padding: 4
            }}>
              {cols.slice(0, 3).map((c, i) => (
                <div key={i} style={{ flex: 1, height: "100%", background: c, borderRadius: 2 }} />
              ))}
            </button>
          ))}
        </div>
      </>
    );

    if (tab === "Display") return (
      <>
        <SectionHead label="Canvas" T={T} />
        <div style={{ padding: "12px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <Toggle label="Show grid"   value={showGrid}   onChange={setShowGrid}   T={T} />
          <Toggle label="Body trails" value={showTrails} onChange={setShowTrails} T={T} />
        </div>
        <div style={{ padding: "16px 20px 0" }}>
          <Slider label="Body limit" min={10} max={300} step={10} value={bodyLimit} onChange={setBodyLimit} T={T} />
        </div>
      </>
    );

    if (tab === "Settings") return (
      <>
        <SectionHead label="Appearance" T={T} />
        <div style={{ padding: "12px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <Toggle label="Dark mode" value={darkMode} onChange={setDarkMode} T={T} />
        </div>
        <SectionHead label="Simulation" T={T} />
        <div style={{ padding: "12px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <Toggle label="Debug overlay" value={debug} onChange={setDebug} T={T} />
        </div>
        <SectionHead label="About" T={T} />
        <div style={{ padding: "12px 20px 16px", fontSize: 11, color: T.muted, lineHeight: 1.7 }}>
          2D rigid-body physics engine built with React and Canvas. Supports circle and rectangle collisions with restitution and friction.
        </div>
        <div style={{ padding: "0 20px 16px" }}>
          <button onClick={reset} style={{
            width: "100%", padding: "9px 12px", background: "transparent",
            border: `1px solid ${T.danger}`, borderRadius: T.radius,
            color: T.danger, fontSize: 11, fontFamily: "inherit", cursor: "pointer", letterSpacing: "0.06em"
          }}>Clear all bodies</button>
        </div>
      </>
    );
  }

  return (
    <div style={{
      display: "flex", height: "100vh", background: T.bg,
      fontFamily: "'Georgia', 'Times New Roman', serif",
      color: T.text, overflow: "hidden", transition: "background 0.2s, color 0.2s"
    }}>
      {/* CANVAS */}
      <div style={{ flex: 1, position: "relative" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }} />

        <div style={{ position: "absolute", top: 16, left: 16, display: "flex", gap: 8 }}>
          <div style={{
            background: darkMode ? "rgba(24,24,27,0.85)" : "rgba(245,242,238,0.88)",
            backdropFilter: "blur(4px)", border: `1px solid ${T.border}`,
            borderRadius: T.radius, padding: "5px 12px",
            fontSize: 11, letterSpacing: "0.08em", color: T.muted,
            display: "flex", gap: 12, transition: "all 0.2s"
          }}>
            <span><span style={{ color: fpsColor, fontFamily: "monospace" }}>{fps}</span> fps</span>
            <span><span style={{ color: T.accent, fontFamily: "monospace" }}>{bodyCount}</span> bodies</span>
          </div>
          {paused && (
            <div style={{
              background: darkMode ? "rgba(24,24,27,0.85)" : "rgba(245,242,238,0.88)",
              backdropFilter: "blur(4px)", border: `1px solid ${T.border}`,
              borderRadius: T.radius, padding: "5px 12px",
              fontSize: 11, letterSpacing: "0.08em", color: T.muted
            }}>Paused</div>
          )}
        </div>

        {bodyCount === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ textAlign: "center", color: T.border }}>
              <div style={{ fontSize: 36, marginBottom: 12, lineHeight: 1 }}>+</div>
              <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}>Click to spawn</div>
            </div>
          </div>
        )}
      </div>

      {/* PANEL */}
      <div style={{
        width: 256, background: T.panel, borderLeft: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column", overflowY: "auto", overflowX: "hidden",
        transition: "background 0.2s, border-color 0.2s"
      }}>
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, marginBottom: 3 }}>2D Physics</div>
          <div style={{ fontSize: 20, letterSpacing: "0.02em", color: T.text, lineHeight: 1 }}>Sandbox</div>
          <div style={{ marginTop: 12, height: 1, background: T.border }} />
        </div>

        <div style={{ marginTop: 8 }}>
          <TabBar active={tab} onChange={setTab} T={T} />
        </div>

        <div style={{ flex: 1 }}>{renderTab()}</div>

        <div style={{ padding: "10px 20px", borderTop: `1px solid ${T.border}`, fontSize: 10, color: T.muted, letterSpacing: "0.08em" }}>
          Click canvas to place objects
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        input[type=range] { -webkit-appearance: none; appearance: none; }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 13px; height: 13px;
          border-radius: 50%; background: ${T.accent}; cursor: pointer; margin-top: -4.5px;
        }
        input[type=range]::-webkit-slider-runnable-track { height: 4px; background: transparent; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px; }
      `}</style>
    </div>
  );
}
