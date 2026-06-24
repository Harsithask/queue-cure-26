# Thought Process Sheet — Queue Cure '26

## 1. Problem framing

A clinic receptionist needs to (a) register walk-in patients fast,
(b) call the next patient with one click, and (c) have the waiting
room automatically know who's up next, where to go, and how long
they'll wait — without anyone refreshing a page or shouting a name.
The core technical challenge isn't UI, it's **state synchronization
across multiple simultaneous viewers**, **honest wait-time math**, and
— once I extended scope — **isolating multiple doctors/counters
running independently on the same server.**

## 2. Architecture decision: single server-side source of truth, partitioned by doctor

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

As the scope grew to support multiple doctors/counters, I didn't want
one global queue object — that would mean doc1's "Call Next" click
could theoretically affect doc2's screen if I made a mistake in
filtering logic on the client. Instead:

- The server keeps a **dictionary of state objects**, keyed by doctor
  ID: `stateByDoctor[doctorId]`.
- Every socket connection reads a `doctor` query param from the URL
  (`?doctor=doc2`) and joins a **Socket.io room** named `doctor:doc2`.
- Every broadcast (`io.to(room).emit(...)`) only reaches sockets in
  that specific room.

This pushes the isolation guarantee down to the transport layer
itself, rather than relying on every client-side script correctly
filtering data by doctor ID. A bug in client JS can't leak one
doctor's patient list to another doctor's screen, because the server
simply never sends that data to begin with.

## 3. Concurrency & race conditions — what I actually addressed

This was the part I spent the most time on, since it's 15% of the
grade and the most likely place naive solutions break:

- **Double-click "Call Next."** A nervous receptionist might click
  twice fast. I added a **per-doctor** processing lock
  (`locks[doctorId]`) so a second `queue:callNext` event for the same
  doctor arriving while the first is still being processed is silently
  dropped instead of skipping two patients at once. Critically, this
  lock is scoped per doctor — doc1's lock being held never blocks
  doc2's "Call Next" from processing, so adding multi-doctor support
  didn't introduce a new global bottleneck. I also disable the button
  client-side the instant it's clicked, re-enabling only after the
  server acknowledges.
- **Two receptionist tabs open for the same doctor.** Because the lock
  and the queue array live on the server (not in browser memory), it
  doesn't matter how many tabs are open for the same doctor ID — they
  all just emit events at the same shared state. There's no "tab A's
  queue" vs "tab B's queue" to desync.
- **Adding a patient while "Call Next" is mid-flight.** `patient:add`
  pushes/unshifts to the array; `queue:callNext` shifts from the
  front. Since Node.js event handlers for socket events run
  synchronously to completion before the next handler runs
  (single-threaded event loop, no `await` inside the critical
  section), there's no interleaving where an add and a call-next
  corrupt each other mid-operation.
- **Token number collisions.** Tokens are assigned from a single
  ever-incrementing counter per doctor (`nextTokenNumber++`), not
  `queue.length + 1`. This guarantees uniqueness even after patients
  are removed, marked no-show, or the queue empties out mid-day —
  and because each doctor has their own counter, doc1 and doc2 can
  both have a "Token #3" simultaneously without conflict, since tokens
  are only ever compared within their own doctor's room.

## 4. Edge cases handled

- **Empty queue + "Call Next" clicked** → server returns
  `{ ok: false, error: "Queue is empty" }` via ack; receptionist sees a
  toast, nothing breaks.
- **Empty/whitespace-only patient name** → rejected server-side (never
  trust client-side validation alone) with a clear error message.
- **Mistaken entry** → receptionist can remove a specific token from
  the *waiting* queue (not the one currently being served, to avoid
  accidentally cancelling an in-progress consultation).
- **Patient doesn't show up when called (no-show)** → receptionist
  marks "No-Show," which advances to the next patient in one click
  *without* recording a fake near-zero consult duration into the
  rolling history used for wait-time math. This matters: if a no-show
  were logged as a 5-second "consultation," it would corrupt the
  average and make every subsequent wait estimate falsely optimistic.
  No-shows are tracked in a separate counter instead, visible on the
  Doctor Dashboard.
- **Urgent/priority patients** → added with `unshift()` instead of
  `push()`, placing them at position 0 of the array — but this only
  reorders the *waiting* queue; it never interrupts a consultation
  already in progress, which would be unsafe and confusing.
- **A patient's token isn't found when they search "Find Me"** →
  shown as "Done / Not found" rather than crashing or showing stale
  numbers, so a patient who already got called doesn't see confusing
  data.
- **New day / queue overflow** → "Reset Queue" button clears
  everything for that doctor only and restarts token numbering at 1,
  with a `confirm()` guard since it's destructive.
- **Network drop on any screen** → Socket.io auto-reconnects, and on
  reconnect the server immediately re-sends a full `state:update`
  snapshot scoped to that doctor's room, so the screen "catches up"
  instead of staying frozen on stale data.
- **Switching to a second doctor without losing the first doctor's
  live view** → deliberately implemented "Open in New Tab"
  (`window.open(url, "_blank")`) instead of navigating the current tab
  away. A receptionist managing two counters should never lose visual
  context on counter 1 just because they needed to check on counter 2.

## 5. Wait time computed from real data, not hardcoded

This was explicitly 25% of the grade, so I avoided a flat
"3 patients × 5 min" type formula. Instead:

- Each completed consultation's *actual* duration (time between being
  called and the next person being called) is recorded in a rolling
  `history` array (last 20 entries), **per doctor**.
- Once at least 3 real consultations have happened, the wait-time
  formula switches from the receptionist's manual estimate to the
  **average of the last 5 actual consult durations** — so the estimate
  self-corrects to that specific doctor's real pace as the day goes
  on. A faster doctor and a slower doctor on the same server will
  naturally converge on different, accurate estimates.
- No-shows are explicitly excluded from this history (see Edge Cases
  above) to avoid skewing the average toward unrealistically short
  times.
- For the patient currently in the room, I don't double count their
  full average time — I compute `remaining = avg - elapsed_so_far`, so
  if a patient enters and 10 minutes have already passed against an
  8-minute average, remaining time clamps to 0 instead of going
  negative.
- A 15-second server-side heartbeat re-broadcasts state for every
  active doctor room purely so the "estimated wait" numbers visibly
  tick down over time even with zero new queue events, instead of
  looking frozen.

## 6. Making the receptionist screen "fast and mistake-proof" (20%)

- Single input field, Enter-to-submit form (no extra clicks).
- Input auto-clears and refocuses after a successful add, so a
  receptionist can add 10 patients back-to-back without touching the
  mouse.
- Buttons disable themselves while a request is in flight, preventing
  accidental duplicate submissions.
- Destructive actions (remove patient, reset queue, mark no-show)
  require a native `confirm()` — cheap to implement, effective at
  preventing slips.
- Toast notifications confirm every action ("Added token #14 —
  Asha"), so the receptionist never has to wonder "did that actually
  go through?"
- A visible **urgent checkbox** at the point of adding a patient
  means priority cases never require a separate "edit later" step
  that could be forgotten under pressure.
- **Room number** is set once per doctor/counter and automatically
  shown to that doctor's patients — removing a manual "tell the
  patient which room" step that's easy to forget or get wrong when a
  receptionist is juggling multiple counters.

## 7. Extra features and why they matter beyond the core brief

- **Voice announcement (Web Speech API)** on the patient screen reads
  out "Token number 14, [name], please proceed to the consultation
  room" the instant a new token is called — directly mirrors how real
  hospital queue systems work, and helps patients who aren't actively
  staring at the screen.
- **Doctor Dashboard** — a third screen addressing the brief's own
  observation that "doctors have no dashboard." Shows patients seen
  today, current waiting count, live average consult time, and
  no-show count, all from the same real-time state.
- **QR code on patient add** — generates a link straight to
  `patient.html?doctor=X&token=N`, so a patient can scan once and
  auto-track their exact token without typing it in manually.
- **Multi-doctor/counter isolation** — proves the architecture scales
  beyond a single front desk to a real multi-doctor clinic, which is
  closer to the actual 1.5 million clinics referenced in the brief.
- **Dark mode** — persisted via `localStorage`, useful for waiting
  room displays running for long hours under variable lighting.
- **Animated token transitions + skeleton loading states** — small
  polish details that make the live-sync demo *feel* instant and
  professional rather than just functionally correct.

## 8. What I'd add with more time

- Persist state to a free-tier database (e.g. MongoDB Atlas free
  cluster) so a server restart doesn't wipe the day's queue across all
  doctors.
- SMS/WhatsApp notification when a patient is 2 tokens away (would
  need a free-tier API like Twilio trial or WhatsApp Cloud API).
- Authentication on the receptionist and doctor screens so randoms
  can't hit `/receptionist.html?doctor=doc1` and call patients for a
  clinic they don't work at.
- A receptionist-facing list of all currently active doctor IDs/rooms
  (right now you have to know the ID to switch to it) — e.g. an admin
  view that shows every doctor with patients waiting.
