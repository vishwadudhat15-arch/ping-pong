import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const CW = 520, CH = 720;
const WALL = 14, BALL_R = 8;
const PAD_W = 76, PAD_H = 10;
const hR = PAD_W / 2;
const WIN_SCORE = 11;
const NET_Y = CH / 2;
const NET_H = 6.5;

const TABLE_TOP = WALL + 6;           // top edge of table surface (CPU side)
const TABLE_BOTTOM = CH - WALL - 6;   // bottom edge (player side)
const TABLE_L = WALL + 6;
const TABLE_R = CW - WALL - 6;

// Ball lives in 3D-like space: bx, by = canvas coords, bz = height above table (0 = on table)
// When bz > 0, ball is in the AIR — it arcs over the table
// When bz hits 0, it bounces on the table with a PING

const GRAVITY = 0.22;   // pulls ball down (reduced for better arc reach)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ─── Audio (Web Audio API) ────────────────────────────────────────────────────
function createPingSound(ctx, freq = 880, type = "ping") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === "ping") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
  } else if (type === "bounce") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 0.6, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.25, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
  } else if (type === "score") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.setValueAtTime(780, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  }

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────
function drawTable(ctx) {
  // Clear the canvas to be transparent to show the CSS room floor
  ctx.clearRect(0, 0, CW, CH);

  // Draw table edge shadow / lip under the table
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(TABLE_L - 3, TABLE_TOP - 3, (TABLE_R - TABLE_L) + 6, (TABLE_BOTTOM - TABLE_TOP) + 12);

  // Table surface (Vibrant Emerald Green)
  const grad = ctx.createLinearGradient(0, TABLE_TOP, 0, TABLE_BOTTOM);
  grad.addColorStop(0, "#2ecc71");
  grad.addColorStop(1, "#27ae60");
  ctx.fillStyle = grad;
  ctx.fillRect(TABLE_L, TABLE_TOP, TABLE_R - TABLE_L, TABLE_BOTTOM - TABLE_TOP);

  // Table Outer White Edge Lines
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 4;
  ctx.strokeRect(TABLE_L + 2, TABLE_TOP + 2, (TABLE_R - TABLE_L) - 4, (TABLE_BOTTOM - TABLE_TOP) - 4);

  // Center vertical solid line
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CW / 2, TABLE_TOP + 2);
  ctx.lineTo(CW / 2, TABLE_BOTTOM - 2);
  ctx.stroke();

  // Net posts
  ctx.fillStyle = "#222";
  ctx.fillRect(TABLE_L - 6, NET_Y - NET_H - 12, 6, NET_H * 2 + 24);
  ctx.fillRect(TABLE_R, NET_Y - NET_H - 12, 6, NET_H * 2 + 24);

  // Net body (dark grid pattern)
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(TABLE_L, NET_Y - NET_H, TABLE_R - TABLE_L, NET_H * 2);

  // Net grid crossings
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  for (let x = TABLE_L + 2; x < TABLE_R; x += 8) {
    ctx.fillRect(x, NET_Y - NET_H, 2, NET_H * 2);
  }
  for (let y = NET_Y - NET_H; y < NET_Y + NET_H; y += 4) {
    ctx.fillRect(TABLE_L, y, TABLE_R - TABLE_L, 1);
  }

  // Net top white tape
  ctx.fillStyle = "#F8F8F8";
  ctx.fillRect(TABLE_L, NET_Y - NET_H - 2, TABLE_R - TABLE_L, 4);
}

// Draw the ball shadow on the table (gives depth cue)
function drawShadow(ctx, bx, by, bz) {
  // Shadow shrinks and fades as ball goes higher
  const shadowAlpha = Math.max(0, 0.35 - bz * 0.007);
  const shadowScale = Math.max(0.2, 1 - bz * 0.012);
  ctx.beginPath();
  ctx.ellipse(bx, by, BALL_R * shadowScale * 1.2, BALL_R * shadowScale * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.fill();
}

// Draw ball — rises visually when bz > 0 (shadow stays at by, ball renders above it)
function drawBall(ctx, bx, by, bz, trail) {
  // Visual y position: scaled appropriately for perspective height
  const vy = by - bz;

  // Trail (in air, more visible)
  const len = trail.length / 2;
  for (let i = 0; i < len; i++) {
    const f = i / len;
    const tr = BALL_R * f * 0.6;
    if (tr < 0.5) continue;
    ctx.beginPath();
    ctx.arc(trail[i * 2], trail[i * 2 + 1], tr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${f * 0.22})`;
    ctx.fill();
  }

  drawShadow(ctx, bx, by, bz);

  // Ball body
  ctx.beginPath();
  ctx.arc(bx, vy, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = "#FFD700";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Specular highlight
  ctx.beginPath();
  ctx.arc(bx - BALL_R * 0.28, vy - BALL_R * 0.3, BALL_R * 0.33, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();

  // Seam line for spin feel
  ctx.beginPath();
  ctx.arc(bx, vy, BALL_R - 1, 0.4, 2.7);
  ctx.strokeStyle = "rgba(200,160,0,0.4)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

// Bounce ring effect
function drawBounceRings(ctx, rings) {
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    const alpha = r.life / r.maxLife * 0.7;
    const radius = (1 - r.life / r.maxLife) * 18 + 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,230,100,${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawPaddle(ctx, x, y, isPlayer, cacheRef) {
  if (!cacheRef.current) {
    const pc = document.createElement("canvas");
    pc.width = 160;
    pc.height = 160;
    const pctx = pc.getContext("2d");
    const color = isPlayer ? "#d32f2f" : "#1565c0";
    const cx = pc.width / 2;
    const cy = pc.height / 2;

    pctx.save();
    pctx.translate(cx, cy);
    // Add professional tilt
    const angle = isPlayer ? -Math.PI / 7 : Math.PI / 7;
    pctx.rotate(angle);

    // Handle
    const handleLen = 38;
    const hY = isPlayer ? 10 : -10 - handleLen;
    pctx.fillStyle = "#5d4037"; // darker wood handle
    pctx.beginPath();
    if (pctx.roundRect) pctx.roundRect(-4.5, hY, 9, handleLen, 3);
    else pctx.rect(-4.5, hY, 9, handleLen);
    pctx.fill();

    // Handle grip shadow
    pctx.fillStyle = "rgba(0,0,0,0.2)";
    pctx.fillRect(-4.5, hY, 2, handleLen);

    // Paddle face centered at local (0,0)
    pctx.fillStyle = color;
    pctx.beginPath();
    pctx.ellipse(0, 0, hR, hR * 0.75, 0, 0, Math.PI * 2);
    pctx.fill();

    // Realistic black rubber rim
    pctx.strokeStyle = "#333";
    pctx.lineWidth = 2.5;
    pctx.stroke();

    // Thin highlight on rim
    pctx.strokeStyle = "rgba(255,255,255,0.3)";
    pctx.lineWidth = 1;
    pctx.stroke();

    // Grip texture / lines
    pctx.strokeStyle = "rgba(255,255,255,0.12)";
    pctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      pctx.beginPath();
      pctx.moveTo(i * 12 - 4, -hR * 0.4);
      pctx.lineTo(i * 12 + 4, hR * 0.4);
      pctx.stroke();
    }

    // Large shine for "premium" look
    pctx.fillStyle = "rgba(255,255,255,0.18)";
    pctx.beginPath();
    pctx.ellipse(-hR * 0.25, -hR * 0.2, hR * 0.4, hR * 0.22, -0.4, 0, Math.PI * 2);
    pctx.fill();

    pctx.restore();
    cacheRef.current = pc;
  }

  ctx.drawImage(cacheRef.current, x - cacheRef.current.width / 2, y - cacheRef.current.height / 2);
}

// ─── Celebratory Fireworks ────────────────────────────────────────────────────
function Fireworks() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let particles = [];
    const colors = ["#ffeb3b", "#ff5722", "#e91e63", "#4caf50", "#2196f3", "#ffffff"];

    const createBurst = () => {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height * 0.5 + canvas.height * 0.2;
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 40; i++) {
        particles.push({
          x, y,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          life: 1,
          decay: 0.015 + Math.random() * 0.01,
          color
        });
      }
    };

    let frame;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (Math.random() < 0.04) createBurst();

      particles.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.08; // gravity
        p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i, 1); return; }

        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.floor(p.life * 255).toString(16).padStart(2, "0");
        ctx.fill();
      });
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} width={CW} height={CH} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }} />;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PingPong() {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const stRef = useRef(null);
  const rafRef = useRef(null);
  const runRef = useRef(false);
  const pointersRef = useRef({});
  const keysRef = useRef({});
  const audioCtx = useRef(null);
  const p1CanvasRef = useRef(null);
  const p2CanvasRef = useRef(null);

  const [gameMode, setGameMode] = useState("1p");
  const gameModeRef = useRef("1p");
  useEffect(() => { gameModeRef.current = gameMode; }, [gameMode]);

  const [scoreP, setScoreP] = useState(0);
  const [scoreC, setScoreC] = useState(0);
  const [phase, setPhase] = useState("idle");
  const [serveBy, setServeBy] = useState("player");
  const [speedPct, setSpeedPct] = useState(20);
  const [rally, setRally] = useState(0);
  const [msg, setMsg] = useState("");

  const pointTmrRef = useRef(null);

  // ── Audio ──────────────────────────────────────────────────────────────────
  const getAudio = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx.current;
  };

  const ping = useCallback((freq = 880) => { try { createPingSound(getAudio(), freq, "ping"); } catch { } }, []);
  const pong = useCallback((freq = 660) => { try { createPingSound(getAudio(), freq, "bounce"); } catch { } }, []);
  const score = useCallback(() => { try { createPingSound(getAudio(), 520, "score"); } catch { } }, []);

  // ── showMsg helper ─────────────────────────────────────────────────────────
  const showMsg = useCallback((text, dur = 1200) => {
    setMsg(text);
    setTimeout(() => setMsg(""), dur);
  }, []);

  // ── State factory ──────────────────────────────────────────────────────────
  const mkSt = (sp, sc, server) => ({
    px: CW / 2, py: TABLE_BOTTOM - 48, pvx: 0, pvy: 0,
    cx: CW / 2, cy: TABLE_TOP + 48, cvx: 0, cvy: 0,
    bx: CW / 2, by: NET_Y, bz: 0,
    bvx: 0, bvy: 0, bvz: 0,
    sp, sc, server,
    servePhase: "countdown",
    serveBounced: false,
    speed: 3.8,
    trail: [],
    bounceRings: [],
    rallyHits: 0,
    aiErrX: 0, aiErrY: 0, aiTimer: 0,
    stimer: 90,
    serving: true,
  });

  // ── Draw ───────────────────────────────────────────────────────────────────
  const draw = useCallback((s) => {
    const c = canvasRef.current; if (!c) return;
    if (!ctxRef.current) ctxRef.current = c.getContext("2d", { alpha: true, desynchronized: true });
    const ctx = ctxRef.current;

    drawTable(ctx);
    drawBounceRings(ctx, s.bounceRings);
    drawBall(ctx, s.bx, s.by, s.bz, s.trail);
    drawPaddle(ctx, s.px, s.py, true, p1CanvasRef);
    drawPaddle(ctx, s.cx, s.cy, false, p2CanvasRef);

    if (s.serving) {
      const p1Label = gameModeRef.current === "2p" ? "P1 SERVE" : "YOUR SERVE";
      const p2Label = gameModeRef.current === "2p" ? "P2 SERVE" : "CPU SERVE";
      const who = s.server === "player" ? p1Label : p2Label;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "bold 14px 'Georgia', serif";
      ctx.textAlign = "center";
      ctx.fillText(who, CW / 2, NET_Y + (s.server === "player" ? 36 : -24));
    }
  }, []);

  useEffect(() => {
    stRef.current = mkSt(0, 0, "player");
    draw(stRef.current);
  }, [draw]);

  useEffect(() => {
    const dn = e => keysRef.current[e.key] = true;
    const up = e => keysRef.current[e.key] = false;
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);

  const onPointerEvent = useCallback(e => {
    const r = canvasRef.current?.getBoundingClientRect(); if (!r) return;
    const x = (e.clientX - r.left) * (CW / r.width);
    const y = (e.clientY - r.top) * (CH / r.height);
    if (e.type === "pointerup" || e.type === "pointercancel" || e.type === "pointerout") {
      delete pointersRef.current[e.pointerId];
    } else {
      pointersRef.current[e.pointerId] = { x, y };
    }
  }, []);

  const startGame = useCallback((initSp, initSc, server) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    runRef.current = true;
    const s = mkSt(initSp, initSc, server);
    stRef.current = s;
    setPhase("playing");
    setServeBy(server);
    setRally(0);
    pointersRef.current = {};

    const launchServe = () => {
      if (s.server === "player") {
        s.bx = s.px; s.by = s.py;
        s.bvx = (s.px - CW / 2) * 0.04 + (Math.random() - 0.5) * 1.5;
        s.bvy = -4.5; s.bvz = 5.5; s.bz = 18;
      } else {
        s.bx = s.cx; s.by = s.cy;
        s.bvx = (s.cx - CW / 2) * 0.04 + (Math.random() - 0.5) * 1.5;
        s.bvy = 4.5; s.bvz = 5.5; s.bz = 18;
      }
      s.servePhase = "inAir";
      s.serveBounced = false;
      s.serving = false;
      ping(400);
      s.pBounced = false;
      s.cBounced = false;
    };

    const awardPoint = (winner, reason) => {
      if (!runRef.current) return;
      runRef.current = false;
      if (pointTmrRef.current) clearTimeout(pointTmrRef.current);

      score();
      if (winner === "player") { s.sp++; setScoreP(s.sp); }
      else { s.sc++; setScoreC(s.sc); }

      draw(s);
      const p1WinMsg = gameModeRef.current === "2p" ? "P1 POINT!" : "POINT!";
      const p2WinMsg = gameModeRef.current === "2p" ? "P2 POINT!" : "CPU POINT!";
      showMsg(winner === "player" ? `${p1WinMsg} ${reason}` : `${p2WinMsg} ${reason}`, 1300);

      if (s.sp >= WIN_SCORE) { setTimeout(() => setPhase("won"), 1000); return; }
      if (s.sc >= WIN_SCORE) { setTimeout(() => setPhase("lost"), 1000); return; }

      const total = s.sp + s.sc;
      const nextServer = (s.sp >= 10 && s.sc >= 10) ? (winner === "player" ? "player" : "cpu") : (Math.floor(total / 2) % 2 === 0 ? "player" : "cpu");
      pointTmrRef.current = setTimeout(() => { startGame(s.sp, s.sc, nextServer); }, 1500);
    };

    const loop = () => {
      if (!runRef.current) return;
      const s = stRef.current;
      const k = keysRef.current;

      let p1Pointer = null, p2Pointer = null;
      const ids = Object.keys(pointersRef.current);
      for (let i = 0; i < ids.length; i++) {
        const pt = pointersRef.current[ids[i]];
        if (pt.y > NET_Y) p1Pointer = pt; else p2Pointer = pt;
      }
      if (gameModeRef.current === "1p" && ids.length > 0) p1Pointer = pointersRef.current[ids[0]];

      if (s.serving) {
        s.stimer--;
        if (s.server === "player") { s.bx = s.px; s.by = s.py; } else { s.bx = s.cx; s.by = s.cy; }
        s.bz = 0;
        if (s.stimer <= 0) launchServe();
        if (p1Pointer) {
          s.px += (clamp(p1Pointer.x, TABLE_L + hR + 2, TABLE_R - hR - 2) - s.px) * 0.35;
          s.py += (clamp(p1Pointer.y, TABLE_BOTTOM - 60, TABLE_BOTTOM - PAD_H - 2) - s.py) * 0.35;
        }
        draw(s);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const ks = 7;
      const ppx = s.px, ppy = s.py;
      const usingKeysP1 = gameModeRef.current === "1p" ? (k.ArrowLeft || k.ArrowRight || k.ArrowUp || k.ArrowDown || k.a || k.d || k.w || k.s) : (k.a || k.d || k.w || k.s);
      if (gameModeRef.current === "1p") {
        if (k.ArrowLeft || k.a) s.px -= ks; if (k.ArrowRight || k.d) s.px += ks; if (k.ArrowUp || k.w) s.py -= ks; if (k.ArrowDown || k.s) s.py += ks;
      } else {
        if (k.a) s.px -= ks; if (k.d) s.px += ks; if (k.w) s.py -= ks; if (k.s) s.py += ks;
      }
      if (!usingKeysP1 && p1Pointer) {
        s.px += (clamp(p1Pointer.x, TABLE_L + hR + 2, TABLE_R - hR - 2) - s.px) * 0.65;
        s.py += (clamp(p1Pointer.y, NET_Y + PAD_H + 2, TABLE_BOTTOM - PAD_H - 2) - s.py) * 0.65;
      }
      s.px = clamp(s.px, TABLE_L + hR + 2, TABLE_R - hR - 2);
      s.py = clamp(s.py, NET_Y + PAD_H + 2, TABLE_BOTTOM - PAD_H - 2);
      s.pvx = s.px - ppx; s.pvy = s.py - ppy;

      const prevCX = s.cx, prevCY = s.cy;
      if (gameModeRef.current === "2p") {
        const usingKeysP2 = k.ArrowLeft || k.ArrowRight || k.ArrowUp || k.ArrowDown;
        if (k.ArrowLeft) s.cx -= ks; if (k.ArrowRight) s.cx += ks; if (k.ArrowUp) s.cy -= ks; if (k.ArrowDown) s.cy += ks;
        if (!usingKeysP2 && p2Pointer) {
          s.cx += (clamp(p2Pointer.x, TABLE_L + hR + 2, TABLE_R - hR - 2) - s.cx) * 0.65;
          s.cy += (clamp(p2Pointer.y, TABLE_TOP + PAD_H + 2, NET_Y - PAD_H - 2) - s.cy) * 0.65;
        }
      } else {
        s.aiTimer--;
        if (s.aiTimer <= 0) {
          const d = Math.min(s.speed / 14, 1);
          s.aiErrX = (Math.random() - 0.5) * 20 * (1 - d * 0.45);
          s.aiTimer = 12 + Math.random() * 15;
        }
        const tr = 0.05 + Math.min(s.speed, 14) * 0.005;
        s.cx += (clamp(s.bx + s.aiErrX, TABLE_L + hR + 2, TABLE_R - hR - 2) - s.cx) * tr * 5;
        const aiTgtY = s.bvy < 0 ? clamp((s.by - s.bz) * 0.5 + (TABLE_TOP + 40) * 0.5, TABLE_TOP + PAD_H + 2, NET_Y - PAD_H - 2) : TABLE_TOP + 48;
        s.cy += (aiTgtY - s.cy) * tr * 3;
      }
      s.cx = clamp(s.cx, TABLE_L + hR + 2, TABLE_R - hR - 2);
      s.cy = clamp(s.cy, TABLE_TOP + PAD_H + 2, NET_Y - PAD_H - 2);
      s.cvx = s.cx - prevCX; s.cvy = s.cy - prevCY;

      s.trail.push(s.bx, s.by - s.bz);
      if (s.trail.length > 28) { s.trail.shift(); s.trail.shift(); }
      for (let i = s.bounceRings.length - 1; i >= 0; i--) {
        s.bounceRings[i].life--; if (s.bounceRings[i].life <= 0) s.bounceRings.splice(i, 1);
      }

      s.bvz -= GRAVITY; s.bz += s.bvz; s.bx += s.bvx; s.by += s.bvy;
      if (s.bx < TABLE_L + BALL_R) { s.bx = TABLE_L + BALL_R; s.bvx = Math.abs(s.bvx) * 0.92; }
      if (s.bx > TABLE_R - BALL_R) { s.bx = TABLE_R - BALL_R; s.bvx = -Math.abs(s.bvx) * 0.92; }

      if (s.bz <= 0 && s.bvz < 0) {
        s.bz = 0;
        if (s.bx > TABLE_L && s.bx < TABLE_R && s.by > TABLE_TOP && s.by < TABLE_BOTTOM) {
          s.bvz = -s.bvz * 0.72; s.bvx *= 0.95; s.bvy *= 0.95;
          s.bounceRings.push({ x: s.bx, y: s.by, life: 28, maxLife: 28 });
          const onP = s.by > NET_Y;
          pong(onP ? 520 : 420);
          if (s.servePhase === "inAir" && !s.serveBounced) {
            if ((s.server === "player" && onP) || (s.server === "cpu" && !onP)) {
              s.serveBounced = true; s.pBounced = onP; s.cBounced = !onP;
              const spd = s.speed;
              s.bvy = (onP ? -1 : 1) * (spd * 0.95 + Math.random() * 0.4);
              s.bvz = spd * 1.1 + Math.random() * 0.2;
            } else { awardPoint(s.server === "player" ? "cpu" : "player", "Wrong serve side!"); return; }
          } else { if (onP) s.pBounced = true; else s.cBounced = true; if (s.servePhase === "inAir") s.servePhase = "live"; }
        } else { awardPoint(s.by > NET_Y ? "player" : "cpu", "Out of bounds!"); return; }
      }

      const netY = s.by - s.bz;
      if (netY > NET_Y - NET_H - 8 && netY < NET_Y + NET_H + 8 && Math.abs(s.by - NET_Y) < 30 && s.bz < NET_H + 8) {
        if (s.bz < NET_H - 1) {
          s.bvy = -s.bvy * 0.3; s.bvz = Math.abs(s.bvz) * 0.35; s.bz = NET_H - 1; pong(300);
          if (s.servePhase !== "countdown") { awardPoint(s.bvy > 0 ? "cpu" : "player", "Hit the net!"); return; }
        }
      }

      const PADDLE_Z = hR * 1.8;
      const visualBy = s.by - s.bz;
      const pdx = s.bx - s.px, pdy = visualBy - s.py, pDist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pDist < hR * 1.25 && s.bz < PADDLE_Z && s.bvy > 0 && s.by < TABLE_BOTTOM && (s.pBounced || s.by > NET_Y)) {
        s.bvx = (pdx / pDist) * s.speed * 0.95 + s.pvx * 0.6;
        s.bvy = -(s.speed * 0.95 + Math.random() * 0.3) + Math.min(0, s.pvy * 0.6);
        s.bvz = s.speed * 1.1 + Math.abs(s.pvy) * 0.25;
        s.bz = PADDLE_Z + 2; s.pBounced = false; s.speed = Math.min(16, s.speed + 0.18);
        s.rallyHits++; setRally(s.rallyHits); setSpeedPct(Math.round((s.speed / 16) * 100));
        ping(820 + s.rallyHits * 18); s.bounceRings.push({ x: s.bx, y: s.by, life: 22, maxLife: 22 });
        s.servePhase = "live";
      }

      const cdx = s.bx - s.cx, cdy = visualBy - s.cy, cDist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (cDist < hR * 1.2 && s.bz < PADDLE_Z && s.bvy < 0 && s.by > TABLE_TOP && (s.cBounced || s.by < NET_Y)) {
        s.bvx = (cdx / cDist) * s.speed * 0.95 + s.cvx * 0.6;
        s.bvy = (s.speed * 0.95 + Math.random() * 0.3) + Math.max(0, s.cvy * 0.6);
        s.bvz = s.speed * 1.2 + Math.abs(s.cvy) * 0.25;
        s.bz = PADDLE_Z + 2; s.cBounced = false; s.speed = Math.min(16, s.speed + 0.18);
        s.rallyHits++; setRally(s.rallyHits); setSpeedPct(Math.round((s.speed / 16) * 100));
        ping(680 + s.rallyHits * 14); s.bounceRings.push({ x: s.bx, y: s.by, life: 22, maxLife: 22 });
        s.servePhase = "live";
      }

      if (s.by > TABLE_BOTTOM + 15) { awardPoint("cpu", "Ball out!"); return; }
      if (s.by < TABLE_TOP - 15) { awardPoint("player", "Ball out!"); return; }

      draw(s);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [draw, ping, pong, score, showMsg]);

  useEffect(() => {
    if (phase !== "playing") {
      runRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  }, [phase]);

  const showOverlay = phase === "idle" || phase === "won" || phase === "lost";

  return (
    <div style={{
      width: "100vw", height: "100dvh", overflow: "hidden",
      position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Georgia, serif", color: "#fff",
      background: `
        radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.85) 100%),
        repeating-linear-gradient(90deg, #c19a6b 0px, #c19a6b 40px, #ab865a 40px, #ab865a 42px)
      `,
      boxShadow: "inset 0 0 100px rgba(0,0,0,0.9)",
    }}>
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
        .game-canvas-wrapper {
           animation: fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1);
           position: relative;
           display: flex; align-items: center; justify-content: center;
        }
        @media (max-width: 600px) {
          .mobile-hud {
            top: 0.5dvh !important;
            left: 1vw !important;
            right: 1vw !important;
          }
          .mobile-hud-label {
            font-size: 8px !important;
            opacity: 0.6;
          }
          .mobile-hud-score {
            font-size: 45px !important;
            margin-top: -12px;
          }
          .game-canvas-wrapper canvas {
            width: min(92vw, 100dvh * (520 / 720)) !important;
            height: auto !important; /* height scales proportionally */
            aspect-ratio: 520 / 720;
          }
        }
      `}</style>

      {phase !== "idle" && !showOverlay && (
        <div className="mobile-hud" style={{
          position: "absolute", top: "4dvh", left: "6vw", right: "6vw",
          display: "flex", justifyContent: "space-between", pointerEvents: "none", zIndex: 11
        }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="mobile-hud-label" style={{ fontSize: "min(3vw, 22px)", color: "rgba(255,255,255,0.4)", fontWeight: "bold", letterSpacing: 2 }}>{gameMode === "2p" ? "PLAYER 1" : "YOU"}</div>
            <div className="mobile-hud-score" style={{ fontSize: "min(12vw, 90px)", fontWeight: "900", color: "rgba(255,255,255,0.25)", fontFamily: "monospace", lineHeight: 0.9 }}>{scoreP}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="mobile-hud-label" style={{ fontSize: "min(3vw, 22px)", color: "rgba(255,255,255,0.4)", fontWeight: "bold", letterSpacing: 2 }}>{gameMode === "2p" ? "PLAYER 2" : "CPU"}</div>
            <div className="mobile-hud-score" style={{ fontSize: "min(12vw, 90px)", fontWeight: "900", color: "rgba(255,255,255,0.25)", fontFamily: "monospace", lineHeight: 0.9 }}>{scoreC}</div>
          </div>
        </div>
      )}

      <div className="game-canvas-wrapper">
        <canvas
          ref={canvasRef} width={CW} height={CH}
          style={{
            display: "block",
            width: "min(100vw, 100dvh * (520 / 720))",
            height: "min(100dvh, 100vw * (720 / 520))",
            touchAction: "none", cursor: "crosshair",
            boxShadow: "0 0 100px rgba(0,0,0,0.5)"
          }}
          onPointerMove={onPointerEvent} onPointerDown={onPointerEvent} onPointerUp={onPointerEvent}
          onPointerCancel={onPointerEvent} onPointerOut={onPointerEvent}
          onClick={() => { if (stRef.current?.serving && stRef.current.server === "player") stRef.current.stimer = 0; }}
        />

        {msg && (
          <div style={{
            position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)",
            display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 15
          }}>
            <div style={{
              background: "rgba(30,10,5,0.9)",
              color: msg.startsWith("POINT") ? "#4caf50" : msg.startsWith("CPU") ? "#f44336" : "#ffeb3b",
              padding: "16px 48px", borderRadius: 14, fontSize: 16, fontWeight: "bold", letterSpacing: 2,
              border: `2px solid ${msg.startsWith("POINT") ? "#4caf50" : msg.startsWith("CPU") ? "#f44336" : "#ffeb3b"}`,
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)", whiteSpace: "nowrap", textAlign: "center"
            }}>{msg}</div>
          </div>
        )}

        {showOverlay && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, zIndex: 20,
          }}>
            {phase === "idle" && (
              <>
                <h1 style={{ fontSize: 10, color: "#a0724a", letterSpacing: 6, margin: 0 }}>TABLE TENNIS</h1>
                <h2 style={{ fontSize: 20, fontWeight: "bold", color: "#d4a96a", letterSpacing: 5, margin: "4px 0" }}>PING PONG</h2>
                <div style={{ display: "flex", gap: 15, marginTop: 12 }}>
                  <button onClick={() => { setGameMode("1p"); startGame(0, 0, "player"); }} style={btnStyle}>1 PLAYER</button>
                  <button onClick={() => { setGameMode("2p"); startGame(0, 0, "player"); }} style={btnStyle}>2 PLAYERS</button>
                </div>
              </>
            )}
            {(phase === "won" || phase === "lost") && (
              <>
                {phase === "won" && <Fireworks />}
                <div style={resultBoxStyle}>
                  <div style={{ fontSize: 11, color: "#d4a96a", letterSpacing: 8, textTransform: "uppercase", opacity: 0.8 }}>Match Result</div>
                  <div style={{
                    fontSize: 48, fontWeight: "900", letterSpacing: 6,
                    background: phase === "won" ? "linear-gradient(180deg, #4caf50, #81c784)" : "linear-gradient(180deg, #f44336, #e57373)",
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    textShadow: "0 10px 20px rgba(0,0,0,0.3)",
                  }}>{phase === "won" ? "VICTORY!" : "DEFEAT!"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 30, padding: "10px 0" }}>
                    <ScoreDisplay label={gameMode === "2p" ? "P1" : "YOU"} score={scoreP} color="#f44336" />
                    <div style={{ fontSize: 24, color: "#d4a96a", opacity: 0.5, marginTop: 15 }}>—</div>
                    <ScoreDisplay label={gameMode === "2p" ? "P2" : "CPU"} score={scoreC} color="#1e88e5" />
                  </div>
                  <button onClick={() => { setScoreP(0); setScoreC(0); setRally(0); setSpeedPct(20); startGame(0, 0, "player"); }} style={actionBtnStyle}>PLAY AGAIN</button>
                  <button onClick={() => { setPhase("idle"); setScoreP(0); setScoreC(0); setRally(0); }} style={outlineBtnStyle}>BACK TO MENU</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle = {
  background: "#d4a96a", color: "#3e2723", border: "none", borderRadius: 8, padding: "10px 20px",
  fontSize: 18, fontWeight: "bold", cursor: "pointer", fontFamily: "Georgia, serif", letterSpacing: 2,
  boxShadow: "0 4px 0 #5d3a1a", minWidth: 140, transition: "all 0.1s",
};

const resultBoxStyle = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 15, zIndex: 30, textAlign: "center",
  background: "#2d1b0d", padding: "40px 30px", borderRadius: 16, border: "4px solid #d4a96a",
  boxShadow: "0 20px 60px rgba(0,0,0,0.8), inset 0 0 30px rgba(212,169,106,0.1)",
};

const actionBtnStyle = {
  marginTop: 15, background: "linear-gradient(180deg, #d4a96a, #a0724a)", color: "#3e2723",
  border: "none", borderRadius: 12, padding: "16px 64px", fontSize: 18, fontWeight: "bold", cursor: "pointer",
  fontFamily: "Georgia, serif", letterSpacing: 4, boxShadow: "0 6px 0 #5d3a1a, 0 12px 24px rgba(0,0,0,0.4)",
  width: "100%",
};

const outlineBtnStyle = {
  marginTop: 10, background: "transparent", color: "#d4a96a", border: "1.5px solid #d4a96a", borderRadius: 10,
  padding: "10px 32px", fontSize: 12, fontWeight: "bold", cursor: "pointer", fontFamily: "Georgia, serif",
  letterSpacing: 3, opacity: 0.7,
};

const ScoreDisplay = ({ label, score, color }) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    <span style={{ fontSize: 9, color: "#d4a96a", marginBottom: 4 }}>{label}</span>
    <span style={{ fontSize: 42, fontWeight: "bold", color, fontFamily: "monospace", lineHeight: 1 }}>{score}</span>
  </div>
);