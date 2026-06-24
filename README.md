# Queue Cure '26 🩺

Live clinic token-queue system — built for the Queue Cure '26 hackathon
on Wooble. Replaces paper token slips + shouting with two real-time
synced screens powered by Socket.io.

## Live demo
- Receptionist screen: `<your-deployed-url>/receptionist.html`
- Patient screen: `<your-deployed-url>/patient.html`

*(Fill these in after deploying — see "Deploy for free" below.)*

## Features
- **Receptionist screen**: add patient → instant token assignment,
  "Call Next" with one click, editable average consultation time,
  remove mistaken entries, full-day reset.
- **Patient screen**: live "Now Serving" display, full waiting queue
  with per-patient estimated wait, "Find Me" lookup by token number.
- **Live sync**: every action on the receptionist screen updates ALL
  connected patient screens instantly via WebSockets — zero refresh.
- **Real wait-time math**: starts from a manual average, then
  self-corrects using the actual recorded duration of the last few
  consultations once enough real data exists.
- **Concurrency-safe**: a processing lock prevents double "Call Next"
  clicks from skipping patients; see `docs/thought-process.md`.

## Tech stack (100% free tier)
- Node.js + Express — static file serving + server
- Socket.io — real-time bidirectional events
- Vanilla HTML/CSS/JS — zero build step, runs anywhere
- No database required (in-memory state — see Scaling Notes below)

---

## 1. Run locally in VS Code

**Prerequisites:** [Node.js](https://nodejs.org) (v18+) installed.

```bash
# 1. Clone your repo (after you push this code to GitHub)
git clone https://github.com/<your-username>/queue-cure-26.git
cd queue-cure-26

# 2. Install dependencies
npm install

# 3. Run the server
npm start
```

You'll see:
```
Queue Cure '26 server running on http://localhost:3000
```

Now open **two browser tabs**:
- `http://localhost:3000/receptionist.html`
- `http://localhost:3000/patient.html`

Add a patient and click "Call Next" on the receptionist tab — watch
the patient tab update instantly with no refresh.

---

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Queue Cure '26 - initial submission"
git branch -M main
git remote add origin https://github.com/<your-username>/queue-cure-26.git
git push -u origin main
```

---

## 3. Deploy for free

⚠️ **Read this first:** Vercel's hosting model is serverless functions,
which spin down between requests and **do not support persistent
WebSocket connections** the way Socket.io needs. Deploying this app
as-is to Vercel will break live sync (the #1, 40%-weighted criterion).

**Recommended: Render.com (free, supports real Node servers + WebSockets)**

1. Go to [render.com](https://render.com) → sign up free (GitHub login).
2. Click **New +** → **Web Service**.
3. Connect your GitHub repo (`queue-cure-26`).
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Click **Create Web Service**. Render gives you a URL like
   `https://queue-cure-26.onrender.com`.
6. Your live links:
   - `https://queue-cure-26.onrender.com/receptionist.html`
   - `https://queue-cure-26.onrender.com/patient.html`

> Free Render services sleep after inactivity and take ~30s to wake up
> on the first request — totally fine for a hackathon demo. Just open
> the link once a minute or two before your demo/recording.

**Alternative free options that also support WebSockets:**
- [Railway.app](https://railway.app) (free trial credits)
- [Fly.io](https://fly.io) (free allowance)
- [Glitch.com](https://glitch.com) (instant free Node hosting, good for quick demos)

**If you still want to use Vercel** (e.g. because the hackathon
explicitly likes Vercel links), you'd need to swap Socket.io for a
managed real-time service that works with serverless functions, such
as **Pusher Channels (free tier)**, **Ably (free tier)**, or
**Supabase Realtime (free tier)**. That's a bigger rework than this
hackathon's timeframe usually allows — Render is the path of least
resistance for a guaranteed-working live-sync demo.

---

## 4. Record your demo video

Simple two-camera-angle screen recording (use free tools: Windows
Game Bar / macOS QuickTime / [OBS Studio](https://obsproject.com) free):

1. Open Receptionist screen on the left half of your screen, Patient
   screen on the right half (or two separate windows side by side).
2. Add 2-3 patients.
3. Click "Call Next" — show the Patient screen updating instantly.
4. Change average consult time, show wait estimates update.
5. Demonstrate "Remove" on a mistaken entry.
6. Keep it under 2 minutes.

---

## File structure

```
queue-cure-26/
├── server.js                  # Express + Socket.io server, all queue logic
├── package.json
├── public/
│   ├── receptionist.html      # Screen 1
│   ├── patient.html           # Screen 2
│   ├── style.css              # Shared styles
│   ├── receptionist.js        # Receptionist client logic
│   └── patient.js             # Patient client logic
├── docs/
│   ├── socket-event-diagram.md
│   └── thought-process.md
├── .gitignore
└── README.md
```

## Scaling notes (for judges / future-you)

Current state is in-memory (`server.js`'s `state` object), which means
it resets if the server restarts and only works with a single server
instance. For production use, you'd swap the in-memory `state` object
for a database layer:
- **MongoDB Atlas** (free 512MB cluster) — easiest drop-in for the same
  document-shaped data here.
- **Redis** (e.g. Upstash free tier) — also enables horizontal scaling
  across multiple server instances, since Socket.io supports a Redis
  adapter for broadcasting across instances.

## License
MIT — built for Queue Cure '26 hackathon submission.
