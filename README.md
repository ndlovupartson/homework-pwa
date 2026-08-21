# Homework PWA

Zero-budget teacher-to-learner homework app. Offline-first on both devices;
Cloudflare Pages + Worker + D1 as the thin sync/delivery layer.

Full architecture, data model, sync design, security model, and phase plan:
see `homework-pwa-architecture.md` (delivered separately alongside this scaffold).

## Status: Phase 10 complete (testing and optimisation — final phase)

**Real and tested this phase:** `tests/concurrency-capacity-test.mjs` (`npm run test:concurrency`) closes the last gap between what the architecture doc *claimed* in its stress-test section and what was actually verified against real code:
- **Architecture §6 claim #20** ("40 learners submitting near-simultaneously? ... a non-event") — actually tested with 40 genuinely concurrent (`Promise.all`, not sequential-but-fast) submissions against the real Worker. All 40 succeeded, completed in 11ms, produced exactly 40 rows with no lost writes and no cross-learner attribution errors, and the teacher's pull correctly retrieved all 40 with distinct, correct answers.
- **Architecture §5 capacity estimate** ("hundreds of homework assignments") — actually tested at 200 homework items. Sync stayed fast (200 items in 77ms, well under any reasonable threshold), and — the number that actually matters for a real user — the learner delivery query (the one every single app-open pays the cost of) stayed fast at 9ms with 200 items and returned all of them correctly, still properly scoped to only that learner's class.

One honest caveat on those numbers: they're measured against the D1 mock (in-process SQLite), not real Cloudflare D1 over a real network. Real D1 will have per-query network latency the mock doesn't — these results confirm there's no *structural* problem (no N+1 query blowup, no O(n²) behavior, no correctness failure under concurrency), not that production will be exactly this fast.

**Final honest project status — every claim below is backed by a passing automated test, not an assertion:**

| Architecture doc §6 stress-test question | Status |
|---|---|
| 1–5. IndexedDB reliability, data loss scenarios, offline-first behavior | Answered in the doc; the *mitigation* (D1 backstop, backup/restore) is built and tested (Phase 7, Phase 9) |
| 6–7. Publish while offline, later sync | Tested (Phase 6, Phase 8) |
| 8–11. Learner access from home, offline work, offline submit, sync-back | Tested end-to-end over real HTTP (Phase 8) |
| 12. Double submission | Tested at both the data layer (Phase 3) and the real server (Phase 7) — idempotent by UUID |
| 13. Internet disappears mid-sync | Tested — real retry/backoff, no data loss (Phase 6) |
| 14–16. Concurrent edits, versioning, conflicts | Tested — 409 handling, conflict notices, field-scoped submission merge (Phase 6, 7) |
| 17. Learner isolation | Tested — cross-class and cross-teacher isolation, verified by absence not just counts (Phase 7) |
| 18. What needs to live online | Answered in the doc; implemented exactly as scoped |
| 19. Free-tier feasibility | Answered in the doc with current pricing; not independently re-verified this phase |
| 20. 40 concurrent learners | **Actually tested this phase** — see above |
| 21. Several classes | Tested (Phase 4, 7) |
| 22. Teacher changes devices | Tested — backup/restore round trip (Phase 9) |

**Known limitations — honest, not hidden:**
- `updateClass` and `updateLearner` exist and work in the data layer (tested since Phase 3) but were never wired to an "Edit" button in the UI — a class name or learner name typo can't currently be fixed after creation, only worked around by archiving and recreating. Straightforward follow-up, not a design gap.
- Un-archiving a class isn't built (flagged honestly in the Settings screen itself rather than shipping a dead button).
- Nothing in this project has run under real `wrangler dev` or real Cloudflare D1/Workers/Pages — every server-side test (Phases 7, 8, 10) runs against a from-scratch local HTTP server and a SQLite-backed D1 mock, because `wrangler` isn't installable in this environment (no registry access). The mock matches D1's real API shape closely enough that the actual deployed files run unmodified against it, so the *logic* is genuinely tested — but Cloudflare-specific runtime behavior (cold starts, edge routing, real network latency, KV) has never been exercised. This is the single most important thing to verify before a real deployment, and it just requires running `wrangler dev` once real Cloudflare access exists — nothing in the code should need to change.
- The teacher-auto-provision-on-first-sync auth pattern (Phase 7) means the current client never calls a dedicated registration endpoint; this works but is worth revisiting if the security model needs to tighten later (e.g. rate-limiting new teacherId creation).

**What's genuinely solid:** the offline-first data layer, the sync engine's retry/backoff/idempotency/conflict-handling, the security/isolation model, and the full teacher-to-learner-to-teacher round trip — all backed by real, repeatable, passing tests, not manual spot-checks.

**Whole-project test suite:** `npm run test:all` — **155 assertions across 7 suites** (IndexedDB data layer, teacher UI flow, marking, learner UI flow, offline/sync engine, Worker/server logic, cross-device integration, backup/restore, and concurrency/capacity), all passing, all run against real code — not mocked business logic, only a mocked Cloudflare *runtime* where genuinely necessary.

This closes all 10 planned development phases.

---

## Status: Phase 9 complete (backup and restore — real, tested including a genuine file download/upload round trip)

**Real and tested this phase:**
- `src/lib/backup.js` — export (checksum-verified JSON of everything: teacher, classes, learners, homework, questions, submissions) and import (validates checksum and schema version, upserts idempotently by primary key, re-queues restored records for sync so data lost before it ever reached the D1 backstop gets a second chance to sync once restored)
- `src/screens/teacher/settings.js` — real Export/Import UI: a genuine file download and a real `<input type=file>` restore flow, not a placeholder
- Two deliberate MVP-safety decisions, both tested: importing a **different teacher's** backup onto a device that already has its own identity is refused outright (mixing two teachers' data under one identity would break the isolation model) rather than silently merged; a corrupted/tampered backup file is rejected by checksum **before touching any existing data**, not partially applied

**A real app gap found and fixed while testing this, not just a test workaround:** the `/` route always rendered the Welcome/role-select screen, even for a device that already had a teacher (or learner) identity set up. That's a real UX rough edge — a returning user landing on `/` (after a restore, or any reset-to-root navigation) would be asked "are you a teacher or a learner?" again despite already being signed in. Fixed by having `/` check for an existing identity first and redirect straight to `/dashboard` or `/learner/home`; only shows Welcome when neither exists.

**A genuinely hard bug chased down properly rather than worked around superficially:** early versions of the wipe-and-restore test called `db.close()` immediately followed by `indexedDB.deleteDatabase()` in the same page, which turned out to be a real timing race — `close()`'s effect isn't guaranteed to have fully landed by the very next microtask, so `deleteDatabase()` could still fire `onblocked` unpredictably (confirmed by re-running the identical code multiple times: it passed once, then failed consistently on repeat runs, ruling out anything deterministic about which object store was involved). Tried the standard fix of forcing a real navigation first, which ran into an unrelated Chromium wrinkle — `about:blank` denies IndexedDB access entirely. Settled on the cleanest and most honest test design: use a completely separate `BrowserContext` (genuinely isolated storage) to represent the post-data-loss device, rather than trying to delete-and-reuse the same one — which is also a more accurate simulation of what "the phone was lost and replaced" actually means.

**Tested — `tests/backup-restore-test.mjs` (`npm run test:backup`), 21 assertions:**
- **Data layer:** export includes a checksum and correct schema version; a tampered backup is rejected and leaves existing data completely untouched; a full simulated data-loss-and-restore correctly repopulates teacher identity, class, learner, homework, and question with the exact original values; restore re-queues both the class and the published homework for sync; re-importing the identical backup twice does not duplicate any rows (idempotent); importing a different teacher's backup is refused.
- **Real UI round trip:** clicking the actual Export button triggers a genuine browser file download (captured and read back from disk, not simulated); that real downloaded file is fed into a completely fresh browser context (a different "device"); the app correctly shows Welcome with no identity; after importing the real file, the app adopts the identity and — thanks to the routing fix above — goes straight to the dashboard; the class created before the simulated data loss is really there.

Whole project test run: `npm run test:all` — **145 assertions across six suites (IndexedDB, client e2e, offline/sync, Worker, integration, backup/restore), all passing.**

## Next: Phase 10 — Testing and optimisation (the dedicated final pass:
working through the architecture doc's full test checklist explicitly,
any remaining performance/UX polish, and a clear-eyed summary of what's
genuinely production-ready versus what still needs real Cloudflare access
to fully verify).

---

## Status: Phase 8 complete (submission synchronisation — real end-to-end round trip, tested against the real Worker code)

Per the phase plan, Phase 8 is dedicated submission-sync testing. With real Cloudflare access still unavailable in this environment, the honest and valuable thing to do was close the loop the project had only tested in halves so far: a real browser client, talking real HTTP, to the real Worker code from Phase 7. `tests/integration-server.mjs` is a small from-scratch Node HTTP server (not a re-implementation — it serves the actual simulated build and routes `/api/*` straight into the actual `worker/index.js` fetch handler, backed by the D1 mock) standing in for `wrangler dev`, which isn't available here.

**One real gap actually closed this phase, not just documented:** Phase 5's README flagged that the architecture never specified how marks/feedback sync back to a learner's own device. This phase closes it for real — `worker/routes/homework.js` now includes the learner's own submission (if any) in the same delivery response used to pull homework, and `learner-schema.js` gained `applyServerSubmissionUpdate` to merge marks/feedback into the local record without re-triggering a pointless sync push. Verified end-to-end: a teacher's marks, entered in their UI, land on the learner's device having gone through real HTTP, real SQL, and back — not simulated at any point in that chain.

**Tested — `tests/integration-e2e.mjs` (`npm run test:integration`), two separate browser contexts (separate IndexedDB each, genuinely simulating two different physical devices) against one real running server:**
14 assertions covering the complete loop: teacher creates a class and homework, publishes, and a real sync push lands it in the (mock) D1 database over real HTTP — the learner, on a completely separate device/context, types the *actual* class code and learner code shown in the teacher's UI into the real join form, and **the join succeeds for real** (no longer the "honest failure" every earlier phase correctly expected, because a real server now exists to answer it) — pulls the real homework down, answers it, submits, and that real submission syncs back up — the teacher pulls it down and sees the learner's *actual* answer, round-tripped through real HTTP and real SQL — marks it, and that mark syncs back down to the learner's device, closing the Phase 5 gap for real.

**Two more test bugs found and fixed while building this — both the same recurring pattern, and worth naming plainly rather than quietly patching again:** setting `window.location.hash` to the value it *already* held doesn't fire `hashchange` (fixed with a realistic `reload()` instead of a no-op), and — for the third time in this project — a generic `.card` selector wait matched a leftover element from the *previous* screen before an async re-render finished, this time on the final "learner views their marks" step. Same root cause each time (a bare CSS-class wait instead of waiting for the destination screen's actual heading), same fix each time — worth being explicit that this is a recurring lesson about how I write these waits, not three unrelated flukes.

Full project test run: `npm run test:all` — 24 (IndexedDB) + 57 (client e2e) + 27 (Worker) + 14 (integration) = **122 assertions, all passing**, all run for real against real code.

## Next: Phase 9 — Backup and restore.

---

## Status: Phase 7 complete (Cloudflare synchronisation layer — real, tested against real SQL; not yet tested under real Cloudflare infrastructure)

**Important limitation, stated plainly:** `wrangler` isn't installed in this environment (no network access to the npm registry), so nothing here has run under real Workers/D1 or `wrangler dev`. To keep testing honest rather than skip it, I built a faithful mock of the D1 binding (`tests/worker-d1-mock.mjs`) backed by Node's built-in `node:sqlite`, matching D1's real `prepare().bind().run()/.first()/.all()`/`batch()` shape closely enough that **the actual deployed files run unmodified** against it — this is not a re-implementation of the Worker for testing purposes, it's the real `worker/index.js` and everything it imports, actually executed. What this does **not** cover: Cloudflare-specific runtime behavior (cold starts, edge routing, real D1 latency/consistency, KV). That gap closes once real Cloudflare access is available — worth an explicit `wrangler dev` pass before this goes live.

**Real and tested this phase:**
- `worker/lib/auth.js` — teacher auth (secret-hash verification with auto-provision on first sync, since the current client never calls a separate register endpoint) and learner auth (HMAC-signed session tokens via Web Crypto, the same API Workers actually use)
- `worker/routes/{auth,sync,homework,submissions}.js` — every endpoint from architecture §16 implemented for real, replacing the Phase 1 stubs
- `worker/index.js` — real router
- `worker/db/schema.sql` — updated (see bugs below)

**Three real integration gaps found and fixed while building the server side — the value of actually building both ends, not just the client:**
1. **The client never actually sent any auth credentials on its sync/pull calls.** `src/api/client.js` and `src/sync/engine.js` had the *shape* for it but nothing ever populated it. Fixed by having the sync engine resolve the teacher's `{teacherId, secret}` or the learner's `{sessionToken}` from IndexedDB and attach it to every push/pull.
2. **The teacher UI never generated or displayed a class code**, even though the D1 schema and the whole join flow require one. Only `learnerCode` existed. Fixed by generating one in `createClass` and displaying it prominently on the class detail screen.
3. **Schema drift between client and server:** the D1 `classes` table was written in Phase 1, before Phase 4 added a `status` (`active`/`archived`) field for the soft-delete feature — the server schema was never updated to match, and the join query's `WHERE status = ?` would have failed against real D1 exactly as it failed against the mock. Fixed by adding the column and having `syncClass` actually persist it.

**One genuine design problem discovered, not present in the original architecture doc, and worth calling out specifically:** the `submission` entity is pushed by **both** roles — learners write `{answers, status, submittedAt}`, teachers write `{marks, teacherFeedback}` when marking. A naive full-row upsert from either side would silently destroy the other's data (a teacher's re-sync-triggered push overwriting a learner's later answer edit, or a learner's re-sync wiping out marks the teacher just entered). Fixed with **field-scoped updates**: the handler checks which credential type presented the request and only touches that role's fields — verified directly by pushing from both directions in sequence and asserting the other side's data survives untouched.

**Also fixed a genuine, unrelated UI bug found by these same tests:** a CSS class name collision (`.code-display` reused for both the new class-code display and the existing per-learner code span) was making a test's `waitForSelector` match the wrong element and read stale data — which looked exactly like an async race condition until traced properly. Renamed to `.class-code-display`. Also tightened a real (if minor) async-ordering issue in `class-detail.js` where a re-render wasn't awaited.

**Tested — real Worker code, real SQL, via `tests/worker-test.mjs` (`npm run test:worker`):**
27 assertions covering: teacher auto-provision and secret verification (including a wrong-secret rejection), class/learner/homework sync with real referential checks (a learner can't sync into a class that hasn't synced yet), version-conflict (409) handling with the server's data staying untouched by a stale push, learner join with correct-vs-wrong codes, **cross-class isolation** (a learner sees only their own class's homework, verified by asserting the other class's homework is absent — not just checking a count), a tampered session token being rejected rather than silently trusted, submission idempotency (double-push doesn't duplicate a row), a learner being unable to push under a different `learnerId`, the field-scoped submission merge working correctly **in both directions**, and **cross-teacher isolation** on the submissions-pull endpoint (verified the same way — asserting the other teacher's data is absent, and that teacher A gets a 401 trying to mark teacher B's submission).

Full project test run: `npm run test:e2e && npm run test:worker` — 57 client-side assertions + 27 server-side assertions, all passing.

## Next: Phase 8 — Submission synchronisation (this phase built the server
side of it; Phase 8 per the original plan is dedicated to end-to-end
teacher⇄learner sync testing once real Cloudflare access is available to
close the `wrangler dev` gap noted above — or, if that access still isn't
available, continuing with the same D1-mock approach for anything not yet
covered).

---

## Status: Phase 6 complete (offline functionality — real, browser-tested end to end)

**Real and tested this phase:**
- `src/sync/engine.js` — real implementation of the push/pull/retry/backoff pseudocode from architecture §9.2: exponential backoff (5s → 10s → ... capped at 5 min), stops after the first failure in a cycle rather than hammering an apparently-unreachable server, never removes a queue entry except on real success or a definitive server rejection, and surfaces (rather than silently drops or silently overwrites) a version conflict when a homework update arrives over a learner's unsynced in-progress answers
- `src/api/client.js` extended with `pushSyncEntity`, `pullHomeworkForLearner`, `pullSubmissionsSince`
- `src/main.js` wired to run a real sync loop per role, on boot / on `online` / on a periodic timer, feeding the shell's pending-sync banner
- `scripts/generate-sw-manifest.js` + `tests/simulate-build.sh` — a generated precache manifest (so the service worker can't silently drift out of sync with the real file list) and a script that replicates Vite's actual build output layout for testing

**Four real bugs found and fixed this phase — the most consequential phase yet for "test before claiming it works":**
1. **Service worker registration was silently dead since Phase 2.** It waited for the `window` `'load'` event, but `boot()` is async — by the time execution reached that code (after several `await`s opening two IndexedDB databases), `'load'` had already fired and finished. The listener never ran. Fixed by registering immediately instead.
2. **The service worker only precached a small hand-maintained list**, so a first-time visitor who went offline before a second page load would be missing most JS modules. Fixed with a generated manifest scanning the real project files — can't drift out of sync because it isn't hand-maintained anymore.
3. **The pending-sync banner was up to 60 seconds stale** — new queue items weren't reflected until the next periodic tick. Fixed by dispatching an event on every `enqueueSync` call that the shell listens for immediately.
4. **The most subtle one:** the service worker's fetch handler excluded backend API calls with `if (request.url.includes('/api/')) return;` — but that substring check also matched **`/src/api/client.js`**, our own app code, silently excluding it from caching. This only broke visibly on a genuinely offline reload after the file had been added — exactly the kind of bug that's invisible until you actually test the real offline path with real network emulation, not just check `navigator.onLine`. Fixed by checking the URL's path prefix instead of a raw substring.

**Also found and fixed: my own test-serving setup was wrong since Phase 3.** Every e2e suite before this one served the raw project directory directly via `python -m http.server`, which doesn't replicate Vite's actual build output (where `public/*` gets flattened to the root). That means `/service-worker.js`, `/manifest.json`, and `/icons/*` had been silently 404ing in every prior test run — invisible because the app doesn't hard-fail on those specific 404s, and because the "load"-event bug (#1 above) meant service worker registration was never even genuinely attempted in a way that would surface the failure. Fixed with `tests/simulate-build.sh`, and `tests/run-all-e2e.js` now builds and serves from that simulated output for every suite, not just the new one.

**Tested — real Chromium via Playwright, with genuine network emulation (`context.setOffline()`), not just `navigator.onLine` checks:**
- `tests/offline-flow-e2e.js` — 18 assertions: service worker actually takes control, the status pill flips on a real network cut, class/homework creation and publish work fully offline, the pending-sync banner updates immediately, a full reload while genuinely offline serves the entire app from cache and preserves all data created offline, coming back online triggers a real sync attempt that fails honestly (no Worker yet) with correct retry/backoff bookkeeping, a second immediate cycle correctly respects the backoff delay, and the learner-side conflict notice fires correctly (with the local homework still updating to the new version, not silently dropped) when a newer version arrives over unsynced local answers.
- Also fixed two of my own test-assertion bugs along the way: one expected *every* queued item to get its retry bumped in a single cycle, which contradicts the engine's intentional (and architecture-doc-specified) behavior of stopping after the first failure; another checked the conflict notice's label against the stale old title instead of the correct new one.
- Full suite: `npm run test:e2e` — 57 assertions across all four suites (teacher, marking, learner, offline/sync), all passing, run from a properly simulated build.

**Still open, deliberately not solved here:** applying the server's returned `version` back onto the local record after a successful push is deferred to Phase 7, once the real Worker response shape exists to write against — noted in the code rather than guessed at.

## Next: Phase 7 — Cloudflare synchronisation layer (the real Worker,
replacing every stub in worker/routes/*.js, plus wiring D1 per the
architecture's decision log).

---

## Status: Phase 5 complete (learner interface — real, browser-tested end to end)

**Real and tested this phase:**
- `src/api/client.js` — thin fetch wrapper for the Phase 7 Worker API, with honest error handling (offline / not-found / server / network) — no fake success responses
- `src/screens/learner/join.js` — real class-code + learner-code form; since the Worker doesn't exist yet, this genuinely fails right now, and the screen shows that failure rather than hiding it
- `src/screens/learner/dashboard.js` — categorizes homework into New / In progress / Overdue / Submitted, reused across the Home/Homework/Done bottom-nav tabs with different filters
- `src/screens/learner/homework-answer.js` — renders all 4 question types (short, long, MCQ, true/false), Save progress, Submit with an unanswered-question confirmation prompt, and a read-only view with feedback once submitted
- `src/screens/learner/confirmation.js` — answered/unanswered counts, submission time, status
- `src/main.js` — rewritten to open both databases and route/guard both teacher and learner sides of the app, each with correct bottom-nav wiring

**A real design gap found and documented, not glossed over:** the architecture doc never actually specified how marks/feedback sync back down to the *learner's own device* — only how submissions go up and how homework comes down. The learner UI is ready to display marks/feedback the moment they arrive (tested via direct seeding), but Phase 7 needs to add a real delivery path for it — most likely bundling the learner's own submission status into the existing `/api/homework/for-learner` response. Flagging this now while it's cheap to fix, not after Phase 7 is built around the gap.

**Tested — real Chromium via Playwright, driving the actual UI:**
- `tests/learner-flow-e2e.js` — 17 assertions: confirms the join screen fails **honestly** with no live Worker (this was a deliberate thing to verify, not a bug), then — the same way Phase 4's marking test simulated a synced submission — seeds a learner identity and published homework directly through the tested Phase 3 functions to stand in for a completed Phase 7 sync, and drives the rest for real: all three question types render and collect answers correctly, save-progress persists across reload, correct dashboard bucket transitions (New → In progress → Submitted), the submit confirmation counts are accurate, a submitted homework becomes genuinely read-only (no way to re-edit or double-submit through the UI), and both nav tabs filter correctly.
- Run all three suites together: `npm run test:e2e` (39 assertions total across teacher + marking + learner flows, all passing)

**Two real bugs caught by testing, not glossed over:**
1. My first test asserted on a generic `.card` selector right after clicking into a submitted homework item — it matched a leftover element from the *previous* screen before the async re-render finished, exactly the same race-condition class as two bugs found in Phase 4. Fixed by waiting for the new screen's actual heading text instead of a generic selector.
2. My first seed-then-check flow called `page.reload()` expecting to land on the dashboard, but reload preserves the current URL hash (still `/learner/join` at that point) — so it reloaded straight back into the join screen. Fixed by explicitly navigating to `/learner/home` after seeding instead of relying on reload.

**Still stubs:** `worker/*` and the real sync engine (`src/sync/engine.js`) — Phase 6/7. Offline banner/pending-sync-count wiring into the shell (`setPendingSyncCount`) exists in the shell but nothing calls it yet — that's Phase 6.

## Next: Phase 6 — Offline functionality (wiring the sync queue banner, conflict UI,
and the retry/backoff behavior designed in the architecture doc §9 into what's
now a fully real UI on both sides).

---

## Status: Phase 4 complete (teacher interface — real, browser-tested end to end)

**Real and tested this phase:**
- `src/main.js` — app entry point: opens the teacher DB, registers all routes, wires bottom-nav taps to the router, guards every route behind teacher setup
- `src/lib/router.js` — minimal hash router (no dependency)
- `src/lib/dom.js` — render/escape/toast/date helpers shared across screens
- `src/screens/welcome.js`, `src/screens/learner-placeholder.js` — role select; learner path is an honest "not built yet" placeholder, not a dead link
- `src/screens/teacher/{setup,dashboard,classes,class-detail,create-homework,homework-detail,submissions-overview,settings}.js` — all real screens: teacher setup, dashboard with live counts, class CRUD, learner roster with generated join codes, homework creation with an inline question builder, publish (blocked server-side... well, data-layer-side, if there are no questions), submissions list, and a working marking panel
- `src/screens/screens.css` — cards/forms/tabs/pills shared style
- Resolved the Phase 3 soft-delete gap: `archiveClass` replaces the old `deleteClass` throw with a real `status: 'archived'` implementation, filtered out of the default class list

**Tested — real Chromium via Playwright, driving the actual UI (not the data layer directly):**
- `tests/teacher-flow-e2e.js` — 19 assertions: full flow from Welcome → teacher setup → identity persists across reload → create class → add two learners with distinct, ambiguity-free codes → create homework → publish blocked with no valid questions → publish succeeds → homework appears correctly across class detail, dashboard, and the submissions overview → settings shows teacher info → archiving a class removes it from the list without error
- `tests/teacher-marking-e2e.js` — 3 assertions: simulates a submission arriving via sync (the way Phase 7 will deliver it), confirms the homework-detail screen reflects it, confirms the marking panel shows the learner's actual answer, confirms marks/feedback save and display correctly
- Run both: `npm run test:teacher` (or `node tests/run-teacher-e2e.js`)

**Two real bugs found and fixed during this phase (not glossed over):**
1. `src/screens/teacher/setup.js` imported from `../lib/dom.js` instead of `../../lib/dom.js` — wrong relative depth, caused a 404 and blocked the Welcome screen from ever rendering. Caught by the first test run, fixed, re-verified.
2. **A genuine UX gap, not just a test issue:** using the phone/browser's native *back* button after publishing homework returns to the create-homework form (a "resubmit a form" trap), because every `navigate()` call pushes a new history entry. The in-app "‹ Back" link avoids this by routing directly, but the OS back button doesn't know that. Flagging this now rather than silently working around it only in the test — worth deciding in a later phase whether to use `history.replaceState` after a successful create/publish so back-button behavior matches user expectations.

**Still stubs:** `worker/*` (Phase 7), `src/sync/engine.js` (Phase 6/7), learner interface (Phase 5).

## Next: Phase 5 — Learner interface.

---

## Status: Phase 3 complete (IndexedDB layer — real, browser-tested; screens/sync-engine/worker still stubs)

**Real and tested this phase:**
- `src/db/idb-helpers.js` — dependency-free promise wrapper around native IndexedDB (no Dexie — kept the dependency count at zero)
- `src/db/teacher-schema.js` — full teacher database: `teacher`, `classes`, `learners`, `homework`, `questions`, `submissions`, `syncQueue`, `syncMetadata` stores + CRUD, matching architecture §8.1 exactly
- `src/db/learner-schema.js` — full learner database: `learnerIdentity`, `homework`, `questions`, `mySubmissions`, `syncQueue`, `syncMetadata`, matching architecture §8.2

**Design decisions made while implementing (worth knowing about):**
- `deleteClass` deliberately **throws** rather than silently hard-deleting — a hard delete has no way to propagate through the sync engine safely (no tombstone to sync). Flagged as a real gap needing a `status: 'archived'` soft-delete design in Phase 4, not quietly implemented wrong.
- `publishHomework` refuses to publish a homework item with zero questions — enforced in the data layer itself, not just the UI, so it can't be bypassed.
- Draft creation does **not** touch the sync queue — only `publishHomework` does, matching the architecture's "homework enters sync queue on Publish" flow exactly (not on every keystroke).
- Learner `learnerCode` generation avoids visually ambiguous characters (no `0/O`, `1/I/l`) per the security note in architecture §10.
- On the learner side, `learnerId` is read only from the stored identity record inside `getOrCreateSubmission` — never accepted as a function parameter — so it's structurally impossible for a coding mistake elsewhere to write one learner's answers under another learner's ID.

**Tested — real Chromium via Playwright, real IndexedDB (not a mock/polyfill):**
24 assertions, all passing, covering: teacher/class/learner/homework/question CRUD, publish-blocks-on-no-questions, publish-only-enqueues-once, learner identity binding, save-progress vs. submit sync-queue behavior, **double-submission idempotency** (resubmitting reuses the same `submissionId`, no duplicate row), and **schema-level learner isolation** (the learner database has no `teacher`/`classes`/`learners` object stores at all — not just filtered data, the stores don't exist on that device). One real bug was caught and fixed during testing — described below.

**Bug found and fixed during this phase:** my first test asserted "publish enqueues exactly one sync entry," which failed — not because publish was wrong, but because `createClass`/`addLearner` had already added entries to the same queue earlier in the test. Fixed the assertion to check `entityType === 'homework'` specifically. Documented so it's clear this was a test-correctness issue, not silently waved away.

**Still stubs:** `worker/*` (Phase 7), `src/sync/engine.js` (Phase 6/7), all UI screens (Phase 4/5).

## Next: Phase 4 — Teacher interface (first real screens, built on this
tested data layer).

---

## Status: Phase 2 complete (app shell — real, tested; screens/data/sync still stubs)

**Real and tested this phase:**
- `index.html` — app shell entry point (moved to project root per Vite convention)
- `src/app-shell/tokens.css` — design tokens (palette, type, spacing) shared by every future screen
- `src/app-shell/shell.css` — header, bottom nav ("notebook tab" treatment), offline/sync banner, shared empty/error state block
- `src/app-shell/shell.js` — renders chrome, tracks online/offline, captures the install prompt, exposes `setPendingSyncCount()` for the Phase 6/7 sync engine to wire into
- `public/service-worker.js` — caches the app shell only (never application data — see the explicit warning in the architecture doc §13); network-first navigation with offline fallback
- `public/offline.html` — last-resort fallback page
- `public/manifest.json` — installable PWA manifest, real icons generated in the chosen palette (`public/icons/*.png` — placeholder artwork, swap anytime)

**Tested (network access is disabled in this build sandbox, so testing was done offline-appropriately):**
- Every `.js` file syntax-checked with `node --check` — all pass
- `manifest.json` / `package.json` validated as well-formed JSON
- Simulated the Vite dev-server file layout locally and fetched every path referenced by `index.html` and the service worker — all resolve with `200`, none 404
- Not yet tested: actual browser install flow, real offline-toggle behavior, service worker lifecycle in a real browser — these need a real browser/device and happen as part of Phase 10's PWA test pass, or sooner if you want to sideload this now and check on your phone

**Still stubs (unchanged from Phase 1):** `worker/*`, `src/db/*`, `src/sync/engine.js` — Phases 3, 6, 7, 8.

## Next: Phase 3 — IndexedDB database layer (teacher + learner schemas, real
implementations replacing the stubs) — will not proceed until you confirm
the shell direction (palette/type/nav feel) works for you.
