import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const CW = 520, CH = 720;
const WALL = 14, BALL_R = 8;
const PAD_W = 76, PAD_H = 10;
const hR = PAD_W / 2;
const WIN_SCORE = 11;
const NET_Y = CH / 2;
const NET_H = 6.5;

const TABLE_TOP = WALL + 6;
const TABLE_BOTTOM = CH - WALL - 6;
const TABLE_L = WALL + 6;
const TABLE_R = CW - WALL - 6;

const GRAVITY = 0.22;
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
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(TABLE_L - 3, TABLE_TOP - 3, (TABLE_R - TABLE_L) + 6, (TABLE_BOTTOM - TABLE_TOP) + 12);

  const grad = ctx.createLinearGradient(0, TABLE_TOP, 0, TABLE_BOTTOM);
  grad.addColorStop(0, "#2ecc71");
  grad.addColorStop(1, "#27ae60");
  ctx.fillStyle = grad;
  ctx.fillRect(TABLE_L, TABLE_TOP, TABLE_R - TABLE_L, TABLE_BOTTOM - TABLE_TOP);

  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 4;
  ctx.strokeRect(TABLE_L + 2, TABLE_TOP + 2, (TABLE_R - TABLE_L) - 4, (TABLE_BOTTOM - TABLE_TOP) - 4);

  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CW / 2, TABLE_TOP + 2);
  ctx.lineTo(CW / 2, TABLE_BOTTOM - 2);
  ctx.stroke();

  ctx.fillStyle = "#222";
  ctx.fillRect(TABLE_L - 6, NET_Y - NET_H - 12, 6, NET_H * 2 + 24);
  ctx.fillRect(TABLE_R, NET_Y - NET_H - 12, 6, NET_H * 2 + 24);

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(TABLE_L, NET_Y - NET_H, TABLE_R - TABLE_L, NET_H * 2);

  ctx.fillStyle = "#F8F8F8";
  ctx.fillRect(TABLE_L, NET_Y - NET_H - 2, TABLE_R - TABLE_L, 4);
}

function drawShadow(ctx, bx, by, bz) {
  const shadowAlpha = Math.max(0, 0.35 - bz * 0.007);
  const shadowScale = Math.max(0.2, 1 - bz * 0.012);
  ctx.beginPath();
  ctx.ellipse(bx, by, BALL_R * shadowScale * 1.2, BALL_R * shadowScale * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.fill();
}

function drawBall(ctx, bx, by, bz, trail) {
  const vy = by - bz;
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
  ctx.beginPath();
  ctx.arc(bx, vy, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = "#FFD700";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

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
    pc.width = 160; pc.height = 160;
    const pctx = pc.getContext("2d");
    const color = isPlayer ? "#d32f2f" : "#1565c0";
    const cx = pc.width / 2, cy = pc.height / 2;
    pctx.save();
    pctx.translate(cx, cy);
    pctx.rotate(isPlayer ? -Math.PI / 7 : Math.PI / 7);
    pctx.fillStyle = "#5d4037"; // handle
    pctx.beginPath();
    if (pctx.roundRect) pctx.roundRect(-4.5, isPlayer ? 10 : -48, 9, 38, 3);
    else pctx.rect(-4.5, isPlayer ? 10 : -48, 9, 38);
    pctx.fill();
    pctx.fillStyle = color;
    pctx.beginPath();
    pctx.ellipse(0, 0, hR, hR * 0.75, 0, 0, Math.PI * 2);
    pctx.fill();
    pctx.strokeStyle = "#333";
    pctx.lineWidth = 2.5;
    pctx.stroke();
    pctx.restore();
    cacheRef.current = pc;
  }
  ctx.drawImage(cacheRef.current, x - cacheRef.current.width / 2, y - cacheRef.current.height / 2);
}

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
          life: 1, decay: 0.015 + Math.random() * 0.01, color
        });
      }
    };
    let frame;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (Math.random() < 0.04) createBurst();
      particles.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= p.decay;
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
  const [msg, setMsg] = useState("");
  const [rally, setRally] = useState(0);

  const pointTmrRef = useRef(null);

  const getAudio = () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx.current;
  };
  const ping = useCallback((f = 880) => { try { createPingSound(getAudio(), f, "ping"); } catch { } }, []);
  const pong = useCallback((f = 660) => { try { createPingSound(getAudio(), f, "bounce"); } catch { } }, []);
  const scoreSound = useCallback(() => { try { createPingSound(getAudio(), 520, "score"); } catch { } }, []);
  const showMsg = useCallback((t, d = 1200) => { setMsg(t); setTimeout(() => setMsg(""), d); }, []);

  const mkSt = (sp, sc, direction) => ({
    px: CW / 2, py: TABLE_BOTTOM - 48, pvx: 0, pvy: 0,
    cx: CW / 2, cy: TABLE_TOP + 48, cvx: 0, cvy: 0,
    bx: CW / 2, by: NET_Y - direction * 120, bz: 75,
    bvx: (Math.random() - 0.5) * 5, bvy: direction * 6.5, bvz: 0,
    sp, sc,
    speed: 4.8,
    trail: [], bounceRings: [],
    rallyHits: 0, aiErrX: 0, aiTimer: 0,
    pBounced: false, cBounced: false, lastHit: null, serving: false
  });

  const draw = useCallback((s) => {
    const c = canvasRef.current; if (!c) return;
    if (!ctxRef.current) ctxRef.current = c.getContext("2d");
    const ctx = ctxRef.current;
    drawTable(ctx);
    drawBounceRings(ctx, s.bounceRings);
    drawBall(ctx, s.bx, s.by, s.bz, s.trail);
    drawPaddle(ctx, s.px, s.py, true, p1CanvasRef);
    drawPaddle(ctx, s.cx, s.cy, false, p2CanvasRef);
  }, []);

  const startGame = useCallback((isp, isc, dir) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    runRef.current = true;
    const s = mkSt(isp, isc, dir); stRef.current = s;
    setPhase("playing"); setScoreP(isp); setScoreC(isc); setRally(0);

    const awardPoint = (winner, reason) => {
      if (!runRef.current) return; runRef.current = false;
      scoreSound();
      if (winner === "player") { s.sp++; setScoreP(s.sp); } else { s.sc++; setScoreC(s.sc); }
      draw(s);
      const winLabel = winner === "player" ? (gameModeRef.current === "2p" ? "P1" : "POINT!") : (gameModeRef.current === "2p" ? "P2" : "CPU");
      showMsg(`${winLabel} ${reason}`, 1300);
      if (s.sp >= WIN_SCORE) { setTimeout(() => setPhase("won"), 1000); return; }
      if (s.sc >= WIN_SCORE) { setTimeout(() => setPhase("lost"), 1000); return; }
      setTimeout(() => startGame(s.sp, s.sc, winner === "player" ? -1 : 1), 1500);
    };

    const loop = () => {
      if (!runRef.current) return;
      const s = stRef.current, k = keysRef.current;
      let p1p = null, p2p = null;
      Object.values(pointersRef.current).forEach(p => { if (p.y > NET_Y) p1p = p; else p2p = p; });
      if (gameModeRef.current === "1p" && !p1p) p1p = Object.values(pointersRef.current)[0];

      const ppx = s.px, ppy = s.py, pcx = s.cx, pcy = s.cy;
      if (p1p) { s.px += (clamp(p1p.x, TABLE_L + hR, TABLE_R - hR) - s.px) * 0.65; s.py += (clamp(p1p.y, NET_Y + 40, TABLE_BOTTOM - PAD_H) - s.py) * 0.65; }
      s.px = clamp(s.px, TABLE_L + hR, TABLE_R - hR); s.py = clamp(s.py, NET_Y + 40, TABLE_BOTTOM - PAD_H);
      s.pvx = s.px - ppx; s.pvy = s.py - ppy;

      if (gameModeRef.current === "2p") {
        if (p2p) { s.cx += (clamp(p2p.x, TABLE_L + hR, TABLE_R - hR) - s.cx) * 0.65; s.cy += (clamp(p2p.y, TABLE_TOP + PAD_H, NET_Y - 40) - s.cy) * 0.65; }
      } else {
        s.aiTimer--; if (s.aiTimer <= 0) { s.aiErrX = (Math.random() - 0.5) * 18; s.aiTimer = 15; }
        const tr = 0.07 + Math.min(s.speed, 12) * 0.005;
        s.cx += (clamp(s.bx + s.aiErrX, TABLE_L + hR + 2, TABLE_R - hR - 2) - s.cx) * tr * 4.8;
        s.cy += (TABLE_TOP + 48 - s.cy) * tr * 3.5;
      }
      s.cx = clamp(s.cx, TABLE_L + hR + 2, TABLE_R - hR - 2); s.cy = clamp(s.cy, TABLE_TOP + 2, NET_Y - 40);
      s.cvx = s.cx - pcx; s.cvy = s.cy - pcy;

      s.trail.push(s.bx, s.by - s.bz); if (s.trail.length > 16) s.trail.splice(0, 2);
      s.bounceRings.forEach((r, i) => { if (--r.life <= 0) s.bounceRings.splice(i, 1); });

      s.bvz -= GRAVITY; s.bx += s.bvx; s.by += s.bvy; s.bz += s.bvz;
      if (s.bx < TABLE_L + BALL_R || s.bx > TABLE_R - BALL_R) { s.bvx = -s.bvx * 0.9; s.bx = clamp(s.bx, TABLE_L + BALL_R, TABLE_R - BALL_R); }

      if (s.bz <= 0 && s.bvz < 0) {
        s.bz = 0; s.bvz = -s.bvz * 0.82;
        if (s.bx > TABLE_L && s.bx < TABLE_R && s.by > TABLE_TOP && s.by < TABLE_BOTTOM) {
          const onP = s.by > NET_Y; pong(onP ? 520 : 420);
          s.bounceRings.push({ x: s.bx, y: s.by, life: 28, maxLife: 28 });
          if (onP) { if (s.pBounced) { awardPoint("cpu", "Double Bounce"); return; } s.pBounced = true; }
          else { if (s.cBounced) { awardPoint("player", "Double Bounce"); return; } s.cBounced = true; }
        } else {
          awardPoint(s.lastHit === "player" ? "cpu" : "player", "Out"); return;
        }
      }

      if (Math.abs(s.by - NET_Y) < (Math.abs(s.bvy) + 2) && s.bz < NET_H) {
        awardPoint(s.bvy > 0 ? "player" : "cpu", "Net Fault"); return;
      }

      const visualBy = s.by - s.bz, pdx = s.bx - s.px, pdy = visualBy - s.py, pDist = Math.hypot(pdx, pdy);
      if (pDist < hR * 1.6 && s.bz < 65 && s.bvy > 0 && s.by < TABLE_BOTTOM) {
        s.lastHit = "player";
        s.bvy = -(s.speed * 1.02 + Math.abs(s.pvy) * 0.25);
        s.bvx = (pdx / hR) * s.speed * 0.95 + s.pvx * 0.65;
        s.bvz = s.speed * 1.0 + Math.abs(s.pvy) * 0.35; s.bz = 40;
        s.pBounced = s.cBounced = false; s.speed = Math.min(12, s.speed + 0.15);
        setRally(++s.rallyHits); ping(820);
      }
      const cdx = s.bx - s.cx, cdy = visualBy - s.cy, cDist = Math.hypot(cdx, cdy);
      if (cDist < hR * 1.6 && s.bz < 65 && s.bvy < 0 && s.by > TABLE_TOP) {
        s.lastHit = "cpu";
        s.bvy = (s.speed * 1.02 + Math.abs(s.cvy) * 0.25);
        s.bvx = (cdx / hR) * s.speed * 0.95 + s.cvx * 0.65;
        s.bvz = s.speed * 1.1 + Math.abs(s.cvy) * 0.35; s.bz = 40;
        s.pBounced = s.cBounced = false; s.speed = Math.min(12, s.speed + 0.15);
        setRally(++s.rallyHits); ping(680);
      }

      if (s.by > TABLE_BOTTOM + 40) { awardPoint(s.lastHit === "player" ? "cpu" : "player", "Out"); return; }
      if (s.by < TABLE_TOP - 40) { awardPoint(s.lastHit === "cpu" ? "player" : "cpu", "Out"); return; }

      draw(s); rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [draw, ping, pong, scoreSound, showMsg]);

  useEffect(() => { if (phase !== "playing") { runRef.current = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); } }, [phase]);
  const onPointerEvent = useCallback(e => {
    const r = canvasRef.current?.getBoundingClientRect(); if (!r) return;
    const x = (e.clientX - r.left) * (CW / r.width), y = (e.clientY - r.top) * (CH / r.height);
    if (e.type === "pointerup" || e.type === "pointercancel" || e.type === "pointerout") delete pointersRef.current[e.pointerId];
    else pointersRef.current[e.pointerId] = { x, y };
  }, []);
  const showOverlay = phase === "idle" || phase === "won" || phase === "lost";

  return (
    <div style={{
      width: "100vw", height: "100dvh", overflow: "hidden", position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif", color: "#fff",
      background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.85) 100%), repeating-linear-gradient(90deg, #c19a6b 0px, #c19a6b 40px, #ab865a 40px, #ab865a 42px)`,
      boxShadow: "inset 0 0 100px rgba(0,0,0,0.9)",
    }}>
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
        .game-canvas-wrapper { animation: fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1); position: relative; }
        @media (max-width: 600px) {
          .mobile-hud { top: 0.5dvh !important; left: 3vw !important; right: 3vw !important; }
          .mobile-hud-label { font-size: 10px !important; opacity: 0.5; }
          .mobile-hud-score { font-size: 42px !important; }
        }
      `}</style>
      {phase !== "idle" && !showOverlay && (
        <div className="mobile-hud" style={{ position: "absolute", top: "4dvh", left: "6vw", right: "6vw", display: "flex", justifyContent: "space-between", zIndex: 11 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="mobile-hud-label" style={{ fontSize: "min(3vw, 22px)", color: "rgba(255,255,255,0.4)", fontWeight: "bold", letterSpacing: 2 }}>{gameMode === "2p" ? "PLAYER 1" : "YOU"}</div>
            <div className="mobile-hud-score" style={{ fontSize: "min(12vw, 90px)", fontWeight: "900", color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{scoreP}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="mobile-hud-label" style={{ fontSize: "min(3vw, 22px)", color: "rgba(255,255,255,0.4)", fontWeight: "bold", letterSpacing: 2 }}>{gameMode === "2p" ? "PLAYER 2" : "CPU"}</div>
            <div className="mobile-hud-score" style={{ fontSize: "min(12vw, 90px)", fontWeight: "900", color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{scoreC}</div>
          </div>
        </div>
      )}
      <div className="game-canvas-wrapper">
        <canvas
          ref={canvasRef} width={CW} height={CH}
          style={{ display: "block", width: "min(100vw, 100dvh * (520 / 720))", height: "min(100dvh, 100vw * (720 / 520))", touchAction: "none", cursor: "crosshair", boxShadow: "0 0 100px rgba(0,0,0,0.5)" }}
          onPointerMove={onPointerEvent} onPointerDown={onPointerEvent} onPointerUp={onPointerEvent}
          onClick={() => { if (stRef.current?.serving && stRef.current.server === "player") stRef.current.stimer = 0; }}
        />
        {msg && (
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", display: "flex", justifyContent: "center", zIndex: 15 }}>
            <div style={{ background: "rgba(30,10,5,0.9)", color: "#ffeb3b", padding: "16px 48px", borderRadius: 14, fontSize: 16, fontWeight: "bold", border: "2px solid #ffeb3b" }}>{msg}</div>
          </div>
        )}
        {showOverlay && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, zIndex: 20 }}>
            {phase === "idle" && (
              <>
                <h1 style={{ fontSize: 10, color: "#a0724a", letterSpacing: 6, margin: 0 }}>TABLE TENNIS</h1>
                <h2 style={{ fontSize: 20, fontWeight: "bold", color: "#d4a96a", letterSpacing: 5, margin: "4px 0" }}>PING PONG</h2>
                <div style={{ display: "flex", gap: 15, marginTop: 12 }}>
                  <button onClick={() => { setGameMode("1p"); startGame(0, 0, 1); }} style={btnStyle}>1 PLAYER</button>
                  <button onClick={() => { setGameMode("2p"); startGame(0, 0, 1); }} style={btnStyle}>2 PLAYERS</button>
                </div>
              </>
            )}
            {(phase === "won" || phase === "lost") && (
              <>
                {phase === "won" && <Fireworks />}
                <div style={resultBoxStyle}>
                  <div style={{ fontSize: 48, fontWeight: "900", color: phase === "won" ? "#4caf50" : "#f44336" }}>{phase === "won" ? "VICTORY!" : "DEFEAT!"}</div>
                  <div style={{ display: "flex", gap: 30 }}>
                    <ScoreDisplay label={gameMode === "2p" ? "P1" : "YOU"} score={scoreP} color="#f44336" />
                    <ScoreDisplay label={gameMode === "2p" ? "P2" : "CPU"} score={scoreC} color="#1e88e5" />
                  </div>
                  <button onClick={() => { setScoreP(0); setScoreC(0); startGame(0, 0, 1); }} style={actionBtnStyle}>PLAY AGAIN</button>
                  <button onClick={() => { setPhase("idle"); }} style={outlineBtnStyle}>BACK TO MENU</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle = { background: "#d4a96a", color: "#3e2723", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 18, fontWeight: "bold", cursor: "pointer", fontFamily: "Georgia, serif", letterSpacing: 2, minWidth: 140 };
const resultBoxStyle = { display: "flex", flexDirection: "column", alignItems: "center", gap: 15, background: "#2d1b0d", padding: "40px 30px", borderRadius: 16, border: "4px solid #d4a96a" };
const actionBtnStyle = { marginTop: 15, background: "linear-gradient(180deg, #d4a96a, #a0724a)", color: "#3e2723", border: "none", borderRadius: 12, padding: "16px 64px", fontSize: 18, fontWeight: "bold", cursor: "pointer", width: "100%" };
const outlineBtnStyle = { marginTop: 10, background: "transparent", color: "#d4a96a", border: "1.5px solid #d4a96a", borderRadius: 10, padding: "10px 32px", fontSize: 12, fontWeight: "bold", cursor: "pointer" };
const ScoreDisplay = ({ label, score, color }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
    <span style={{ fontSize: 9, color: "#d4a96a" }}>{label}</span>
    <span style={{ fontSize: 42, fontWeight: "bold", color, fontFamily: "monospace" }}>{score}</span>
  </div>
);