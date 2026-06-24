# Thought Process Sheet — Queue Cure '26

## 1. Problem framing

A clinic receptionist needs to (a) register walk-in patients fast,
(b) call the next patient with one click, and (c) have the waiting
room automatically know who's up next and how long they'll wait —
without anyone refreshing a page or shouting a name. The core
technical challenge isn't UI, it's **state synchronization across
multiple simultaneous viewers** plus **honest wait-time math**.

## 2. Architecture decision: single server-side source of truth

I considered three options:

| Option | Verdict |
|---|---|
| Each screen keeps its own local queue state, synced via polling | ❌ Race conditions, stale data, "refresh to see truth" — fails the 40% live-sync requirement |
| Firebase Realtime DB / Firestore listeners | ✅ Works, but adds a vendor SDK + auth setup for a 1-day hackathon |
| Single Node + Socket.io server holding in-memory state, broadcasting to all clients | ✅ Chosen — zero external dependencies, true real-time push, easiest to reason about for concurrency |

I went with **Socket.io over raw WebSockets** because it auto-handles
reconnection, fallback transports, and acknowledgement callbacks
(`ack`) — which I use heavily to give the receptionist instant
success/error feedback without extra round trips.

## 3. Concurrency & race conditions — what I actually addressed

This was the part I spent the most time on, since it's 15% of the grade
and the most likely place naive solutions break:

- **Double-click "Call Next."** A nervous receptionist might click twice
  fast. I added an `isProcessing` lock on the server (`withLock`) so a
  second `queue:callNext` event arriving while the first is still being
  processed is silently dropped instead of skipping two patients at
  once. I also disable the button client-side the instant it's clicked,
  re-enabling only after the server acknowledges.
- **Two receptionist tabs open at once.** Because the lock and the queue
  array live on the server (not in browser memory), it doesn't matter
  how many receptionist tabs are open — they're all just emitting events
  at the same shared state. There's no "tab A's queue" vs "tab B's
  queue" to desync.
- **Adding a patient while "Call Next" is mid-flight.** `patient:add`
  pushes to the array; `queue:callNext` shifts from the front. Since
  Node.js event handlers for socket events run synchronously to
  completion before the next handler runs (single-threaded event loop,
  no `await` inside the critical section), there's no interleaving
  where an add and a call-next corrupt each other mid-operation.
- **Token number collisions.** Tokens are assigned from a single
  ever-incrementing counter (`nextTokenNumber++`) rather than
  `queue.length + 1`. This guarantees uniqueness even after patients
  are removed or the queue empties out mid-day.

## 4. Edge cases handled

- **Empty queue + "Call Next" clicked** → server returns
  `{ ok: false, error: "Queue is empty" }` via ack; receptionist sees a
  toast, nothing breaks, `currentToken` simply stays as the last person
  (so the screen doesn't flash to "no one" if the last patient is still
  technically in consultation).
- **Empty/whitespace-only patient name** → rejected server-side (never
  trust client-side validation alone) with a clear error message.
- **Mistaken entry** → receptionist can remove a specific token from
  the *waiting* queue (not the one currently being served, to avoid
  accidentally cancelling an in-progress consultation).
- **A patient's token isn't found when they search "Find Me"** → shown
  as "Done / Not found" rather than crashing or showing stale numbers,
  so a patient who already got called doesn't see confusing data.
- **New day / queue overflow** → "Reset Queue" button clears everything
  and restarts token numbering at 1, with a confirm() guard since it's
  destructive.
- **Network drop on either screen** → Socket.io auto-reconnects, and on
  reconnect the server immediately re-sends a full `state:update`
  snapshot, so the screen "catches up" instead of staying frozen on
  stale data.

## 5. Wait time computed from real data, not hardcoded

This was explicitly 25% of the grade, so I avoided a flat
"3 patients × 5 min" type formula. Instead:

- Each completed consultation's *actual* duration (time between being
  called and the next person being called) is recorded in a rolling
  `history` array (last 20 entries).
- Once at least 3 real consultations have happened, the wait-time
  formula switches from the receptionist's manual estimate to the
  **average of the last 5 actual consult durations** — so the estimate
  self-corrects to the doctor's real pace as the day goes on.
- For the patient currently in the room, I don't double count their
  full average time — I compute `remaining = avg - elapsed_so_far`, so
  if a patient enters and 10 minutes have already passed against an
  8-minute average, remaining time clamps to 0 instead of going
  negative.
- A 15-second server-side heartbeat re-broadcasts state purely so the
  "estimated wait" numbers visibly tick down over time even with zero
  new queue events, instead of looking frozen.

## 6. Making the receptionist screen "fast and mistake-proof" (20%)

- Single input field, Enter-to-submit form (no extra clicks).
- Input auto-clears and refocuses after a successful add, so a
  receptionist can add 10 patients back-to-back without touching the
  mouse.
- Buttons disable themselves while a request is in flight, preventing
  accidental duplicate submissions.
- Destructive actions (remove patient, reset queue) require a native
  `confirm()` — cheap to implement, effective at preventing slips.
- Toast notifications confirm every action ("Added token #14 — Asha"),
  so the receptionist never has to wonder "did that actually go
  through?"

## 7. What I'd add with more time

- Persist state to a free-tier database (e.g. MongoDB Atlas free
  cluster, or even SQLite file) so a server restart doesn't wipe the
  day's queue.
- Multi-clinic / multi-counter support (separate queues per doctor).
- SMS/WhatsApp notification when a patient is 2 tokens away (would need
  a free-tier API like Twilio trial or WhatsApp Cloud API).
- Authentication on the receptionist screen so randoms can't hit
  `/receptionist.html` and call patients.
