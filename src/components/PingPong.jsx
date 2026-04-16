// Pre-import React.memo if needed, or just use React.memo since React is in scope
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
const TABLE_BOTTOM = CH - WALL - 6;      // bottom edge (player side)
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
  // Wood outer frame
  ctx.fillStyle = "#8B5E3C";
  ctx.fillRect(0, 0, CW, CH);
  for (let y = 0; y < CH; y += 28) {
    ctx.fillStyle = "rgba(255,220,160,0.055)";
    ctx.fillRect(0, y, CW, 14);
  }

  // Table surface
  ctx.fillStyle = "#c8915a";
  ctx.fillRect(TABLE_L, TABLE_TOP, TABLE_R - TABLE_L, TABLE_BOTTOM - TABLE_TOP);
  for (let y = TABLE_TOP; y < TABLE_BOTTOM; y += 24) {
    ctx.fillStyle = "rgba(255,230,170,0.055)";
    ctx.fillRect(TABLE_L, y, TABLE_R - TABLE_L, 12);
  }

  // Inner white border line
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(TABLE_L + 3, TABLE_TOP + 3, (TABLE_R - TABLE_L) - 6, (TABLE_BOTTOM - TABLE_TOP) - 6);

  // Outer wood frame stroke
  ctx.strokeStyle = "#5d3a1a";
  ctx.lineWidth = WALL;
  ctx.strokeRect(WALL / 2, WALL / 2, CW - WALL, CH - WALL);

  // Center vertical dashed line
  ctx.setLineDash([5, 9]);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CW / 2, TABLE_TOP + 4);
  ctx.lineTo(CW / 2, TABLE_BOTTOM - 4);
  ctx.stroke();
  ctx.setLineDash([]);

  // Net posts
  ctx.fillStyle = "#8d6e63";
  ctx.fillRect(TABLE_L - 4, NET_Y - NET_H - 6, 6, NET_H * 2 + 12);
  ctx.fillRect(TABLE_R - 2, NET_Y - NET_H - 6, 6, NET_H * 2 + 12);

  // Net body
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillRect(TABLE_L, NET_Y - NET_H / 2, TABLE_R - TABLE_L, NET_H);
  for (let x = TABLE_L + 2; x < TABLE_R; x += 10) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x, NET_Y - NET_H / 2, 5, NET_H);
  }

  // Net top highlight
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillRect(TABLE_L, NET_Y - NET_H / 2 - 1, TABLE_R - TABLE_L, 2);
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
  // Visual y position: ball appears ABOVE its table position when in the air
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
  // Classic Off-white but with high-visibility glow
  ctx.fillStyle = "#f8f4ee";
  // Removed expensive shadowBlur for better mobile performance
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Specular highlight
  ctx.beginPath();
  ctx.arc(bx - BALL_R * 0.28, vy - BALL_R * 0.3, BALL_R * 0.33, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fill();

  // Seam line for spin feel
  ctx.beginPath();
  ctx.arc(bx, vy, BALL_R - 1, 0.4, 2.7);
  ctx.strokeStyle = "rgba(200,188,174,0.38)";
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
    pc.width = PAD_W + 10;
    pc.height = PAD_W + 30;
    const pctx = pc.getContext("2d");
    const color = isPlayer ? "#d32f2f" : "#1565c0";
    const cx = (PAD_W + 10) / 2;
    const cy = isPlayer ? (PAD_W + 30) - 25 : 25;
    const handleY = isPlayer ? 5 : -22;
    const padY = isPlayer ? -hR * 0.65 : hR * 0.65;

    pctx.save();
    pctx.translate(cx, cy);
    // Handle
    pctx.fillStyle = "#6d4c41";
    pctx.beginPath();
    if (pctx.roundRect) pctx.roundRect(-3.5, handleY, 7, 20, 2);
    else pctx.rect(-3.5, handleY, 7, 20);
    pctx.fill();
    // Paddle face
    pctx.fillStyle = color;
    pctx.beginPath();
    pctx.ellipse(0, padY, hR, hR * 0.7, 0, 0, Math.PI * 2);
    pctx.fill();
    // Grip lines
    pctx.strokeStyle = "rgba(0,0,0,0.18)";
    pctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      pctx.beginPath();
      pctx.moveTo(i * 10 - 6, padY - hR * 0.55);
      pctx.lineTo(i * 10 + 6, padY + hR * 0.55);
      pctx.stroke();
    }
    // Rim
    pctx.strokeStyle = "rgba(255,255,255,0.22)";
    pctx.lineWidth = 1.5;
    pctx.beginPath();
    pctx.ellipse(0, padY, hR, hR * 0.7, 0, 0, Math.PI * 2);
    pctx.stroke();
    // Shine
    pctx.fillStyle = "rgba(255,255,255,0.18)";
    pctx.beginPath();
    pctx.ellipse(-hR * 0.25, padY - hR * 0.22, hR * 0.3, hR * 0.16, -0.3, 0, Math.PI * 2);
    pctx.fill();
    pctx.restore();
    cacheRef.current = pc;
  }
  const cyOffset = isPlayer ? 25 : -25;
  ctx.drawImage(cacheRef.current, x - (PAD_W + 10) / 2, y - (cacheRef.current.height / 2) + cyOffset);
}

// ─── Pips row ─────────────────────────────────────────────────────────────────
const Pips = React.memo(({ filled, color }) => {
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 4, flexWrap: "wrap", maxWidth: 120 }}>
      {Array.from({ length: WIN_SCORE }).map((_, i) => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%",
          background: i < filled ? color : "rgba(0,0,0,0.13)",
          boxShadow: i < filled ? `0 0 5px ${color}99` : "none",
          transition: "all 0.3s",
        }} />
      ))}
    </div>
  );
});

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
  const tableCanvasRef = useRef(null); // Offscreen canvas for table
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

  // ── State factory ──────────────────────────────────────────────────────────
  const mkSt = (sp, sc, server) => ({
    // Paddle positions (on the canvas, Y axis)
    px: CW / 2, py: TABLE_BOTTOM - 48, pvx: 0, pvy: 0,
    cx: CW / 2, cy: TABLE_TOP + 48, cvx: 0, cvy: 0,

    // Ball: bx/by = 2D canvas pos (where shadow is), bz = height above table
    // bvx/bvy = horizontal velocity, bvz = vertical velocity (up/down through air)
    bx: CW / 2, by: NET_Y, bz: 0,
    bvx: 0, bvy: 0, bvz: 0,

    // Serve info
    sp, sc, server,
    // servePhase: "countdown" → "inAir" → "live"
    servePhase: "countdown",
    serveBounced: false, // did the ball bounce on server's own side yet?

    speed: 3.8,
    trail: [],
    bounceRings: [],
    rallyHits: 0,

    aiErrX: 0, aiErrY: 0, aiTimer: 0,

    // countdown before serve
    stimer: 90,
    serving: true,
  });

  // ── Draw ───────────────────────────────────────────────────────────────────
  const draw = useCallback((s) => {
    const c = canvasRef.current; if (!c) return;
    if (!ctxRef.current) {
      ctxRef.current = c.getContext("2d", { alpha: false, desynchronized: true });
    }
    const ctx = ctxRef.current;

    // Initialize offscreen table if not already done
    if (!tableCanvasRef.current) {
      const tc = document.createElement("canvas");
      tc.width = CW; tc.height = CH;
      drawTable(tc.getContext("2d"));
      tableCanvasRef.current = tc;
    }
    ctx.drawImage(tableCanvasRef.current, 0, 0);

    drawBounceRings(ctx, s.bounceRings);
    drawBall(ctx, s.bx, s.by, s.bz, s.trail);
    drawPaddle(ctx, s.px, s.py, true, p1CanvasRef);
    drawPaddle(ctx, s.cx, s.cy, false, p2CanvasRef);

    // Serve countdown label
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

  // ── Input listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const dn = e => {
      keysRef.current[e.key] = true;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) e.preventDefault();
    };
    const up = e => { keysRef.current[e.key] = false; };
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

  // ── showMsg helper ─────────────────────────────────────────────────────────
  const showMsg = useCallback((text, dur = 1200) => {
    setMsg(text);
    setTimeout(() => setMsg(""), dur);
  }, []);

  // ── Main game ──────────────────────────────────────────────────────────────
  const startGame = useCallback((initSp, initSc, server) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    runRef.current = true;
    const s = mkSt(initSp, initSc, server);
    stRef.current = s;
    setPhase("playing");
    setServeBy(server);
    setRally(0);
    pointersRef.current = {};

    // ── Launch serve: ball arcs from server paddle to own side, bounces, then crosses net ──
    const launchServe = () => {
      if (s.server === "player") {
        // Player serves: ball starts at player paddle, arcs UP (negative bvy)
        // toward player's own side (bottom half), bounces, then crosses net toward CPU
        s.bx = s.px; s.by = s.py;
        s.bvx = (Math.random() - 0.5) * 3;
        s.bvy = -(s.speed * 0.7);  // moves toward net (up screen)
        s.bvz = s.speed * 1.1;     // launches into the air
        s.bz = 0;
      } else {
        // CPU serves downward toward its own side (top half)
        s.bx = s.cx; s.by = s.cy;
        s.bvx = (Math.random() - 0.5) * 3;
        s.bvy = s.speed * 0.7;     // moves toward net (down screen)
        s.bvz = s.speed * 1.1;
        s.bz = 0;
      }
      s.servePhase = "inAir";
      s.serveBounced = false;
      s.serving = false;
      s.trail = [];
    };

    let pointTmr = null;

    const awardPoint = (winner, reason) => {
      if (!runRef.current) return;
      runRef.current = false;
      if (pointTmr) clearTimeout(pointTmr);

      score();
      if (winner === "player") { s.sp++; setScoreP(s.sp); }
      else { s.sc++; setScoreC(s.sc); }

      draw(s);
      const p1WinMsg = gameModeRef.current === "2p" ? "P1 POINT!" : "POINT!";
      const p2WinMsg = gameModeRef.current === "2p" ? "P2 POINT!" : "CPU POINT!";
      showMsg(winner === "player" ? `${p1WinMsg} ${reason}` : `${p2WinMsg} ${reason}`, 1300);

      const wonGame = s.sp >= WIN_SCORE;
      const lostGame = s.sc >= WIN_SCORE;
      if (wonGame) { setTimeout(() => setPhase("won"), 1000); return; }
      if (lostGame) { setTimeout(() => setPhase("lost"), 1000); return; }

      const total = s.sp + s.sc;
      const nextServer = (s.sp >= 10 && s.sc >= 10)
        ? (winner === "player" ? "player" : "cpu")
        : (Math.floor(total / 2) % 2 === 0 ? "player" : "cpu");

      pointTmr = setTimeout(() => {
        startGame(s.sp, s.sc, nextServer);
      }, 1500);
    };

    const loop = () => {
      if (!runRef.current) return;
      const s = stRef.current;
      const k = keysRef.current;

      // Determine pointers
      let p1Pointer = null;
      let p2Pointer = null;
      const ids = Object.keys(pointersRef.current);
      for (let i = 0; i < ids.length; i++) {
        const pt = pointersRef.current[ids[i]];
        if (pt.y > NET_Y) p1Pointer = pt;
        else p2Pointer = pt;
      }
      if (gameModeRef.current === "1p" && ids.length > 0) {
        p1Pointer = pointersRef.current[ids[0]];
      }

      // ── Serve countdown ──────────────────────────────────────────────────
      if (s.serving) {
        s.stimer--;
        // Ball MUST follow paddle during serve so it's not 'missing'
        if (s.server === "player") { s.bx = s.px; s.by = s.py; }
        else { s.bx = s.cx; s.by = s.cy; }
        s.bz = 0;

        if (s.stimer <= 0) launchServe();

        // Paddles follow pointers during countdown
        if (p1Pointer) {
          s.px += (clamp(p1Pointer.x, TABLE_L + 8 + hR, TABLE_R - 8 - hR) - s.px) * 0.35;
          s.py += (clamp(p1Pointer.y, NET_Y + PAD_H + 6, TABLE_BOTTOM - 8 - PAD_H) - s.py) * 0.35;
        }
        if (gameModeRef.current === "2p" && p2Pointer) {
          s.cx += (clamp(p2Pointer.x, TABLE_L + 8 + hR, TABLE_R - 8 - hR) - s.cx) * 0.35;
          s.cy += (clamp(p2Pointer.y, TABLE_TOP + 8 + PAD_H, NET_Y - PAD_H - 6) - s.cy) * 0.35;
        }

        draw(s);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // ── Player 1 paddle movement ───────────────────────────────────────────
      const ks = 7;
      const ppx = s.px, ppy = s.py;
      const usingKeysP1 = gameModeRef.current === "1p"
        ? (k.ArrowLeft || k.ArrowRight || k.ArrowUp || k.ArrowDown || k.a || k.d || k.w || k.s)
        : (k.a || k.d || k.w || k.s);

      if (gameModeRef.current === "1p") {
        if (k.ArrowLeft || k.a) s.px -= ks;
        if (k.ArrowRight || k.d) s.px += ks;
        if (k.ArrowUp || k.w) s.py -= ks;
        if (k.ArrowDown || k.s) s.py += ks;
      } else {
        if (k.a) s.px -= ks;
        if (k.d) s.px += ks;
        if (k.w) s.py -= ks;
        if (k.s) s.py += ks;
      }

      if (!usingKeysP1 && p1Pointer) {
        s.px += (clamp(p1Pointer.x, TABLE_L + 8 + hR, TABLE_R - 8 - hR) - s.px) * 0.65;
        s.py += (clamp(p1Pointer.y, NET_Y + PAD_H + 6, TABLE_BOTTOM - 8 - PAD_H) - s.py) * 0.65;
      }
      s.px = clamp(s.px, TABLE_L + 8 + hR, TABLE_R - 8 - hR);
      s.py = clamp(s.py, NET_Y + PAD_H + 6, TABLE_BOTTOM - 8 - PAD_H);
      s.pvx = s.px - ppx; s.pvy = s.py - ppy;

      // ── AI or Player 2 movement ──────────────────────────────────────────────
      const prevCX = s.cx;
      const prevCY = s.cy;

      if (gameModeRef.current === "2p") {
        const usingKeysP2 = k.ArrowLeft || k.ArrowRight || k.ArrowUp || k.ArrowDown;
        if (k.ArrowLeft) s.cx -= ks;
        if (k.ArrowRight) s.cx += ks;
        if (k.ArrowUp) s.cy -= ks;
        if (k.ArrowDown) s.cy += ks;
        if (!usingKeysP2 && p2Pointer) {
          s.cx += (clamp(p2Pointer.x, TABLE_L + 8 + hR, TABLE_R - 8 - hR) - s.cx) * 0.65;
          s.cy += (clamp(p2Pointer.y, TABLE_TOP + 8 + PAD_H, NET_Y - PAD_H - 6) - s.cy) * 0.65;
        }
        s.cx = clamp(s.cx, TABLE_L + 8 + hR, TABLE_R - 8 - hR);
        s.cy = clamp(s.cy, TABLE_TOP + 8 + PAD_H, NET_Y - PAD_H - 6);
      } else {
        s.aiTimer--;
        if (s.aiTimer <= 0) {
          const d = Math.min(s.speed / 14, 1);
          s.aiErrX = (Math.random() - 0.5) * 20 * (1 - d * 0.45);
          s.aiTimer = 12 + Math.random() * 15;
        }
        const tr = 0.05 + Math.min(s.speed, 14) * 0.005;
        const aiTgtX = clamp(s.bx + s.aiErrX, TABLE_L + 8 + hR, TABLE_R - 8 - hR);
        const visualY = s.by - s.bz;
        const aiTgtY = s.bvy < 0
          ? clamp(visualY * 0.5 + (TABLE_TOP + 40) * 0.5, TABLE_TOP + 8 + PAD_H, NET_Y - PAD_H - 10)
          : TABLE_TOP + 48;
        s.cx += (aiTgtX - s.cx) * tr * 5;
        s.cy += (aiTgtY - s.cy) * tr * 3;
        s.cx = clamp(s.cx, TABLE_L + 8 + hR, TABLE_R - 8 - hR);
        s.cy = clamp(s.cy, TABLE_TOP + 8 + PAD_H, NET_Y - PAD_H - 6);
      }
      s.cvx = s.cx - prevCX;
      s.cvy = s.cy - prevCY;

      // ── Trail ─────────────────────────────────────────────────────────────
      // Visual y = by - bz (ball appears above shadow)
      s.trail.push(s.bx, s.by - s.bz);
      if (s.trail.length > 28) {
        s.trail.shift();
        s.trail.shift();
      }

      // Age bounce rings
      for (let i = s.bounceRings.length - 1; i >= 0; i--) {
        s.bounceRings[i].life--;
        if (s.bounceRings[i].life <= 0) s.bounceRings.splice(i, 1);
      }

      // ── Ball physics (3D-like arc) ────────────────────────────────────────
      // bvz = vertical velocity (height axis), gravity pulls it down
      s.bvz -= GRAVITY;
      s.bz += s.bvz;
      s.bx += s.bvx;
      s.by += s.bvy;

      // Side walls
      if (s.bx < TABLE_L + BALL_R) { s.bx = TABLE_L + BALL_R; s.bvx = Math.abs(s.bvx) * 0.92; }
      if (s.bx > TABLE_R - BALL_R) { s.bx = TABLE_R - BALL_R; s.bvx = -Math.abs(s.bvx) * 0.92; }

      // ── Table bounce (bz hits 0) ──────────────────────────────────────────
      if (s.bz <= 0 && s.bvz < 0) {
        // Ball is on the TABLE SURFACE
        s.bz = 0;
        const speed = Math.hypot(s.bvx, s.bvy, s.bvz);

        // Only bounce if ball is within the table area
        if (s.bx > TABLE_L && s.bx < TABLE_R && s.by > TABLE_TOP && s.by < TABLE_BOTTOM) {
          const bounceDamp = 0.72; // lose some energy per bounce
          s.bvz = -s.bvz * bounceDamp;
          s.bvx *= 0.95;
          s.bvy *= 0.95;

          // Add bounce ring effect
          s.bounceRings.push({ x: s.bx, y: s.by, life: 28, maxLife: 28 });

          // Is this on player's side (bottom half) or CPU's side (top half)?
          const onPlayerSide = s.by > NET_Y;
          const onCPUSide = s.by < NET_Y;

          pong(onPlayerSide ? 520 : 420);

          // Serve bounce rules
          if (s.servePhase === "inAir" && !s.serveBounced) {
            // First bounce must be on server's own side
            if (s.server === "player" && onPlayerSide) {
              s.serveBounced = true;
              // Now reverse direction to send ball toward CPU (over the net)
              // Give it a kick upward to arc over the net
              const spd = s.speed;
              s.bvy = -(spd * 0.95 + Math.random() * 0.4); // going UP toward net
              s.bvx = (s.bvx * 0.5) + (Math.random() - 0.5) * 1.5;
              s.bvz = spd * 1.1 + Math.random() * 0.2;    // arc up into the air
            } else if (s.server === "cpu" && onCPUSide) {
              s.serveBounced = true;
              const spd = s.speed;
              s.bvy = spd * 0.95 + Math.random() * 0.4;    // going DOWN toward net
              s.bvx = (s.bvx * 0.5) + (Math.random() - 0.5) * 1.5;
              s.bvz = spd * 1.1 + Math.random() * 0.2;
            } else if (!s.serveBounced) {
              // Wrong side bounce → fault
              awardPoint(s.server === "player" ? "cpu" : "player", "Wrong serve side!");
              return;
            }
          } else if (s.serveBounced && s.servePhase === "inAir") {
            // Serve ball bounced on opponent's side → serve is live!
            s.servePhase = "live";
          } else if (s.servePhase === "live") {
            // Normal play bounce — the ball bounced; the other player now must hit it back
            // after one bounce (2 bounces on one side = point to opponent)
            // For simplicity in this version, bouncing is just physics — scoring only on miss
          }

          // Stop extremely slow bvz (ball is basically rolling → treat as out of play)
          if (Math.abs(s.bvz) < 0.5 && s.bz < 1) {
            // Ball came to rest on table — whoever's side it's on loses
            if (s.servePhase === "live") {
              const onP = s.by > NET_Y;
              awardPoint(onP ? "cpu" : "player", onP ? "Missed return!" : "CPU missed!");
              return;
            }
          }

        } else {
          // Ball bounced OUTSIDE table — it's out
          if (s.servePhase === "live" || s.serveBounced) {
            const onP = s.by > NET_Y;
            awardPoint(onP ? "player" : "cpu", "Out of bounds!");
            return;
          }
          // Ball went out during serve
          awardPoint(s.server === "player" ? "cpu" : "player", "Serve out of bounds!");
          return;
        }
      }

      // ── Net collision (ball is low and near net) ───────────────────────────
      // Ball visually y = by, check if it's crossing net height at net Y
      const netVisualY = s.by - s.bz;
      if (netVisualY > NET_Y - NET_H - BALL_R && netVisualY < NET_Y + NET_H + BALL_R &&
        Math.abs(s.by - NET_Y) < 30 && s.bz < NET_H + BALL_R) {
        // Hit the net
        if (s.bvz > 0 && s.bz < NET_H + BALL_R + 2) {
          // Ball clears the net only if it's high enough
          // If too low, it hits the net
        }
        if (s.bz < NET_H - 1) {
          // Ball hits net — reverse bvy slightly and lose energy
          s.bvy = -s.bvy * 0.3;
          s.bvz = Math.abs(s.bvz) * 0.35;
          s.bz = NET_H - 1;
          pong(300);
          if (s.servePhase === "live") {
            awardPoint(s.bvy > 0 ? "cpu" : "player", "Hit the net!");
            return;
          } else if (s.serveBounced) {
            awardPoint(s.server === "player" ? "cpu" : "player", "Serve hit net!");
            return;
          }
        }
      }

      // ── Paddle hit (ball must be low / near table surface to be hittable) ──
      const PADDLE_HIT_Z = hR * 1.2; // max z-height to hit paddle
      const PAD_FACE_Y_P = -hR * 0.65; // face offset on player's paddle
      const PAD_FACE_Y_C = hR * 0.65;

      // Player paddle hit: ball coming downward (bvz negative) or near table
      const pdx = s.bx - s.px;
      const pdy = (s.by - s.bz) - (s.py + PAD_FACE_Y_P);
      const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pDist < BALL_R + hR * 0.85 && s.bz < PADDLE_HIT_Z && s.bvy > 0 && s.by < TABLE_BOTTOM) {
        // ── PING! Player hit ──
        const spd = s.speed;
        const nx = pdx / (pDist || 1);
        const ny = pdy / (pDist || 1);

        // Reflect + add player velocity influence
        s.bvx = nx * spd * 0.85 + s.pvx * 0.55;
        s.bvy = -(spd * 1.15 + Math.random() * 0.5); // send toward CPU (upward on screen)
        s.bvz = spd * 1.3 + Math.abs(s.pvy) * 0.25;  // arc into air!
        s.bz = PADDLE_HIT_Z + 2; // pop up off the surface

        s.speed = Math.min(16, s.speed + 0.28);
        s.rallyHits++;
        setRally(s.rallyHits);
        setSpeedPct(Math.round((s.speed / 16) * 100));

        ping(820 + s.rallyHits * 18);
        s.bounceRings.push({ x: s.bx, y: s.by, life: 22, maxLife: 22 });

        if (s.servePhase !== "live") s.servePhase = "live";
      }

      // CPU paddle hit: ball coming upward (bvy negative)
      const cdx = s.bx - s.cx;
      const cdy = (s.by - s.bz) - (s.cy + PAD_FACE_Y_C);
      const cDist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (cDist < BALL_R + hR * 0.85 && s.bz < PADDLE_HIT_Z && s.bvy < 0 && s.by > TABLE_TOP) {
        const spd = s.speed;
        const nx = cdx / (cDist || 1);

        s.bvx = nx * spd * 0.85 + s.cvx * 0.5;
        s.bvy = spd * 1.25 + Math.random() * 0.5;   // send toward player (downward)
        s.bvz = spd * 1.4;
        s.bz = PADDLE_HIT_Z + 2;

        s.speed = Math.min(16, s.speed + 0.28);
        s.rallyHits++;
        setRally(s.rallyHits);
        setSpeedPct(Math.round((s.speed / 16) * 100));

        ping(680 + s.rallyHits * 14);
        s.bounceRings.push({ x: s.bx, y: s.by, life: 22, maxLife: 22 });

        if (s.servePhase !== "live") s.servePhase = "live";
      }

      // ── Ball completely exits the canvas vertically ───────────────────────
      if (s.by > TABLE_BOTTOM + 15) {
        awardPoint("cpu", "Ball out past player!"); return;
      }
      if (s.by < TABLE_TOP - 15) {
        awardPoint("player", "Ball out past CPU!"); return;
      }

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
      width: "100vw", height: "100vh", overflow: "hidden",
      background: "#dec49cff",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "Georgia, serif", color: "#3e2723",
    }}>
      {/* ── Game wrapper ── */}
      <div style={{
        display: "flex", flexDirection: "column",
        width: "min(95vw, calc(90vh * 520 / 800))",
        maxHeight: "100vh",
      }}>
        {/* ── Score bar ── */}
        <div style={{
          background: "rgba(180, 140, 90, 0.4)",
          backdropFilter: "blur(10px)",
          border: "3px solid #5d3a1a", borderBottom: "none",
          borderRadius: "14px 14px 0 0", padding: "9px 20px 7px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ fontSize: 9, color: "#3e2723", fontWeight: "bold", letterSpacing: 2 }}>{gameMode === "2p" ? "P1 (YOU)" : "YOU"}</div>
            <div style={{ fontSize: 30, fontWeight: "bold", color: "#d32f2f", lineHeight: 1, fontFamily: "monospace" }}>{scoreP}</div>
            <Pips filled={scoreP} color="#f44336" />
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, color: "#3e2723", fontWeight: "bold" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: serveBy === "player" ? "#d32f2f" : "#1565c0", boxShadow: `0 0 4px ${serveBy === "player" ? "#d32f2f" : "#1565c0"}` }} />
              <span>{serveBy === "player" ? (gameMode === "2p" ? "P1 SERVE" : "YOUR SERVE") : (gameMode === "2p" ? "P2 SERVE" : "CPU SERVE")}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ fontSize: 7, color: "#5d3a1a", fontWeight: "bold", letterSpacing: 1 }}>SPEED</div>
              <div style={{ width: 66, height: 5, background: "rgba(0,0,0,0.18)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${speedPct}%`, background: "linear-gradient(90deg, #4caf50, #ffeb3b, #f44336)", transition: "width 0.3s" }} />
              </div>
            </div>
            <div style={{ fontSize: 8, color: "#5d3a1a" }}>
              RALLY <span style={{ color: "#3e2723", fontWeight: "bold" }}>{rally}</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ fontSize: 9, color: "#5d3a1a", fontWeight: "bold", letterSpacing: 2 }}>{gameMode === "2p" ? "P2" : "CPU"}</div>
            <div style={{ fontSize: 30, fontWeight: "bold", color: "#1565c0", lineHeight: 1, fontFamily: "monospace" }}>{scoreC}</div>
            <Pips filled={scoreC} color="#1976d2" />
          </div>
        </div>

        {/* ── Canvas ── */}
        <div style={{
          position: "relative",
          border: "3px solid #5d3a1a",
          borderRadius: "0 0 14px 14px",
          overflow: "hidden",
          lineHeight: 0,
          flex: 1, minHeight: 0,
          background: "#dec49cff",
        }}>
          <canvas
            ref={canvasRef}
            width={CW} height={CH}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", touchAction: "none", cursor: "crosshair" }}
            onPointerMove={onPointerEvent}
            onPointerDown={onPointerEvent}
            onPointerUp={onPointerEvent}
            onPointerCancel={onPointerEvent}
            onPointerOut={onPointerEvent}
            onClick={() => {
              if (stRef.current?.serving && stRef.current.server === "player") {
                stRef.current.stimer = 0; // Launch on click
              }
            }}
          />

          {/* Point/fault flash */}
          {msg && (
            <div style={{
              position: "absolute", left: 0, right: 0,
              top: "50%", transform: "translateY(-50%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }}>
              <div style={{
                background: "rgba(62,39,35,0.95)",
                color: msg.startsWith("POINT") ? "#4caf50" : msg.startsWith("CPU") ? "#f44336" : "#ffeb3b",
                padding: "16px 48px", borderRadius: 14,
                fontSize: 16, fontWeight: "bold", letterSpacing: 2,
                border: `2px solid ${msg.startsWith("POINT") ? "#4caf50" : msg.startsWith("CPU") ? "#f44336" : "#ffeb3b"}`,
                boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                whiteSpace: "nowrap",
                textAlign: "center",
              }}>
                {msg}
              </div>
            </div>
          )}

          {/* ── Main overlay ── */}
          {showOverlay && (
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(62,39,35,0.9)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 20, zIndex: 20,
            }}>
              {phase === "idle" && (
                <>
                  <h1 style={{ fontSize: 10, color: "#a0724a", letterSpacing: 6, margin: 0 }}>TABLE TENNIS</h1>
                  <h2 style={{ fontSize: 20, fontWeight: "bold", color: "#d4a96a", letterSpacing: 5, margin: "4px 0" }}>PING PONG</h2>
                  <div style={{ display: "flex", gap: 15, marginTop: 12 }}>
                    <button
                      onClick={() => { setGameMode("1p"); startGame(0, 0, "player"); }}
                      style={{
                        background: "#d4a96a", color: "#3e2723",
                        border: "none", borderRadius: 8, padding: "8px 12px",
                        fontSize: 16, fontWeight: "bold", cursor: "pointer",
                        fontFamily: "Georgia, serif", letterSpacing: 2,
                        boxShadow: "0 4px 0 #5d3a1a",
                      }}
                    >
                      1 PLAYER
                    </button>
                    <button
                      onClick={() => { setGameMode("2p"); startGame(0, 0, "player"); }}
                      style={{
                        background: "#d4a96a", color: "#3e2723",
                        border: "none", borderRadius: 8, padding: "5px 2px",
                        fontSize: 16, fontWeight: "bold", cursor: "pointer",
                        fontFamily: "Georgia, serif", letterSpacing: 2,
                        boxShadow: "0 4px 0 #5d3a1a",
                      }}
                    >
                      2 PLAYERS
                    </button>
                  </div>
                </>
              )}
              {(phase === "won" || phase === "lost") && (
                <>
                  {phase === "won" && <Fireworks />}
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 15, zIndex: 30, textAlign: "center",
                    background: "#2d1b0d",
                    padding: "40px 30px", borderRadius: 16,
                    border: "4px solid #d4a96a",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.8), inset 0 0 30px rgba(212,169,106,0.1)",
                  }}>
                    <div style={{ fontSize: 11, color: "#d4a96a", letterSpacing: 8, textTransform: "uppercase", opacity: 0.8 }}>
                      Match Result
                    </div>
                    <div style={{
                      fontSize: 48, fontWeight: "900", letterSpacing: 6,
                      background: phase === "won" ? "linear-gradient(180deg, #4caf50, #81c784)" : "linear-gradient(180deg, #f44336, #e57373)",
                      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                      textShadow: "0 10px 20px rgba(0,0,0,0.3)",
                    }}>
                      {phase === "won" ? "VICTORY!" : "DEFEAT!"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 30, padding: "10px 0" }}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 9, color: "#d4a96a", marginBottom: 4 }}>{gameMode === "2p" ? "P1" : "YOU"}</span>
                        <span style={{ fontSize: 42, fontWeight: "bold", color: "#f44336", fontFamily: "monospace", lineHeight: 1 }}>{scoreP}</span>
                      </div>
                      <div style={{ fontSize: 24, color: "#d4a96a", opacity: 0.5, marginTop: 15 }}>—</div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 9, color: "#d4a96a", marginBottom: 4 }}>{gameMode === "2p" ? "P2" : "CPU"}</span>
                        <span style={{ fontSize: 42, fontWeight: "bold", color: "#1e88e5", fontFamily: "monospace", lineHeight: 1 }}>{scoreC}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setScoreP(0); setScoreC(0); setRally(0); setSpeedPct(20); startGame(0, 0, "player"); }}
                      style={{
                        marginTop: 15, background: "linear-gradient(180deg, #d4a96a, #a0724a)", color: "#3e2723",
                        border: "none", borderRadius: 12, padding: "16px 64px",
                        fontSize: 18, fontWeight: "bold", cursor: "pointer",
                        fontFamily: "Georgia, serif", letterSpacing: 4,
                        boxShadow: "0 6px 0 #5d3a1a, 0 12px 24px rgba(0,0,0,0.4)",
                        transition: "transform 0.1s, box-shadow 0.1s",
                        width: "100%",
                      }}
                      onMouseDown={(e) => { e.currentTarget.style.transform = "translateY(4px)"; e.currentTarget.style.boxShadow = "0 2px 0 #5d3a1a"; }}
                      onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 6px 0 #5d3a1a, 0 12px 24px rgba(0,0,0,0.4)"; }}
                    >
                      PLAY AGAIN
                    </button>
                    <button
                      onClick={() => { setPhase("idle"); setScoreP(0); setScoreC(0); setRally(0); }}
                      style={{
                        marginTop: 10, background: "transparent", color: "#d4a96a",
                        border: "1.5px solid #d4a96a", borderRadius: 10, padding: "10px 32px",
                        fontSize: 12, fontWeight: "bold", cursor: "pointer",
                        fontFamily: "Georgia, serif", letterSpacing: 3,
                        transition: "background 0.2s, color 0.2s",
                        opacity: 0.7,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(212,169,106,0.1)"; e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = "0.7"; }}
                    >
                      BACK TO MENU
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "center", gap: 20, padding: "5px 0 2px", fontSize: 9, color: "#5d3a1a", letterSpacing: 1, flexShrink: 0 }}>
          <span>{gameMode === "2p" ? "P1: WASD / TOUCH | P2: ARROWS / TOUCH" : "MOUSE / WASD"}</span>
          <span>FIRST TO 11 POINTS WINS</span>
          <span>REAL ARC PHYSICS</span>
        </div>
      </div>
    </div>
  );
}