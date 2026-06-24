const urlParams = new URLSearchParams(window.location.search);
let doctorId = urlParams.get("doctor") || "doc1";

const socket = io({ query: { doctor: doctorId } });

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const doctorPill = document.getElementById("doctorPill");
const currentTokenDisplay = document.getElementById("currentTokenDisplay");
const currentNameDisplay = document.getElementById("currentNameDisplay");
const seenCount = document.getElementById("seenCount");
const waitingCount = document.getElementById("waitingCount");
const avgTimeStat = document.getElementById("avgTimeStat");
const noShowStatCount = document.getElementById("noShowStatCount");
const queueList = document.getElementById("queueList");
const themeToggle = document.getElementById("themeToggle");
const roomDisplay = document.getElementById("roomDisplay");

doctorPill.textContent = `Doctor: ${doctorId}`;

if (localStorage.getItem("qc-theme") === "dark") {
  document.body.classList.add("dark");
  themeToggle.textContent = "☀️";
}
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const dark = document.body.classList.contains("dark");
  localStorage.setItem("qc-theme", dark ? "dark" : "light");
  themeToggle.textContent = dark ? "☀️" : "🌙";
});

socket.on("connect", () => {
  statusDot.className = "status-dot connected";
  statusText.textContent = "Live";
});
socket.on("disconnect", () => {
  statusDot.className = "status-dot disconnected";
  statusText.textContent = "Disconnected — retrying...";
});

socket.on("state:update", (state) => {
  if (state.currentToken) {
    currentTokenDisplay.textContent = "#" + state.currentToken.token;
    currentNameDisplay.textContent = state.currentToken.name;
    roomDisplay.textContent = state.roomNumber ? `📍 ${state.roomNumber}` : "";
  } else {
    currentTokenDisplay.textContent = "—";
    currentNameDisplay.textContent = "No patient currently in consultation";
    roomDisplay.textContent = state.roomNumber ? `📍 ${state.roomNumber}` : "";
  }

  seenCount.textContent = state.totalSeenToday;
  waitingCount.textContent = state.queueLength;
  avgTimeStat.textContent = state.avgConsultTime;
  noShowStatCount.textContent = state.noShowCount;

  queueList.innerHTML = "";
  if (state.queue.length === 0) {
    queueList.innerHTML = '<li class="empty-msg">No patients waiting.</li>';
  } else {
    state.queue.forEach((p) => {
      const li = document.createElement("li");
      if (p.urgent) li.classList.add("urgent");
      li.innerHTML = `
        <span><span class="token-badge">#${p.token}</span>${escapeHtml(p.name)}${p.urgent ? '<span class="urgent-badge">URGENT</span>' : ""}</span>
        <span style="color:var(--muted); font-size:0.85rem;">~${p.estimatedWaitMins} min</span>
      `;
      queueList.appendChild(li);
    });
  }
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}