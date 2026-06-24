// ---- Read doctor ID from URL (?doctor=doc1) for multi-doctor support ----
const urlParams = new URLSearchParams(window.location.search);
let doctorId = urlParams.get("doctor") || "doc1";

const socket = io({ query: { doctor: doctorId } });

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const doctorPill = document.getElementById("doctorPill");
const patientLink = document.getElementById("patientLink");
const doctorLink = document.getElementById("doctorLink");
const addForm = document.getElementById("addForm");
const patientNameInput = document.getElementById("patientName");
const urgentCheck = document.getElementById("urgentCheck");
const callNextBtn = document.getElementById("callNextBtn");
const noShowBtn = document.getElementById("noShowBtn");
const currentTokenDisplay = document.getElementById("currentTokenDisplay");
const currentNameDisplay = document.getElementById("currentNameDisplay");
const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const seenCount = document.getElementById("seenCount");
const noShowCountEl = document.getElementById("noShowCount");
const avgTimeInput = document.getElementById("avgTimeInput");
const setAvgBtn = document.getElementById("setAvgBtn");
const resetBtn = document.getElementById("resetBtn");
const toast = document.getElementById("toast");
const themeToggle = document.getElementById("themeToggle");
const doctorIdInput = document.getElementById("doctorIdInput");
const switchDoctorBtn = document.getElementById("switchDoctorBtn");
const qrBox = document.getElementById("qrBox");
const qrCanvas = document.getElementById("qrCanvas");
const qrTokenLabel = document.getElementById("qrTokenLabel");
const roomInput = document.getElementById("roomInput");
const setRoomBtn = document.getElementById("setRoomBtn");

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

// ---- Multi-doctor links/pill (Feature 8) ----
function updateDoctorLinks() {
  doctorPill.textContent = `Doctor: ${doctorId}`;
  patientLink.href = `patient.html?doctor=${doctorId}`;
  doctorLink.href = `doctor.html?doctor=${doctorId}`;
}
updateDoctorLinks();

switchDoctorBtn.addEventListener("click", () => {
  const val = doctorIdInput.value.trim();
  if (!val) return showToast("Enter a doctor ID first", "error");
  const newUrl = `${window.location.pathname}?doctor=${encodeURIComponent(val)}`;
  window.open(newUrl, "_blank"); // opens a NEW tab; current doctor's screen stays open untouched
  showToast(`Opened a new tab for ${val}`);
});

function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => (toast.className = "toast"), 2200);
}

socket.on("connect", () => {
  statusDot.className = "status-dot connected";
  statusText.textContent = "Live";
});
socket.on("disconnect", () => {
  statusDot.className = "status-dot disconnected";
  statusText.textContent = "Disconnected — retrying...";
});

let lastCurrentToken = null;

socket.on("state:update", (state) => {
  // Currently serving (Feature 3: animate token change)
  if (state.currentToken) {
    currentTokenDisplay.textContent = "#" + state.currentToken.token;
    currentNameDisplay.textContent = state.currentToken.name;
    if (lastCurrentToken !== state.currentToken.token) {
      currentTokenDisplay.classList.remove("pulse");
      void currentTokenDisplay.offsetWidth; // restart animation
      currentTokenDisplay.classList.add("pulse");
    }
  } else {
    currentTokenDisplay.textContent = "—";
    currentNameDisplay.textContent = "No patient called yet";
  }
  lastCurrentToken = state.currentToken ? state.currentToken.token : null;

  // Stats
  seenCount.textContent = state.totalSeenToday;
  noShowCountEl.textContent = state.noShowCount;

  // Waiting queue
  queueCount.textContent = state.queueLength;
  queueList.innerHTML = "";
  if (state.queue.length === 0) {
    queueList.innerHTML = '<li class="empty-msg">No patients waiting.</li>';
  } else {
    state.queue.forEach((p) => {
      const li = document.createElement("li");
      if (p.urgent) li.classList.add("urgent");
      li.innerHTML = `
        <span><span class="token-badge">#${p.token}</span>${escapeHtml(p.name)}${p.urgent ? '<span class="urgent-badge">URGENT</span>' : ""}</span>
        <button class="btn-danger-outline" data-token="${p.token}">Remove</button>
      `;
      queueList.appendChild(li);
    });
  }

  avgTimeInput.value = state.avgConsultTime;
  if (document.activeElement !== roomInput) roomInput.value = state.roomNumber || "";
});

setRoomBtn.addEventListener("click", () => {
  const roomNumber = roomInput.value.trim();
  socket.emit("settings:setRoom", { roomNumber }, (res) => {
    if (res.ok) showToast(`Room set to "${roomNumber}"`);
    else showToast(res.error, "error");
  });
});

// ---- Add patient ----
addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = patientNameInput.value.trim();
  if (!name) return showToast("Please enter a patient name", "error");

  const urgent = urgentCheck.checked;
  const submitBtn = addForm.querySelector("button");
  submitBtn.disabled = true;

  socket.emit("patient:add", { name, urgent }, (res) => {
    submitBtn.disabled = false;
    if (res.ok) {
      showToast(`Added token #${res.patient.token} — ${res.patient.name}${urgent ? " (URGENT)" : ""}`);
      patientNameInput.value = "";
      urgentCheck.checked = false;
      patientNameInput.focus();
      showQrForToken(res.patient.token); // Feature 6
    } else {
      showToast(res.error || "Could not add patient", "error");
    }
  });
});

// ---- Feature 6: QR code linking straight to patient.html?token=N ----
function showQrForToken(token) {
  qrCanvas.innerHTML = "";
  const trackUrl = `${window.location.origin}/patient.html?doctor=${doctorId}&token=${token}`;
  // eslint-disable-next-line no-undef
  new QRCode(qrCanvas, { text: trackUrl, width: 120, height: 120 });
  qrTokenLabel.textContent = `Token #${token}`;
  qrBox.style.display = "block";
}

// ---- Call Next ----
let callNextInFlight = false;
callNextBtn.addEventListener("click", () => {
  if (callNextInFlight) return;
  callNextInFlight = true;
  callNextBtn.disabled = true;
  socket.emit("queue:callNext", null, (res) => {
    callNextInFlight = false;
    callNextBtn.disabled = false;
    if (res.ok) showToast(`Now serving #${res.patient.token} — ${res.patient.name}`);
    else showToast(res.error || "Nothing to call", "error");
  });
});

// ---- Feature 12: No-show handling ----
let noShowInFlight = false;
noShowBtn.addEventListener("click", () => {
  if (noShowInFlight) return;
  if (!confirm("Mark the current patient as a no-show and call the next one?")) return;
  noShowInFlight = true;
  noShowBtn.disabled = true;
  socket.emit("queue:noShow", null, (res) => {
    noShowInFlight = false;
    noShowBtn.disabled = false;
    if (res.ok) {
      showToast(res.patient ? `No-show recorded. Now serving #${res.patient.token}` : "No-show recorded. Queue is empty.");
    } else {
      showToast(res.error || "Could not process no-show", "error");
    }
  });
});

// ---- Update average consult time ----
setAvgBtn.addEventListener("click", () => {
  const minutes = Number(avgTimeInput.value);
  socket.emit("settings:setAvgTime", { minutes }, (res) => {
    if (res.ok) showToast(`Average consult time set to ${minutes} min`);
    else showToast(res.error, "error");
  });
});

// ---- Remove a patient ----
queueList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-token]");
  if (!btn) return;
  const token = Number(btn.dataset.token);
  if (!confirm(`Remove token #${token} from the queue?`)) return;
  socket.emit("patient:remove", { token }, (res) => {
    if (res.ok) showToast(`Removed #${token}`);
    else showToast(res.error, "error");
  });
});

// ---- Reset ----
resetBtn.addEventListener("click", () => {
  if (!confirm("This clears the entire queue and resets token numbers. Continue?")) return;
  socket.emit("queue:reset", null, () => showToast("Queue reset for new day"));
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}