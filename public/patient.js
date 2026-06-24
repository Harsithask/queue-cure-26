const urlParams = new URLSearchParams(window.location.search);
let doctorId = urlParams.get("doctor") || "doc1";
const tokenFromUrl = urlParams.get("token"); // arrives here via QR scan (Feature 6)

const socket = io({ query: { doctor: doctorId } });

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const doctorPill = document.getElementById("doctorPill");
const currentTokenDisplay = document.getElementById("currentTokenDisplay");
const currentNameDisplay = document.getElementById("currentNameDisplay");
const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const myTokenInput = document.getElementById("myTokenInput");
const findBtn = document.getElementById("findBtn");
const myStatusBox = document.getElementById("myStatusBox");
const aheadCount = document.getElementById("aheadCount");
const waitMins = document.getElementById("waitMins");
const themeToggle = document.getElementById("themeToggle");
const soundToggle = document.getElementById("soundToggle");
const roomDisplay = document.getElementById("roomDisplay");

doctorPill.textContent = `Doctor: ${doctorId}`;

// ---- Dark mode (Feature 9) ----
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

// ---- Feature 1: Voice announcement toggle ----
let soundOn = localStorage.getItem("qc-sound") !== "off";
soundToggle.textContent = soundOn ? "🔊" : "🔇";
soundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  localStorage.setItem("qc-sound", soundOn ? "on" : "off");
  soundToggle.textContent = soundOn ? "🔊" : "🔇";
});

function announceToken(tokenNum, name) {
  if (!soundOn || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(
    `Token number ${tokenNum}, ${name}, please proceed to the consultation room.`
  );
  utter.rate = 0.95;
  window.speechSynthesis.cancel(); // avoid overlapping announcements
  window.speechSynthesis.speak(utter);
}

let latestState = null;
let watchedToken = tokenFromUrl ? Number(tokenFromUrl) : null;
let lastAnnouncedToken = null;

if (tokenFromUrl) myTokenInput.value = tokenFromUrl;

socket.on("connect", () => {
  statusDot.className = "status-dot connected";
  statusText.textContent = "Live";
});
socket.on("disconnect", () => {
  statusDot.className = "status-dot disconnected";
  statusText.textContent = "Disconnected — retrying...";
});

socket.on("state:update", (state) => {
  latestState = state;
  render();
});

function render() {
  if (!latestState) return;

  // Now serving (Feature 3: animated change + Feature 1: voice)
  if (latestState.currentToken) {
    currentTokenDisplay.textContent = "#" + latestState.currentToken.token;
    currentNameDisplay.textContent = latestState.currentToken.name;
    roomDisplay.textContent = latestState.roomNumber ? `📍 ${latestState.roomNumber}` : "";

    if (lastAnnouncedToken !== latestState.currentToken.token) {
      currentTokenDisplay.classList.remove("pulse");
      void currentTokenDisplay.offsetWidth;
      currentTokenDisplay.classList.add("pulse");
      announceToken(latestState.currentToken.token, latestState.currentToken.name);
      lastAnnouncedToken = latestState.currentToken.token;
    }
  } else {
    currentTokenDisplay.textContent = "—";
    currentNameDisplay.textContent = "Waiting for first patient to be called";
    roomDisplay.textContent = latestState.roomNumber ? `📍 ${latestState.roomNumber}` : "";
  }

  // Full queue list
  queueCount.textContent = latestState.queueLength;
  queueList.innerHTML = "";
  if (latestState.queue.length === 0) {
    queueList.innerHTML = '<li class="empty-msg">No one is waiting right now.</li>';
  } else {
    latestState.queue.forEach((p) => {
      const li = document.createElement("li");
      if (p.urgent) li.classList.add("urgent");
      li.innerHTML = `
        <span><span class="token-badge">#${p.token}</span>${escapeHtml(p.name)}${p.urgent ? '<span class="urgent-badge">URGENT</span>' : ""}</span>
        <span style="color:var(--muted); font-size:0.85rem;">~${p.estimatedWaitMins} min</span>
      `;
      queueList.appendChild(li);
    });
  }

  // "Find me" live tracking
  if (watchedToken !== null) {
    const mine = latestState.queue.find((p) => p.token === watchedToken);
    const isBeingServed = latestState.currentToken && latestState.currentToken.token === watchedToken;

    if (isBeingServed) {
      myStatusBox.style.display = "block";
      aheadCount.textContent = "0";
      waitMins.textContent = "Now!";
    } else if (mine) {
      myStatusBox.style.display = "block";
      aheadCount.textContent = mine.tokensAhead;
      waitMins.textContent = mine.estimatedWaitMins;
    } else {
      myStatusBox.style.display = "block";
      aheadCount.textContent = "—";
      waitMins.textContent = "Done / Not found";
    }
  }
}

findBtn.addEventListener("click", () => {
  const val = Number(myTokenInput.value);
  if (!val) return;
  watchedToken = val;
  render();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}