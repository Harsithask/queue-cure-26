/**
 * Queue Cure '26 - Server (v2)
 * Multi-doctor/counter support, urgent priority, no-show handling.
 * Each "doctor" gets its own isolated queue + Socket.io room, so adding
 * Doctor 2 never affects Doctor 1's patients.
 */
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Queue Cure '26</title><link rel="stylesheet" href="/style.css" /></head>
    <body><div class="topbar"><h1>🩺 Queue Cure '26</h1>
      <button id="themeToggle" class="btn-outline" style="padding:6px 12px;">🌙</button>
    </div>
    <div class="container"><div class="card" style="text-align:center; padding:40px 20px;">
      <h2 style="margin-bottom:24px;">Choose a screen</h2>
      <div style="display:flex; gap:16px; justify-content:center; flex-wrap:wrap;">
        <a href="/receptionist.html?doctor=doc1" style="text-decoration:none;">
          <button class="btn-primary" style="padding:16px 28px; font-size:1.05rem;">🧑‍💼 Receptionist Console</button></a>
        <a href="/patient.html?doctor=doc1" style="text-decoration:none;">
          <button class="btn-outline" style="padding:16px 28px; font-size:1.05rem;">🏥 Patient Waiting Room</button></a>
        <a href="/doctor.html?doctor=doc1" style="text-decoration:none;">
          <button class="btn-outline" style="padding:16px 28px; font-size:1.05rem;">👨‍⚕️ Doctor Dashboard</button></a>
      </div>
      <p style="color:var(--muted); margin-top:24px; font-size:0.9rem;">
        Tip: add <code>?doctor=doc2</code> to any URL to run a second, fully independent counter/doctor queue.
      </p>
    </div></div>
    <script>
      const t=document.getElementById('themeToggle');
      if(localStorage.getItem('qc-theme')==='dark'){document.body.classList.add('dark');t.textContent='☀️';}
      t.onclick=()=>{document.body.classList.toggle('dark');
        const dark=document.body.classList.contains('dark');
        localStorage.setItem('qc-theme', dark?'dark':'light'); t.textContent=dark?'☀️':'🌙';};
    </script>
    </body></html>`);
});

// ---------------------------------------------------------------
// MULTI-DOCTOR STATE STORE
// ---------------------------------------------------------------
const stateByDoctor = {}; // { [doctorId]: { queue, currentToken, ... } }

function freshState() {
  return {
    queue: [],
    currentToken: null,
    calledAt: null,
    avgConsultTime: 5,
    nextTokenNumber: 1,
    history: [],          // last 20 actual consult durations (ms)
    totalSeenToday: 0,
    noShowCount: 0,
    roomNumber: "",
  };
}

function getState(doctorId) {
  if (!stateByDoctor[doctorId]) stateByDoctor[doctorId] = freshState();
  return stateByDoctor[doctorId];
}

// ---------------------------------------------------------------
// CONCURRENCY GUARD — one lock per doctor, not global, so Doctor 1's
// "Call Next" never blocks Doctor 2's "Call Next" from processing.
// ---------------------------------------------------------------
const locks = {};
function withLock(doctorId, fn) {
  if (locks[doctorId]) return;
  locks[doctorId] = true;
  try { fn(); } finally { locks[doctorId] = false; }
}

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------
function computeWaitMinutes(state, positionAhead) {
  let avgMs;
  if (state.history.length >= 3) {
    const recent = state.history.slice(-5);
    avgMs = recent.reduce((s, h) => s + h, 0) / recent.length;
  } else {
    avgMs = state.avgConsultTime * 60 * 1000;
  }
  let remainingForCurrentMs = 0;
  if (state.currentToken && state.calledAt) {
    remainingForCurrentMs = Math.max(avgMs - (Date.now() - state.calledAt), 0);
  }
  return Math.ceil((remainingForCurrentMs + positionAhead * avgMs) / 60000);
}

function publicState(doctorId) {
  const state = getState(doctorId);
  const queueWithWaits = state.queue.map((p, idx) => ({
    token: p.token,
    name: p.name,
    urgent: !!p.urgent,
    tokensAhead: idx,
    estimatedWaitMins: computeWaitMinutes(state, idx),
  }));
  return {
    doctorId,
    roomNumber: state.roomNumber,
    currentToken: state.currentToken,
    queue: queueWithWaits,
    avgConsultTime: state.avgConsultTime,
    queueLength: state.queue.length,
    totalSeenToday: state.totalSeenToday,
    noShowCount: state.noShowCount,
    serverTime: Date.now(),
  };
}

function room(doctorId) { return `doctor:${doctorId}`; }
function broadcast(doctorId) { io.to(room(doctorId)).emit("state:update", publicState(doctorId)); }

// ---------------------------------------------------------------
// SOCKET EVENTS
// ---------------------------------------------------------------
io.on("connection", (socket) => {
  const doctorId = (socket.handshake.query.doctor || "doc1").toString().trim() || "doc1";
  socket.join(room(doctorId));
  socket.emit("state:update", publicState(doctorId));

  socket.on("patient:add", (payload, ack) => {
    withLock(doctorId, () => {
      const state = getState(doctorId);
      const name = (payload?.name || "").trim();
      if (!name) return ack && ack({ ok: false, error: "Name is required." });

      const patient = {
        token: state.nextTokenNumber++,
        name,
        urgent: !!payload?.urgent,
        addedAt: Date.now(),
      };

      // Priority/urgent: jump to front of waiting line (position 0)
      if (patient.urgent) state.queue.unshift(patient);
      else state.queue.push(patient);

      broadcast(doctorId);
      if (ack) ack({ ok: true, patient });
    });
  });

  socket.on("queue:callNext", (_, ack) => {
    withLock(doctorId, () => {
      const state = getState(doctorId);
      if (state.currentToken && state.calledAt) {
        state.history.push(Date.now() - state.calledAt);
        if (state.history.length > 20) state.history.shift();
        state.totalSeenToday++;
      }
      if (state.queue.length === 0) {
        state.currentToken = null;
        state.calledAt = null;
        broadcast(doctorId);
        return ack && ack({ ok: false, error: "Queue is empty." });
      }
      const next = state.queue.shift();
      state.currentToken = next;
      state.calledAt = Date.now();
      broadcast(doctorId);
      if (ack) ack({ ok: true, patient: next });
    });
  });

  // No-show: current patient didn't show up. Does NOT count toward
  // avg-consult-time history (would corrupt real wait-time data with a
  // near-zero duration). Immediately pulls the next patient in one click.
  socket.on("queue:noShow", (_, ack) => {
    withLock(doctorId, () => {
      const state = getState(doctorId);
      if (!state.currentToken) return ack && ack({ ok: false, error: "No one is currently being served." });
      state.noShowCount++;
      if (state.queue.length === 0) {
        state.currentToken = null;
        state.calledAt = null;
        broadcast(doctorId);
        return ack && ack({ ok: true, patient: null });
      }
      const next = state.queue.shift();
      state.currentToken = next;
      state.calledAt = Date.now();
      broadcast(doctorId);
      if (ack) ack({ ok: true, patient: next });
    });
  });

  socket.on("settings:setAvgTime", (payload, ack) => {
    const state = getState(doctorId);
    const minutes = Number(payload?.minutes);
    if (!minutes || minutes <= 0 || minutes > 180)
      return ack && ack({ ok: false, error: "Enter a valid number of minutes (1-180)." });
    state.avgConsultTime = minutes;
    broadcast(doctorId);
    if (ack) ack({ ok: true });
  });

  socket.on("settings:setRoom", (payload, ack) => {
  const state = getState(doctorId);
  const room = (payload?.roomNumber || "").trim();
  if (room.length > 20) return ack && ack({ ok: false, error: "Room number too long." });
  state.roomNumber = room;
  broadcast(doctorId);
  if (ack) ack({ ok: true });
});

  socket.on("patient:remove", (payload, ack) => {
    const state = getState(doctorId);
    const token = Number(payload?.token);
    const idx = state.queue.findIndex((p) => p.token === token);
    if (idx === -1) return ack && ack({ ok: false, error: "Token not found in waiting queue." });
    state.queue.splice(idx, 1);
    broadcast(doctorId);
    if (ack) ack({ ok: true });
  });

  socket.on("queue:reset", (_, ack) => {
    stateByDoctor[doctorId] = freshState();
    broadcast(doctorId);
    if (ack) ack({ ok: true });
  });
});

// Re-broadcast every 15s to every active doctor room so wait estimates
// visibly tick down without any new events.
setInterval(() => {
  Object.keys(stateByDoctor).forEach(broadcast);
}, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Queue Cure '26 v2 running on http://localhost:${PORT}`));