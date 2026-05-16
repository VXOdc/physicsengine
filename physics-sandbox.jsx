import { useState, useEffect, useRef, useCallback } from "react";

const TAU = Math.PI * 2;
const STORAGE_KEY = "physicsone-ui-v2";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s) { return new Vec2(this.x * s, this.y * s); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  lenSq() { return this.x * this.x + this.y * this.y; }
  len() { return Math.sqrt(this.lenSq()); }
  norm() {
    const l = this.len();
    return l > 0.000001 ? new Vec2(this.x / l, this.y / l) : new Vec2();
  }
}

function crossVV(a, b) {
  return a.x * b.y - a.y * b.x;
}

function crossSV(s, v) {
  return new Vec2(-s * v.y, s * v.x);
}

function rotate(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

function colorWithAlpha(hex, alpha) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

let nextBodyId = 0;

class Body {
  constructor({
    x,
    y,
    type = "circle",
    radius = 20,
    width = 40,
    height = 40,
    mass = 1,
    restitution = 0.45,
    friction = 0.42,
    color = "#c47a5a",
  }) {
    this.id = nextBodyId++;
    this.pos = new Vec2(x, y);
    this.vel = new Vec2((Math.random() - 0.5) * 36, (Math.random() - 0.5) * 12);
    this.type = type;
    this.radius = radius;
    this.width = width;
    this.height = height;
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.restitution = restitution;
    this.friction = friction;
    this.color = color;
    this.angle = (Math.random() - 0.5) * 0.35;
    this.angularVel = (Math.random() - 0.5) * 1.15;
    this.isStatic = mass === 0;
    this.age = 0;
    this.colliding = false;
    this.dragging = false;
    this.impact = 0;
    this.collisionCount = 0;
    this.trail = [];

    const inertia = type === "circle"
      ? 0.5 * mass * radius * radius
      : (mass * (width * width + height * height)) / 12;
    this.inertia = inertia;
    this.invInertia = mass > 0 && inertia > 0 ? 1 / inertia : 0;
  }
}

class PhysicsEngine {
  constructor() {
    this.bodies = [];
    this.gravity = 9.8;
    this.globalFriction = 0.42;
    this.globalRestitution = 0.45;
    this.paused = false;
    this.time = 0;
    this.collisionPoints = [];
    this.frameCollisionCount = 0;
    this.totalCollisions = 0;
    this.recentCollisions = [];
    this.lastImpactAt = new Map();
    this.gridSize = 96;
  }

  addBody(cfg) {
    const body = new Body({
      restitution: this.globalRestitution,
      friction: this.globalFriction,
      ...cfg,
    });
    this.bodies.push(body);
    return body;
  }

  getBody(id) {
    return this.bodies.find(body => body.id === id);
  }

  removeBody(id) {
    this.bodies = this.bodies.filter(body => body.id !== id);
  }

  reset() {
    this.bodies = [];
    this.collisionPoints = [];
    this.frameCollisionCount = 0;
    this.totalCollisions = 0;
    this.recentCollisions = [];
    this.lastImpactAt.clear();
    nextBodyId = 0;
  }

  step(dt, width, height, trailEnabled, dragState) {
    if (this.paused) return;

    const cappedDt = Math.min(dt, 0.05);
    this.time += cappedDt;
    this.collisionPoints = [];
    this.frameCollisionCount = 0;

    let maxSpeed = 0;
    for (const body of this.bodies) {
      body.colliding = false;
      body.dragging = dragState?.bodyId === body.id;
      body.impact *= 0.86;
      maxSpeed = Math.max(maxSpeed, body.vel.len());
    }

    const substeps = clamp(Math.ceil((maxSpeed * cappedDt) / 34), 2, 7);
    const h = cappedDt / substeps;

    for (let step = 0; step < substeps; step++) {
      for (const body of this.bodies) {
        this.integrateBody(body, h, dragState);
      }

      for (const body of this.bodies) {
        this.resolveWallContacts(body, width, height, h);
      }

      for (let iteration = 0; iteration < 4; iteration++) {
        const pairs = this.findPotentialPairs();
        for (const [a, b] of pairs) {
          this.resolveCollision(a, b, h);
        }
      }
    }

    for (const body of this.bodies) {
      if (trailEnabled) {
        body.trail.push({ x: body.pos.x, y: body.pos.y });
        if (body.trail.length > 20) body.trail.shift();
      } else {
        body.trail = [];
      }
    }

    this.bodies = this.bodies.filter(body => (
      body.pos.y < height + 260 &&
      body.pos.y > -560 &&
      body.pos.x > -260 &&
      body.pos.x < width + 260
    ));
  }

  integrateBody(body, dt, dragState) {
    if (body.isStatic) return;

    if (body.dragging && dragState) {
      const target = new Vec2(dragState.x, dragState.y);
      const toTarget = target.sub(body.pos);
      const distance = toTarget.len();
      const stiffness = clamp(12 + distance * 0.06, 12, 30);
      const desiredVelocity = toTarget.scale(stiffness);
      body.vel = body.vel.scale(0.32).add(desiredVelocity.scale(0.68));
      body.angularVel *= 0.45;
    } else {
      body.vel = body.vel.add(new Vec2(0, this.gravity * 100 * dt));
    }

    const linearDamping = Math.pow(0.996, dt * 60);
    const angularDamping = Math.pow(0.988, dt * 60);
    body.vel = body.vel.scale(linearDamping);
    body.angularVel *= angularDamping;

    const speed = body.vel.len();
    if (speed > 2200) body.vel = body.vel.scale(2200 / speed);
    body.angularVel = clamp(body.angularVel, -16, 16);

    body.pos = body.pos.add(body.vel.scale(dt));
    body.angle += body.angularVel * dt;
    body.age += dt;
  }

  findPotentialPairs() {
    const grid = new Map();
    const seen = new Set();
    const pairs = [];
    const size = this.gridSize;

    for (const body of this.bodies) {
      const aabb = this.getAABB(body);
      const minX = Math.floor(aabb.minX / size);
      const maxX = Math.floor(aabb.maxX / size);
      const minY = Math.floor(aabb.minY / size);
      const maxY = Math.floor(aabb.maxY / size);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}:${y}`;
          const bucket = grid.get(key);
          if (bucket) {
            for (const other of bucket) {
              const aId = Math.min(body.id, other.id);
              const bId = Math.max(body.id, other.id);
              const pairKey = `${aId}:${bId}`;
              if (!seen.has(pairKey)) {
                seen.add(pairKey);
                pairs.push([other, body]);
              }
            }
            bucket.push(body);
          } else {
            grid.set(key, [body]);
          }
        }
      }
    }

    return pairs;
  }

  resolveCollision(a, b, dt) {
    if (a.invMass + b.invMass === 0) return false;
    const contact = this.findCollision(a, b);
    if (!contact) return false;

    const { normal, depth, point } = contact;
    a.colliding = true;
    b.colliding = true;
    this.frameCollisionCount += 1;
    if (this.collisionPoints.length < 120) this.collisionPoints.push(point);

    const impactSpeed = this.applyImpulse(a, b, normal, point, depth, dt);
    this.applyPositionCorrection(a, b, normal, depth);

    if (impactSpeed > 42) {
      this.rememberCollision(a, b, point, impactSpeed);
      a.impact = Math.min(1, a.impact + impactSpeed / 520);
      b.impact = Math.min(1, b.impact + impactSpeed / 520);
    }

    return true;
  }

  applyImpulse(a, b, normal, point, depth, dt) {
    const ra = point.sub(a.pos);
    const rb = point.sub(b.pos);
    const rv = b.vel.add(crossSV(b.angularVel, rb)).sub(a.vel.add(crossSV(a.angularVel, ra)));
    const velAlongNormal = rv.dot(normal);

    if (velAlongNormal > 0) return 0;

    const raCrossN = crossVV(ra, normal);
    const rbCrossN = crossVV(rb, normal);
    const invMassSum = a.invMass + b.invMass +
      raCrossN * raCrossN * a.invInertia +
      rbCrossN * rbCrossN * b.invInertia;

    if (invMassSum <= 0) return 0;

    const impactSpeed = -velAlongNormal;
    const restitution = impactSpeed < 85 ? 0 : Math.min(a.restitution, b.restitution);
    const bias = Math.max(depth - 0.8, 0) * 0.035 / Math.max(dt, 0.0001);
    const impulseMag = Math.max(0, (-(1 + restitution) * velAlongNormal + bias) / invMassSum);
    const impulse = normal.scale(impulseMag);

    this.applyBodyImpulse(a, impulse.scale(-1), ra);
    this.applyBodyImpulse(b, impulse, rb);

    const rvAfter = b.vel.add(crossSV(b.angularVel, rb)).sub(a.vel.add(crossSV(a.angularVel, ra)));
    const tangentRaw = rvAfter.sub(normal.scale(rvAfter.dot(normal)));
    if (tangentRaw.lenSq() > 0.000001) {
      const tangent = tangentRaw.norm();
      const raCrossT = crossVV(ra, tangent);
      const rbCrossT = crossVV(rb, tangent);
      const tangentMass = a.invMass + b.invMass +
        raCrossT * raCrossT * a.invInertia +
        rbCrossT * rbCrossT * b.invInertia;

      if (tangentMass > 0) {
        const jt = -rvAfter.dot(tangent) / tangentMass;
        const mu = Math.sqrt(a.friction * b.friction);
        const frictionMag = clamp(jt, -impulseMag * mu, impulseMag * mu);
        const frictionImpulse = tangent.scale(frictionMag);
        this.applyBodyImpulse(a, frictionImpulse.scale(-1), ra);
        this.applyBodyImpulse(b, frictionImpulse, rb);
      }
    }

    return impactSpeed;
  }

  applyBodyImpulse(body, impulse, contactVector) {
    if (body.isStatic) return;
    body.vel = body.vel.add(impulse.scale(body.invMass));
    body.angularVel += body.invInertia * crossVV(contactVector, impulse);
  }

  applyPositionCorrection(a, b, normal, depth) {
    const totalInvMass = a.invMass + b.invMass;
    if (totalInvMass <= 0) return;
    const slop = 0.55;
    const percent = 0.72;
    const amount = (Math.max(depth - slop, 0) / totalInvMass) * percent;
    const correction = normal.scale(amount);
    if (!a.isStatic) a.pos = a.pos.sub(correction.scale(a.invMass));
    if (!b.isStatic) b.pos = b.pos.add(correction.scale(b.invMass));
  }

  resolveWallContacts(body, width, height, dt) {
    if (body.isStatic) return;
    const aabb = this.getAABB(body);

    if (aabb.minX < 0) this.resolveWall(body, new Vec2(1, 0), -aabb.minX, new Vec2(0, body.pos.y), "left wall", dt);
    if (aabb.maxX > width) this.resolveWall(body, new Vec2(-1, 0), aabb.maxX - width, new Vec2(width, body.pos.y), "right wall", dt);
    if (aabb.minY < 0) this.resolveWall(body, new Vec2(0, 1), -aabb.minY, new Vec2(body.pos.x, 0), "ceiling", dt);
    if (aabb.maxY > height) this.resolveWall(body, new Vec2(0, -1), aabb.maxY - height, new Vec2(body.pos.x, height), "floor", dt);
  }

  resolveWall(body, normal, depth, point, label, dt) {
    body.pos = body.pos.add(normal.scale(depth + 0.02));
    body.colliding = true;
    this.frameCollisionCount += 1;
    if (this.collisionPoints.length < 120) this.collisionPoints.push(point);

    const r = point.sub(body.pos);
    const rv = body.vel.add(crossSV(body.angularVel, r));
    const velAlongNormal = rv.dot(normal);

    if (normal.y !== 0) {
      body.vel.x *= 1 - body.friction * 0.035;
      body.angularVel *= 1 - body.friction * 0.045;
    }

    if (velAlongNormal >= 0) return;

    const rCrossN = crossVV(r, normal);
    const invMassSum = body.invMass + rCrossN * rCrossN * body.invInertia;
    if (invMassSum <= 0) return;

    const impactSpeed = -velAlongNormal;
    const restitution = impactSpeed < 90 ? 0 : body.restitution;
    const bias = Math.max(depth - 0.8, 0) * 0.025 / Math.max(dt, 0.0001);
    const impulseMag = (-(1 + restitution) * velAlongNormal + bias) / invMassSum;
    const impulse = normal.scale(impulseMag);
    this.applyBodyImpulse(body, impulse, r);

    const rvAfter = body.vel.add(crossSV(body.angularVel, r));
    const tangentRaw = rvAfter.sub(normal.scale(rvAfter.dot(normal)));
    if (tangentRaw.lenSq() > 0.000001) {
      const tangent = tangentRaw.norm();
      const rCrossT = crossVV(r, tangent);
      const tangentMass = body.invMass + rCrossT * rCrossT * body.invInertia;
      if (tangentMass > 0) {
        const jt = -rvAfter.dot(tangent) / tangentMass;
        const frictionMag = clamp(jt, -impulseMag * body.friction, impulseMag * body.friction);
        this.applyBodyImpulse(body, tangent.scale(frictionMag), r);
      }
    }

    if (impactSpeed > 56) {
      this.rememberWallCollision(body, label, point, impactSpeed);
      body.impact = Math.min(1, body.impact + impactSpeed / 540);
    }
  }

  findCollision(a, b) {
    if (a.type === "circle" && b.type === "circle") return this.circleCircle(a, b);
    if (a.type === "rect" && b.type === "rect") return this.rectRect(a, b);
    if (a.type === "circle" && b.type === "rect") return this.circleRect(a, b);
    const contact = this.circleRect(b, a);
    if (!contact) return null;
    return { ...contact, normal: contact.normal.scale(-1) };
  }

  circleCircle(a, b) {
    const delta = b.pos.sub(a.pos);
    const distSq = delta.lenSq();
    const minDist = a.radius + b.radius;
    if (distSq >= minDist * minDist) return null;

    const dist = Math.sqrt(Math.max(distSq, 0.000001));
    const normal = dist > 0.001 ? delta.scale(1 / dist) : new Vec2(1, 0);
    const depth = minDist - dist;
    const point = a.pos.add(normal.scale(a.radius - depth * 0.5));
    return { normal, depth, point };
  }

  rectRect(a, b) {
    const axes = [...this.rectAxes(a), ...this.rectAxes(b)];
    const centerDelta = b.pos.sub(a.pos);
    let bestAxis = null;
    let bestOverlap = Infinity;

    for (const axis of axes) {
      const distance = Math.abs(centerDelta.dot(axis));
      const overlap = this.rectProjectionRadius(a, axis) + this.rectProjectionRadius(b, axis) - distance;
      if (overlap <= 0) return null;
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestAxis = centerDelta.dot(axis) < 0 ? axis.scale(-1) : axis;
      }
    }

    const supportA = this.supportPoint(a, bestAxis);
    const supportB = this.supportPoint(b, bestAxis.scale(-1));
    const point = supportA.add(supportB).scale(0.5);
    return { normal: bestAxis, depth: bestOverlap, point };
  }

  circleRect(circle, rect) {
    const toCircle = circle.pos.sub(rect.pos);
    const local = rotate(toCircle, -rect.angle);
    const hw = rect.width / 2;
    const hh = rect.height / 2;
    const closest = new Vec2(clamp(local.x, -hw, hw), clamp(local.y, -hh, hh));
    const delta = local.sub(closest);
    const distSq = delta.lenSq();

    if (distSq > circle.radius * circle.radius) return null;

    let normalRectToCircle;
    let depth;
    let pointLocal;

    if (distSq > 0.000001) {
      const dist = Math.sqrt(distSq);
      normalRectToCircle = rotate(delta.scale(1 / dist), rect.angle);
      depth = circle.radius - dist;
      pointLocal = closest;
    } else {
      const overlapX = hw - Math.abs(local.x);
      const overlapY = hh - Math.abs(local.y);
      if (overlapX < overlapY) {
        const sign = local.x < 0 ? -1 : 1;
        normalRectToCircle = rotate(new Vec2(sign, 0), rect.angle);
        depth = circle.radius + overlapX;
        pointLocal = new Vec2(sign * hw, local.y);
      } else {
        const sign = local.y < 0 ? -1 : 1;
        normalRectToCircle = rotate(new Vec2(0, sign), rect.angle);
        depth = circle.radius + overlapY;
        pointLocal = new Vec2(local.x, sign * hh);
      }
    }

    const point = rect.pos.add(rotate(pointLocal, rect.angle));
    return { normal: normalRectToCircle.scale(-1), depth, point };
  }

  rectAxes(body) {
    const c = Math.cos(body.angle);
    const s = Math.sin(body.angle);
    return [new Vec2(c, s), new Vec2(-s, c)];
  }

  rectProjectionRadius(body, axis) {
    const [right, up] = this.rectAxes(body);
    return Math.abs(axis.dot(right)) * body.width * 0.5 +
      Math.abs(axis.dot(up)) * body.height * 0.5;
  }

  rectVertices(body) {
    const [right, up] = this.rectAxes(body);
    const hw = body.width / 2;
    const hh = body.height / 2;
    return [
      body.pos.add(right.scale(-hw)).add(up.scale(-hh)),
      body.pos.add(right.scale(hw)).add(up.scale(-hh)),
      body.pos.add(right.scale(hw)).add(up.scale(hh)),
      body.pos.add(right.scale(-hw)).add(up.scale(hh)),
    ];
  }

  supportPoint(body, dir) {
    if (body.type === "circle") {
      return body.pos.add(dir.norm().scale(body.radius));
    }
    const [right, up] = this.rectAxes(body);
    return body.pos
      .add(right.scale((dir.dot(right) >= 0 ? 1 : -1) * body.width * 0.5))
      .add(up.scale((dir.dot(up) >= 0 ? 1 : -1) * body.height * 0.5));
  }

  getAABB(body) {
    if (body.type === "circle") {
      return {
        minX: body.pos.x - body.radius,
        minY: body.pos.y - body.radius,
        maxX: body.pos.x + body.radius,
        maxY: body.pos.y + body.radius,
      };
    }

    const vertices = this.rectVertices(body);
    return vertices.reduce((box, p) => ({
      minX: Math.min(box.minX, p.x),
      minY: Math.min(box.minY, p.y),
      maxX: Math.max(box.maxX, p.x),
      maxY: Math.max(box.maxY, p.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  }

  hitTest(x, y) {
    const point = new Vec2(x, y);
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const body = this.bodies[i];
      if (body.type === "circle") {
        if (point.sub(body.pos).lenSq() <= body.radius * body.radius) return body;
      } else {
        const local = rotate(point.sub(body.pos), -body.angle);
        if (Math.abs(local.x) <= body.width / 2 && Math.abs(local.y) <= body.height / 2) return body;
      }
    }
    return null;
  }

  rememberCollision(a, b, point, speed) {
    const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
    const last = this.lastImpactAt.get(key) ?? -Infinity;
    if (this.time - last < 0.12) return;
    this.lastImpactAt.set(key, this.time);
    a.collisionCount += 1;
    b.collisionCount += 1;
    this.totalCollisions += 1;
    this.recentCollisions.unshift({
      id: `${key}:${this.totalCollisions}`,
      label: `Body ${a.id} with body ${b.id}`,
      speed,
      x: point.x,
      y: point.y,
    });
    this.recentCollisions = this.recentCollisions.slice(0, 7);
  }

  rememberWallCollision(body, wall, point, speed) {
    const key = `${body.id}:${wall}`;
    const last = this.lastImpactAt.get(key) ?? -Infinity;
    if (this.time - last < 0.14) return;
    this.lastImpactAt.set(key, this.time);
    body.collisionCount += 1;
    this.totalCollisions += 1;
    this.recentCollisions.unshift({
      id: `${key}:${this.totalCollisions}`,
      label: `Body ${body.id} with ${wall}`,
      speed,
      x: point.x,
      y: point.y,
    });
    this.recentCollisions = this.recentCollisions.slice(0, 7);
  }
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  clear(dark, showGrid) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    if (dark) {
      gradient.addColorStop(0, "#151413");
      gradient.addColorStop(1, "#201a17");
    } else {
      gradient.addColorStop(0, "#f6f0e8");
      gradient.addColorStop(1, "#eadfd3");
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    if (!showGrid) return;
    ctx.save();
    ctx.fillStyle = dark ? "rgba(255, 246, 232, 0.045)" : "rgba(70, 52, 38, 0.065)";
    for (let x = 0; x < w; x += 32) {
      for (let y = 0; y < h; y += 32) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawTrail(body) {
    if (!body.trail || body.trail.length < 2) return;
    const ctx = this.ctx;
    const size = body.type === "circle" ? body.radius : Math.max(body.width, body.height) * 0.45;
    ctx.save();
    for (let i = 1; i < body.trail.length; i++) {
      const alpha = (i / body.trail.length) * 0.22;
      ctx.beginPath();
      ctx.moveTo(body.trail[i - 1].x, body.trail[i - 1].y);
      ctx.lineTo(body.trail[i].x, body.trail[i].y);
      ctx.strokeStyle = colorWithAlpha(body.color, alpha);
      ctx.lineWidth = Math.max(1, (i / body.trail.length) * size * 0.36);
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBody(body, debug, dark) {
    this.drawTrail(body);

    const ctx = this.ctx;
    const alpha = Math.min(1, body.age * 4);
    const impact = clamp(body.impact, 0, 1);
    const scale = body.dragging ? 1.055 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(body.pos.x, body.pos.y);
    ctx.rotate(body.angle);
    ctx.scale(scale, scale);

    if (body.dragging) {
      ctx.shadowBlur = 24;
      ctx.shadowColor = colorWithAlpha(body.color, dark ? 0.38 : 0.3);
    }

    if (body.type === "circle") {
      const fill = ctx.createRadialGradient(
        -body.radius * 0.32,
        -body.radius * 0.38,
        body.radius * 0.18,
        0,
        0,
        body.radius,
      );
      fill.addColorStop(0, dark ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.34)");
      fill.addColorStop(0.25, body.color);
      fill.addColorStop(1, colorWithAlpha(body.color, dark ? 0.72 : 0.86));

      ctx.beginPath();
      ctx.arc(0, 0, body.radius, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5 + impact * 1.8;
      ctx.strokeStyle = body.dragging
        ? colorWithAlpha(body.color, 0.85)
        : dark ? `rgba(255, 244, 230, ${0.16 + impact * 0.22})` : `rgba(60, 38, 25, ${0.18 + impact * 0.2})`;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(body.radius * 0.72, 0);
      ctx.strokeStyle = dark ? "rgba(35, 26, 20, 0.45)" : "rgba(42, 29, 20, 0.28)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else {
      const hw = body.width / 2;
      const hh = body.height / 2;
      const fill = ctx.createLinearGradient(-hw, -hh, hw, hh);
      fill.addColorStop(0, colorWithAlpha("#ffffff", dark ? 0.18 : 0.26));
      fill.addColorStop(0.28, body.color);
      fill.addColorStop(1, colorWithAlpha(body.color, dark ? 0.76 : 0.9));

      ctx.beginPath();
      ctx.roundRect(-hw, -hh, body.width, body.height, 5);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5 + impact * 1.6;
      ctx.strokeStyle = body.dragging
        ? colorWithAlpha(body.color, 0.85)
        : dark ? `rgba(255, 244, 230, ${0.14 + impact * 0.22})` : `rgba(60, 38, 25, ${0.18 + impact * 0.18})`;
      ctx.stroke();

      ctx.fillStyle = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.roundRect(-hw + 4, -hh + 4, body.width - 8, Math.max(4, body.height * 0.28), 4);
      ctx.fill();
    }

    ctx.restore();

    if (debug) this.drawDebug(body, dark);
  }

  drawDebug(body, dark) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = dark ? "rgba(142, 178, 196, 0.45)" : "rgba(56, 95, 120, 0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    if (body.type === "circle") {
      ctx.beginPath();
      ctx.arc(body.pos.x, body.pos.y, body.radius, 0, TAU);
      ctx.stroke();
    } else {
      ctx.translate(body.pos.x, body.pos.y);
      ctx.rotate(body.angle);
      ctx.strokeRect(-body.width / 2, -body.height / 2, body.width, body.height);
    }
    ctx.restore();

    const speed = body.vel.len();
    if (speed > 8) {
      ctx.save();
      ctx.strokeStyle = dark ? "rgba(221, 126, 88, 0.72)" : "rgba(150, 70, 42, 0.72)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(body.pos.x, body.pos.y);
      ctx.lineTo(body.pos.x + body.vel.x * 0.1, body.pos.y + body.vel.y * 0.1);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawCollisionPoints(points, dark) {
    const ctx = this.ctx;
    ctx.save();
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, TAU);
      ctx.fillStyle = dark ? "rgba(235, 148, 107, 0.82)" : "rgba(151, 72, 44, 0.78)";
      ctx.fill();
    }
    ctx.restore();
  }
}

const PALETTES = {
  terracotta: ["#c47a5a", "#d4956b", "#a85c3c", "#e8a98c", "#8c5a3b"],
  river: ["#547386", "#7292a3", "#91a9b0", "#3f6071", "#6f8373"],
  sage: ["#6e8d70", "#8fab82", "#506f53", "#a6b993", "#667a58"],
  mineral: ["#4b4a45", "#777168", "#9a8f81", "#5d6766", "#363b3a"],
};

const PRESETS = {
  rain: { gravity: 15, spawnRate: 8, spawnType: "circle", spawnPos: "top-random", label: "Rain" },
  chaos: { gravity: 5, spawnRate: 6, spawnType: "mixed", spawnPos: "random", label: "Chaos" },
  moon: { gravity: 1.6, spawnRate: 2, spawnType: "circle", spawnPos: "center", label: "Moon" },
  stack: { gravity: 12, spawnRate: 3, spawnType: "rect", spawnPos: "top-center", label: "Stack" },
};

function makeTheme(dark) {
  return dark ? {
    bg: "#161413",
    panel: "#211c19",
    panelSoft: "#2a231f",
    border: "#3a302a",
    text: "#f1e8dd",
    muted: "#a39284",
    faint: "#706358",
    accent: "#d48a64",
    danger: "#e07764",
    good: "#8bb88a",
    radius: 6,
    dark: true,
  } : {
    bg: "#f4eee6",
    panel: "#fffaf4",
    panelSoft: "#efe5da",
    border: "#d9cbbd",
    text: "#251c17",
    muted: "#7d6f63",
    faint: "#a79687",
    accent: "#a85c3c",
    danger: "#a9483e",
    good: "#5c805d",
    radius: 6,
    dark: false,
  };
}

const Label = ({ children, T }) => (
  <span style={{
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: T.faint,
    fontFamily: "inherit",
    fontWeight: 700,
  }}>
    {children}
  </span>
);

function Toggle({ label, value, onChange, T }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <Label T={T}>{label}</Label>
      <button
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          border: `1px solid ${value ? T.accent : T.border}`,
          background: value ? T.accent : T.panelSoft,
          cursor: "pointer",
          position: "relative",
          transition: "background 0.16s, border-color 0.16s",
          flexShrink: 0,
        }}
      >
        <div style={{
          position: "absolute",
          top: 3,
          left: value ? 20 : 3,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: value ? "#fffaf4" : T.muted,
          transition: "left 0.16s, background 0.16s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
        }} />
      </button>
    </div>
  );
}

function Slider({ label, min, max, step = 0.1, unit = "", value, onChange, T }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "baseline" }}>
        <Label T={T}>{label}</Label>
        <span style={{ fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: T.accent }}>
          {typeof value === "number" ? value.toFixed(step < 1 ? 1 : 0) : value}{unit}
        </span>
      </div>
      <div style={{ position: "relative", height: 6, background: T.panelSoft, borderRadius: 999, border: `1px solid ${T.border}` }}>
        <div style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: T.accent,
          borderRadius: 999,
        }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => onChange(parseFloat(event.target.value))}
          style={{ position: "absolute", inset: -6, width: "calc(100% + 12px)", opacity: 0, cursor: "pointer", margin: 0 }}
        />
      </div>
    </div>
  );
}

function SegmentControl({ options, value, onChange, T }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      gap: 4,
      marginBottom: 16,
      padding: 3,
      border: `1px solid ${T.border}`,
      borderRadius: T.radius,
      background: T.panelSoft,
    }}>
      {options.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              padding: "7px 0",
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily: "inherit",
              fontWeight: 700,
              background: active ? T.panel : "transparent",
              border: "none",
              borderRadius: Math.max(3, T.radius - 2),
              color: active ? T.text : T.muted,
              cursor: "pointer",
              boxShadow: active ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
              transition: "color 0.14s, background 0.14s",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Btn({ label, onClick, variant = "default", active = false, T }) {
  const danger = variant === "danger";
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 34,
        padding: "8px 10px",
        border: `1px solid ${danger ? T.danger : active ? T.accent : T.border}`,
        borderRadius: T.radius,
        background: danger ? "transparent" : active ? colorWithAlpha(T.accent, 0.16) : T.panel,
        color: danger ? T.danger : active ? T.accent : T.text,
        fontSize: 11,
        letterSpacing: "0.06em",
        fontFamily: "inherit",
        fontWeight: 700,
        cursor: "pointer",
        transition: "transform 0.12s, border-color 0.12s, background 0.12s",
      }}
      onMouseEnter={event => { event.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={event => { event.currentTarget.style.transform = "translateY(0)"; }}
    >
      {label}
    </button>
  );
}

function SectionHead({ label, T }) {
  return (
    <div style={{ padding: "16px 20px 8px", borderTop: `1px solid ${T.border}` }}>
      <Label T={T}>{label}</Label>
    </div>
  );
}

function TabBar({ active, onChange, T }) {
  const tabs = ["Simulate", "Spawn", "Display", "Settings"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderBottom: `1px solid ${T.border}` }}>
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          style={{
            padding: "12px 0 10px",
            fontSize: 10,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            fontFamily: "inherit",
            fontWeight: 700,
            background: "transparent",
            border: "none",
            borderBottom: active === tab ? `2px solid ${T.accent}` : "2px solid transparent",
            color: active === tab ? T.accent : T.muted,
            cursor: "pointer",
            transition: "color 0.14s, border-color 0.14s",
            marginBottom: -1,
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function CollisionList({ stats, T }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
      }}>
        <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 10, background: T.panel }}>
          <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Total</div>
          <div style={{ fontSize: 18, color: T.text, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{stats.total}</div>
        </div>
        <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 10, background: T.panel }}>
          <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Contacts</div>
          <div style={{ fontSize: 18, color: T.text, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{stats.frame}</div>
        </div>
      </div>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: "hidden", background: T.panel }}>
        {stats.recent.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: T.faint }}>No impacts recorded yet.</div>
        ) : stats.recent.map(item => (
          <div
            key={item.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 10px",
              borderBottom: `1px solid ${T.border}`,
              fontSize: 11,
              color: T.muted,
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
            <span style={{ color: T.accent, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{Math.round(item.speed)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function loadInitialUi() {
  if (typeof window === "undefined") return { themeMode: "system", palette: "terracotta" };
  try {
    return { themeMode: "system", palette: "terracotta", ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { themeMode: "system", palette: "terracotta" };
  }
}

export default function PhysicsSandbox() {
  const canvasRef = useRef(null);
  const engineRef = useRef(new PhysicsEngine());
  const rendererRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const spawnTimerRef = useRef(0);
  const dragRef = useRef(null);
  const darkRef = useRef(false);

  const initialUi = loadInitialUi();
  const [tab, setTab] = useState("Simulate");
  const [paused, setPaused] = useState(false);
  const [debug, setDebug] = useState(false);
  const [bodyCount, setBodyCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [palette, setPalette] = useState(initialUi.palette);
  const [activePreset, setActivePreset] = useState(null);
  const [themeMode, setThemeMode] = useState(initialUi.themeMode);
  const [systemDark, setSystemDark] = useState(() => (
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  ));
  const [showGrid, setShowGrid] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const [bodyLimit, setBodyLimit] = useState(220);
  const [cursor, setCursor] = useState("crosshair");
  const [collisionStats, setCollisionStats] = useState({ total: 0, frame: 0, recent: [] });

  const [settings, setSettings] = useState({
    gravity: 9.8,
    friction: 0.42,
    restitution: 0.45,
    spawnRate: 0,
    spawnType: "circle",
    spawnPos: "random",
  });

  const darkMode = themeMode === "dark" || (themeMode === "system" && systemDark);
  const T = makeTheme(darkMode);

  const settingsRef = useRef(settings);
  const pausedRef = useRef(false);
  const debugRef = useRef(false);
  const paletteRef = useRef(palette);
  const showGridRef = useRef(showGrid);
  const showTrailsRef = useRef(showTrails);
  const bodyLimitRef = useRef(bodyLimit);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { pausedRef.current = paused; engineRef.current.paused = paused; }, [paused]);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  useEffect(() => { paletteRef.current = palette; }, [palette]);
  useEffect(() => { darkRef.current = darkMode; }, [darkMode]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => { showTrailsRef.current = showTrails; }, [showTrails]);
  useEffect(() => { bodyLimitRef.current = bodyLimit; }, [bodyLimit]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = event => setSystemDark(event.matches);
    setSystemDark(mq.matches);
    mq.addEventListener("change", updateSystemTheme);
    return () => mq.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ themeMode, palette }));
    } catch {}
  }, [themeMode, palette, darkMode]);

  const getColor = useCallback(() => {
    const colors = PALETTES[paletteRef.current] || PALETTES.terracotta;
    return colors[Math.floor(Math.random() * colors.length)];
  }, []);

  const trimBodyLimit = useCallback(() => {
    const engine = engineRef.current;
    while (engine.bodies.length > bodyLimitRef.current) {
      const index = engine.bodies.findIndex(body => !body.dragging);
      engine.bodies.splice(index >= 0 ? index : 0, 1);
    }
  }, []);

  const spawnBody = useCallback((x, y, type) => {
    const engine = engineRef.current;
    const s = settingsRef.current;
    engine.globalFriction = s.friction;
    engine.globalRestitution = s.restitution;

    const requestedType = type || s.spawnType;
    const actualType = requestedType === "mixed" ? (Math.random() > 0.52 ? "circle" : "rect") : requestedType;
    const size = 14 + Math.random() * 17;
    const rectStretch = 0.82 + Math.random() * 0.42;

    engine.addBody({
      x,
      y,
      type: actualType,
      radius: size,
      width: actualType === "rect" ? size * 2.35 : size * 2,
      height: actualType === "rect" ? size * 2.35 * rectStretch : size * 2,
      mass: actualType === "rect" ? 1.4 + Math.random() * 2.4 : 1 + Math.random() * 2,
      color: getColor(),
    });
    trimBodyLimit();
  }, [getColor, trimBodyLimit]);

  const getSpawnPos = useCallback((width, height) => {
    const pos = settingsRef.current.spawnPos;
    if (pos === "top-random") return { x: 32 + Math.random() * Math.max(1, width - 64), y: 34 };
    if (pos === "top-center") return { x: width / 2 + (Math.random() - 0.5) * 72, y: 34 };
    if (pos === "center") return { x: width / 2 + (Math.random() - 0.5) * 120, y: height * 0.42 };
    return { x: 36 + Math.random() * Math.max(1, width - 72), y: 36 + Math.random() * Math.max(1, height * 0.5) };
  }, []);

  const reset = useCallback(() => {
    engineRef.current.reset();
    dragRef.current = null;
    setBodyCount(0);
    setCollisionStats({ total: 0, frame: 0, recent: [] });
    setActivePreset(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas.dataset.width = String(rect.width);
      canvas.dataset.height = String(rect.height);
    };

    const pointFromEvent = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const updateHoverCursor = (x, y) => {
      if (dragRef.current) {
        setCursor("grabbing");
        return;
      }
      setCursor(engine.hitTest(x, y) ? "grab" : "crosshair");
    };

    const onPointerDown = event => {
      const { x, y } = pointFromEvent(event);
      const hit = engine.hitTest(x, y);

      if (event.button === 2) {
        event.preventDefault();
        if (hit) {
          engine.removeBody(hit.id);
          setBodyCount(engine.bodies.length);
        }
        return;
      }

      if (hit) {
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          bodyId: hit.id,
          x,
          y,
          lastX: x,
          lastY: y,
          lastTs: performance.now(),
          vx: 0,
          vy: 0,
        };
        hit.dragging = true;
        hit.impact = Math.max(hit.impact, 0.35);
        setCursor("grabbing");
        return;
      }

      spawnBody(x, y);
      setBodyCount(engine.bodies.length);
      updateHoverCursor(x, y);
    };

    const onPointerMove = event => {
      const { x, y } = pointFromEvent(event);
      if (dragRef.current && dragRef.current.pointerId === event.pointerId) {
        const now = performance.now();
        const elapsed = Math.max(16, now - dragRef.current.lastTs);
        dragRef.current.vx = ((x - dragRef.current.lastX) / elapsed) * 1000;
        dragRef.current.vy = ((y - dragRef.current.lastY) / elapsed) * 1000;
        dragRef.current.lastX = x;
        dragRef.current.lastY = y;
        dragRef.current.lastTs = now;
        dragRef.current.x = x;
        dragRef.current.y = y;
        setCursor("grabbing");
        return;
      }
      updateHoverCursor(x, y);
    };

    const endDrag = event => {
      if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
      const body = engine.getBody(dragRef.current.bodyId);
      if (body) {
        body.dragging = false;
        if (event.shiftKey) {
          body.vel = body.vel.add(new Vec2(dragRef.current.vx * 0.45, dragRef.current.vy * 0.45));
        }
      }
      dragRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const { x, y } = pointFromEvent(event);
      updateHoverCursor(x, y);
    };

    const onContextMenu = event => event.preventDefault();

    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("contextmenu", onContextMenu);
    rendererRef.current = new Renderer(canvas);

    let fpsCounter = 0;
    let fpsTimer = 0;

    const loop = timestamp => {
      const dt = lastTimeRef.current ? Math.min((timestamp - lastTimeRef.current) / 1000, 0.05) : 0.016;
      lastTimeRef.current = timestamp;

      const renderer = rendererRef.current;
      const s = settingsRef.current;
      engine.gravity = s.gravity;
      engine.globalFriction = s.friction;
      engine.globalRestitution = s.restitution;

      const width = parseFloat(canvas.dataset.width || canvas.clientWidth || "1");
      const height = parseFloat(canvas.dataset.height || canvas.clientHeight || "1");

      if (!pausedRef.current && s.spawnRate > 0) {
        spawnTimerRef.current += dt;
        const interval = 1 / s.spawnRate;
        while (spawnTimerRef.current >= interval) {
          spawnTimerRef.current -= interval;
          const { x, y } = getSpawnPos(width, height);
          spawnBody(x, y);
        }
      }

      engine.step(dt, width, height, showTrailsRef.current, dragRef.current);
      renderer.clear(darkRef.current, showGridRef.current);
      for (const body of engine.bodies) renderer.drawBody(body, debugRef.current, darkRef.current);
      if (debugRef.current) renderer.drawCollisionPoints(engine.collisionPoints, darkRef.current);

      fpsCounter += 1;
      fpsTimer += dt;
      if (fpsTimer >= 0.35) {
        setFps(Math.round(fpsCounter / fpsTimer));
        fpsCounter = 0;
        fpsTimer = 0;
        setBodyCount(engine.bodies.length);
        setCollisionStats({
          total: engine.totalCollisions,
          frame: engine.frameCollisionCount,
          recent: engine.recentCollisions.slice(0, 5),
        });
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [getSpawnPos, spawnBody]);

  useEffect(() => {
    const onKeyDown = event => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.code === "Space") {
        event.preventDefault();
        setPaused(value => !value);
      } else if (event.key.toLowerCase() === "r") {
        reset();
      } else if (event.key.toLowerCase() === "d") {
        setDebug(value => !value);
      } else if (event.key.toLowerCase() === "t") {
        setShowTrails(value => !value);
      } else if (event.key === "Escape") {
        dragRef.current = null;
        setCursor("crosshair");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reset]);

  const applyPreset = key => {
    const preset = PRESETS[key];
    reset();
    setSettings(current => ({
      ...current,
      gravity: preset.gravity,
      spawnRate: preset.spawnRate,
      spawnType: preset.spawnType,
      spawnPos: preset.spawnPos,
    }));
    setActivePreset(key);
  };

  const update = (key, val) => {
    setSettings(current => ({ ...current, [key]: val }));
    setActivePreset(null);
  };

  const fpsColor = fps > 50 ? T.good : fps > 30 ? T.accent : T.danger;

  function renderTab() {
    if (tab === "Simulate") return (
      <>
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Btn label={paused ? "Resume" : "Pause"} onClick={() => setPaused(value => !value)} active={paused} T={T} />
            <Btn label="Reset" onClick={reset} variant="danger" T={T} />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <Btn label={debug ? "Debug On" : "Debug Off"} onClick={() => setDebug(value => !value)} active={debug} T={T} />
            <Btn label={showTrails ? "Trails On" : "Trails Off"} onClick={() => setShowTrails(value => !value)} active={showTrails} T={T} />
          </div>
        </div>
        <SectionHead label="Physics" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <Slider label="Gravity" min={-5} max={20} step={0.1} unit=" m/s2" value={settings.gravity} onChange={value => update("gravity", value)} T={T} />
          <Slider label="Friction" min={0} max={1} step={0.01} value={settings.friction} onChange={value => update("friction", value)} T={T} />
          <Slider label="Bounciness" min={0} max={1} step={0.01} value={settings.restitution} onChange={value => update("restitution", value)} T={T} />
        </div>
        <SectionHead label="Collision Monitor" T={T} />
        <div style={{ padding: "8px 20px 16px" }}>
          <CollisionList stats={collisionStats} T={T} />
        </div>
        <SectionHead label="Presets" T={T} />
        <div style={{ padding: "8px 20px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(PRESETS).map(([key, preset]) => {
            const active = activePreset === key;
            return (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  textAlign: "left",
                  background: active ? T.accent : T.panel,
                  border: `1px solid ${active ? T.accent : T.border}`,
                  borderRadius: T.radius,
                  color: active ? "#fffaf4" : T.text,
                  fontSize: 12,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "border-color 0.14s, background 0.14s",
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </>
    );

    if (tab === "Spawn") return (
      <>
        <SectionHead label="Auto Spawn" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <Slider label="Rate" min={0} max={10} step={0.5} unit="/s" value={settings.spawnRate} onChange={value => update("spawnRate", value)} T={T} />
        </div>
        <SectionHead label="Shape" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <SegmentControl
            options={[{ key: "circle", label: "Circle" }, { key: "rect", label: "Rect" }, { key: "mixed", label: "Mixed" }]}
            value={settings.spawnType}
            onChange={value => update("spawnType", value)}
            T={T}
          />
        </div>
        <SectionHead label="Origin" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <SegmentControl
            options={[{ key: "top-random", label: "Top" }, { key: "top-center", label: "Center" }, { key: "center", label: "Mid" }, { key: "random", label: "Rand" }]}
            value={settings.spawnPos}
            onChange={value => update("spawnPos", value)}
            T={T}
          />
        </div>
        <SectionHead label="Palette" T={T} />
        <div style={{ padding: "12px 20px 16px", display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {Object.entries(PALETTES).map(([name, colors]) => (
            <button
              key={name}
              onClick={() => setPalette(name)}
              title={name}
              style={{
                height: 34,
                background: T.panel,
                border: `1px solid ${palette === name ? T.accent : T.border}`,
                borderRadius: T.radius,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                padding: 4,
              }}
            >
              {colors.slice(0, 3).map((color, index) => (
                <div key={index} style={{ flex: 1, height: "100%", background: color, borderRadius: 3 }} />
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
          <Toggle label="Show grid" value={showGrid} onChange={setShowGrid} T={T} />
          <Toggle label="Body trails" value={showTrails} onChange={setShowTrails} T={T} />
        </div>
        <div style={{ padding: "16px 20px 0" }}>
          <Slider label="Body limit" min={20} max={320} step={10} value={bodyLimit} onChange={setBodyLimit} T={T} />
        </div>
        <SectionHead label="Shortcuts" T={T} />
        <div style={{ padding: "10px 20px 16px", display: "grid", gap: 7, fontSize: 11, color: T.muted }}>
          <div><strong style={{ color: T.text }}>Space</strong> play or pause</div>
          <div><strong style={{ color: T.text }}>R</strong> reset</div>
          <div><strong style={{ color: T.text }}>D</strong> debug</div>
          <div><strong style={{ color: T.text }}>T</strong> trails</div>
          <div><strong style={{ color: T.text }}>Right click</strong> delete a body</div>
          <div><strong style={{ color: T.text }}>Shift release</strong> throw while dragging</div>
        </div>
      </>
    );

    if (tab === "Settings") return (
      <>
        <SectionHead label="Appearance" T={T} />
        <div style={{ padding: "8px 20px 0" }}>
          <SegmentControl
            options={[{ key: "system", label: "System" }, { key: "light", label: "Light" }, { key: "dark", label: "Dark" }]}
            value={themeMode}
            onChange={setThemeMode}
            T={T}
          />
        </div>
        <SectionHead label="Simulation" T={T} />
        <div style={{ padding: "12px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <Toggle label="Debug overlay" value={debug} onChange={setDebug} T={T} />
          <Toggle label="Trails" value={showTrails} onChange={setShowTrails} T={T} />
        </div>
        <SectionHead label="About" T={T} />
        <div style={{ padding: "12px 20px 16px", fontSize: 11, color: T.muted, lineHeight: 1.7 }}>
          PhysicsOne uses sub-stepped impulse resolution, spatial broad-phase pairing, tangential friction, and angular momentum transfer for circle and rotated rectangle bodies.
        </div>
        <div style={{ padding: "0 20px 16px" }}>
          <button
            onClick={reset}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "transparent",
              border: `1px solid ${T.danger}`,
              borderRadius: T.radius,
              color: T.danger,
              fontSize: 11,
              fontFamily: "inherit",
              cursor: "pointer",
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            Clear all bodies
          </button>
        </div>
      </>
    );

    return null;
  }

  return (
    <div
      className="physics-shell"
      style={{
        display: "flex",
        height: "100vh",
        background: T.bg,
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: T.text,
        overflow: "hidden",
        transition: "background 0.2s, color 0.2s",
      }}
    >
      <div className="canvas-stage" style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor,
            touchAction: "none",
          }}
        />

        <div style={{ position: "absolute", top: 16, left: 16, display: "flex", gap: 8, flexWrap: "wrap", pointerEvents: "none" }}>
          <div style={{
            background: darkMode ? "rgba(33, 28, 25, 0.82)" : "rgba(255, 250, 244, 0.82)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${T.border}`,
            borderRadius: T.radius,
            padding: "7px 12px",
            fontSize: 11,
            letterSpacing: "0.06em",
            color: T.muted,
            display: "flex",
            gap: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}>
            <span><span style={{ color: fpsColor, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{fps}</span> fps</span>
            <span><span style={{ color: T.accent, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{bodyCount}</span> bodies</span>
            <span><span style={{ color: T.accent, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{collisionStats.total}</span> impacts</span>
          </div>
          {paused && (
            <div style={{
              background: darkMode ? "rgba(33, 28, 25, 0.82)" : "rgba(255, 250, 244, 0.82)",
              backdropFilter: "blur(8px)",
              border: `1px solid ${T.border}`,
              borderRadius: T.radius,
              padding: "7px 12px",
              fontSize: 11,
              letterSpacing: "0.06em",
              color: T.muted,
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            }}>
              Paused
            </div>
          )}
        </div>

        {bodyCount === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ textAlign: "center", color: T.faint }}>
              <div style={{ width: 56, height: 56, border: `1px solid ${T.border}`, borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 14px", fontSize: 28, color: T.accent }}>+</div>
              <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>Click to spawn</div>
              <div style={{ fontSize: 11, marginTop: 8, color: T.faint }}>Drag bodies to move them</div>
            </div>
          </div>
        )}
      </div>

      <aside
        className="control-panel"
        style={{
          width: 288,
          background: T.panel,
          borderLeft: `1px solid ${T.border}`,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          overflowX: "hidden",
          transition: "background 0.2s, border-color 0.2s",
        }}
      >
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: T.faint, marginBottom: 4, fontWeight: 700 }}>2D Physics</div>
          <div style={{ fontSize: 22, letterSpacing: "0.01em", color: T.text, lineHeight: 1, fontWeight: 800 }}>PhysicsOne</div>
          <div style={{ marginTop: 14, height: 1, background: T.border }} />
        </div>

        <div style={{ marginTop: 8 }}>
          <TabBar active={tab} onChange={setTab} T={T} />
        </div>

        <div style={{ flex: 1 }}>{renderTab()}</div>

        <div style={{ padding: "11px 20px", borderTop: `1px solid ${T.border}`, fontSize: 10, color: T.faint, letterSpacing: "0.07em", lineHeight: 1.5 }}>
          Click empty space to add. Drag a body to move it.
        </div>
      </aside>

      <style>{`
        * { box-sizing: border-box; }
        input[type=range] { -webkit-appearance: none; appearance: none; }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: ${T.accent};
          cursor: pointer;
          margin-top: -5px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.24);
        }
        input[type=range]::-webkit-slider-runnable-track {
          height: 6px;
          background: transparent;
        }
        button:focus-visible,
        input:focus-visible {
          outline: 2px solid ${T.accent};
          outline-offset: 2px;
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 999px; }
        @media (max-width: 780px) {
          .physics-shell {
            flex-direction: column;
          }
          .canvas-stage {
            min-height: 54vh;
          }
          .control-panel {
            width: 100% !important;
            max-height: 46vh;
            border-left: none !important;
            border-top: 1px solid ${T.border};
          }
        }
      `}</style>
    </div>
  );
}
