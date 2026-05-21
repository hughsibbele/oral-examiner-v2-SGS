# Oral Examiner — Remediation Plan

Strategic plan to address the structural bugs surfaced by the 2026-05-21 multi-agent code review (audits covered: quota/reservation/refund, exam-session state machine + RLS, audio + transcript scrubbing PII, Canvas card + roster sync, auto-save + server-action errors, cross-system seams).

The audits identified five recurring root causes. Almost every individual bug maps to one of them. Patching point-by-point would leave the patterns intact; the same shape of bug would re-appear in the next feature. This plan groups fixes by structural theme so each phase eliminates a *class* of bugs.

## Status (as of 2026-05-21)

The critical path (Phases 0 → 1 → 2 → 3) shipped on 2026-05-21. See `BUILD_PLAN.md` M6.19 for the per-phase commit refs and which audit findings each phase closes.

| Phase | State | Commit |
|---|---|---|
| 0 — Stop the PII bleed | Done | OE `9dc96db` |
| 1 — Snapshot semantics + atomic start | Done | OE `8828428` + migration `20260521120000` |
| 2 — State fences + idempotency | Done | OE `d37bd8d` |
| 3 — Stale-session sweep | Done | OE `24eb257` |
| 4 — Auto-save rewrite | Pending | — |
| 5 — Canvas client robustness | Pending | — |
| 6 — Roster sync correctness | Pending | — |
| 7 — Polish | Pending | — |
| 8 — Infrastructure hardening | Pending | — |
| 9 — Verification + observability | Pending | — |

Phases 4–9 are independent of each other and of the shipped critical path; pick any order. Open questions for the relevant phases are still captured at the end of this doc.

## Recurring root causes

1. **No snapshot semantics.** Sessions hold FK references to template / preset / roster / binding. Editing any of those mid-exam or after eval changes what an exam means retroactively. Auto-save makes mid-flight edits trivial.
2. **No state fences on UPDATEs.** `endExamSession`, `flushTranscript`, the reservation update all write without `.eq("state", expected)` guards. Concurrent calls and stale callers freely transition rows backward.
3. **No transactional boundaries across subsystems.** Install card = Canvas PUT + binding upsert (non-atomic). Start exam = classify + archive + insert (race-prone). End exam = update + refund + Inngest send (double-fires).
4. **Fail-open instead of fail-closed.** Empty roster → scrub becomes no-op, raw PII written. Missing salt → garbage tokens, scrub silently wrong. Missing binding → resolve returns `no_binding` but scrub on a still-running session silently degrades.
5. **No retry / idempotency semantics.** Double-click on Start mints two billable Gemini tokens. Double-end refunds twice. visibilitychange + button collide.

## Strategic shape

| Theme | Phase | Root cause it kills | Bug count addressed |
|---|---|---|---|
| Stop the PII bleed | **0** | Fail-open scrub | 1 critical |
| Snapshot semantics | **1** | FK-not-snapshot drift | ~6 high/critical |
| State fences + idempotency | **2** | UPDATEs without state guards | ~5 high |
| Stale-session sweep | **3** | No server-side cutoff | 1 high + paper cuts |
| Auto-save rewrite | **4** | Concurrent-save scramble | 1 critical + several |
| Canvas client robustness | **5** | Atomicity + 429 + scope | ~6 high/medium |
| Roster sync correctness | **6** | Departed + salt drift | 2 high/medium |
| Polish + small risks | **7** | Misc | ~10 medium/low |
| Infrastructure hardening | **8** | Rename / webhook drift | ~2 medium |
| Verification + observability | **9** | Future regression | enabling |

Sequencing principle: anything FERPA-shaped first; then schema enablers; then code that depends on schema; then parallel cleanup tracks.

## Dependency graph

```
Phase 0 (PII fail-closed) ─┐
                           │
Phase 1 (snapshot RPC + schema) ──┬─► Phase 2 (state fences)
                                  │
                                  └─► Phase 3 (sweep cron)

Phase 4 (auto-save) ───────────── parallel, independent
Phase 5 (Canvas client) ────────── parallel, slight overlap with Phase 1's binding-scope fix
Phase 6 (Roster sync) ──────────── parallel, light overlap with Phase 1 (course_rosters touch)

Phase 7 (polish) ───────────────── after 1+5+6 to avoid re-touching files
Phase 8 (infra) ────────────────── any time
Phase 9 (verification) ─────────── last; codifies invariants
```

---

## Phase 0 — Stop the PII bleed

**Why first:** unscrubbed student names landing in DB and reaching Gemini text reasoning is the only FERPA-shaped finding. Every other bug is recoverable; this one isn't.

**Scope** (one PR):
1. `lib/exam/scrub.ts`: when `loadRosterForCanvasAssignment` returns `[]` OR errors, throw — not return `[]`.
2. `lib/exam/student-actions.ts`: `flushTranscript` and `endExamSession` catch the throw, return `{ error: "roster_missing" }`, do NOT write transcript.
3. `StudentLiveSession.tsx`: surface `roster_missing` to the student as "We can't save your transcript right now — please tell your teacher." (rare enough that any UX is fine; current behavior is the wrong tradeoff).
4. `evaluate-exam.ts`: refuse to run if `transcript` is empty OR if a new `scrub_status` column is `'failed'`.

**Verification:** delete a `course_rosters` row in staging, run a flush → confirm no DB write + UI error. Spot-check production `exam_sessions.transcript` rows for unscrubbed names via a regex query against the roster.

**Risk:** Low. Worst case: flushes start failing for legitimate sessions if the roster isn't synced. Acceptable — fail loud is the goal.

---

## Phase 1 — Snapshot semantics + atomic start

**Why:** sessions hold FK references to template / preset / roster / binding. Editing any of those mid-exam or after eval changes what an exam means retroactively. This is the structural fix that unlocks Phases 2, 3, and parts of 5.

**Schema migration** (additive, backward-compatible):
```sql
alter table exam_sessions
  add column eval_prompt_body_snapshot text,
  add column rubric_body_snapshot      text,
  add column persona_name_snapshot     text,
  add column roster_snapshot           jsonb,
  add column scrub_status              text default 'ok'
    check (scrub_status in ('ok','failed','skipped'));

alter table exam_sessions
  drop constraint exam_sessions_exam_template_id_fkey,
  add  constraint exam_sessions_exam_template_id_fkey
    foreign key (exam_template_id) references exam_templates(id)
    on delete restrict;

-- Same for personality_preset_id (replace SET NULL with RESTRICT to make
-- it consistent + impossible to violate the exactly-one CHECK).
```

**New RPC** `begin_exam_session(canvas_assignment_id, student_id)` SECURITY DEFINER:
- `FOR UPDATE` on prior session row for `(canvas_assignment_id, student_id)`
- Classify prior; archive if `short_attempt` to `'excluded'`
- Read template OR preset (whichever the binding points at)
- Read `course_rosters.students` for the binding's course
- INSERT new session row with all four snapshot columns populated
- Return the session UUID + classification

**Code changes:**
- `start-exam.ts`: replace the multi-step logic with one RPC call. Catch `23505` (unique violation) → friendly "you already have a session" redirect.
- `evaluate-exam.ts`: read `eval_prompt_body_snapshot`, `rubric_body_snapshot`, `persona_name_snapshot` — never re-fetch from `exam_templates` for eval.
- `scrub.ts`: read `roster_snapshot` from the session row, not `course_rosters`. Remove `loadRosterForCanvasAssignment`.
- `auth-token/route.ts`: see open question #1 below.
- `deleteTemplate` action: detect `ON DELETE RESTRICT` rejection → surface "this template has student sessions — archive instead" UX.

**Kills:**
- Empty-roster PII fail-open — bulletproof via snapshot
- Eval rubric mismatch (eval re-fetches live template) — snapshot is the contract
- Roster mid-sync leak — snapshot frozen at start
- Start-exam race — RPC + FOR UPDATE
- Template delete obliterates student work — RESTRICT + UX

**Verification:**
- Start exam → edit template's eval prompt → finish exam → verify eval uses the ORIGINAL prompt.
- Start exam → re-sync roster (delete a name from the JSONB) → continue exam → name still scrubbed.
- Double-click Start → verify one row inserted, one friendly error.
- Try to delete a template with sessions → blocked with helpful message.

**Risk:** High. Every exam start now goes through the RPC. Deploy to staging first, run end-to-end exam smoke tests, soak before prod.

---

## Phase 2 — State fences + idempotency

**Why:** retries, double-clicks, and visibilitychange + button collisions cause double-refunds, transcript-after-completion writes, two billable Gemini tokens. Fences make these idempotent.

**Scope:**
1. **`endExamSession`** (`lib/exam/student-actions.ts:144-220`):
   - UPDATE adds `.in("state", ["started","in_progress"])`. Check rows-affected.
   - If 0 rows: return `{ ok: true, already_completed: true }`. No refund. No Inngest send.
   - Refund + Inngest send become conditional on rows-affected > 0.
2. **`flushTranscript`** (`student-actions.ts:105-127`):
   - UPDATE adds `.in("state", ["started","in_progress"])` and `.eq("id", session_id)`.
   - Returns `{ ok: true, no_op: true }` if zero rows.
3. **Auth-token reservation update** (`auth-token/route.ts:325-328`):
   - Change to: `.update({ live_minutes_used: reservedMinutes }).eq("state", "started").eq("live_minutes_used", 0)`. Check rows-affected.
   - If 0 rows AND state was still `started`: return existing token's row data with 409 (refuse to mint a second token).
4. **`StudentLiveSession.tsx`:** at the top of `endExam()`, synchronously `clearInterval(flushTimerRef.current)` and null the ref BEFORE awaiting the recorder assembly. Closes the end-vs-flush race window.
5. **`markInProgress`**: stop fire-and-forget; await + surface error in UI (cheap; students wait <100ms anyway).

**Kills:** double-refund, end-vs-flush race, two-token mints on double-click, partly the abandoned-session wedge.

**Verification:**
- Network throttle → end-exam → see "completing…" → see "completed" once.
- Double-click Start → second click returns 409 or same token, only one Gemini auth call in network log.
- Submit-then-tab-switch → no duplicate flush.

**Risk:** Low. State fences are additive; worst case is rejecting some legitimate write that was previously silently succeeding twice.

---

## Phase 3 — Stale-session sweep + abandon refund

**Why:** without a server-side cutoff, abandoned sessions stay `started`/`in_progress` forever with reserved minutes. Phase 2 prevents new bugs from re-occurring; Phase 3 heals the existing wedged rows.

**Scope:**
1. New Inngest cron `sweep-stale-exam-sessions`:
   ```
   select * from exam_sessions
   where state in ('started','in_progress')
     and started_at < now() - interval 'HARD_MAX_MINUTES + 10 min'
   ```
   For each: archive to `'failed_resume'`, refund `live_minutes_used`.
2. On `/exam/[id]` page resolve: if prior session is `state='started'` AND `started_at` is past the grace window, auto-archive instead of trapping student at `/run`.
3. Backfill once: archive existing wedged rows (one-time SQL script).

**Kills:** abandoned-session wedge.

**Verification:** open exam tab → close before clicking Start → wait past grace window → verify row is archived + minutes refunded. Re-open exam → fresh session starts cleanly.

**Risk:** Medium. Wrong threshold = mass-archive of active sessions. Start with a very generous threshold (e.g. `HARD_MAX_MINUTES + 30 min`), watch staging, then tighten if conservative.

---

## Phase 4 — Editor auto-save rewrite

**Why:** the auto-save concurrency bugs are rated critical not because students suffer but because teachers lose edits silently. The current pattern is "correct under quiet typing, fragile under reality." Can ship in parallel with 1–3; zero overlap with student-flow code.

**Feature-flag this phase.** UI blast radius is high enough that a parallel-use period under a `useAutoSaveV2` flag is the right safety net.

**Scope** — rewrite `useAutoSaveForm` in `Primitives.tsx`:
1. **Per-tag status `Map<string, Status>`** instead of shared `setStatus`. Pill aggregates: "saving" if any saving; "error" if any failed (errors sticky); else "saved · Xs ago".
2. **In-flight save guard:** while a save is pending, mark a "trailing save pending" flag instead of dispatching. On in-flight completion, if trailing flag is set, dispatch immediately with current form data.
3. **Request-id matching:** each save gets a UUID. Server response carries it back. Client only updates `defaultValue` if response's request-id matches the latest save's id (drops stale responses).
4. **`defaultValue` re-baseline:** on save success, walk the form and set `el.defaultValue = el.value` / `el.defaultChecked = el.checked` / `select.options[i].defaultSelected = ...`. This is the documented invariant the codebase skipped.
5. **`AbortController` per save:** on navigation, abort in-flight saves; pill shows "discarded" briefly.
6. **Navigation guard:** if any tag has trailing save pending, `router.push` waits for flush (with a 2s timeout).
7. **`FlowBlock` depth state** synced via `useEffect(() => setDepth(values.follow_up_depth), [freshnessKey])`. Removes the bootstrap-prop race here.
8. **Bucket / question editors** converted to `useAutoSaveForm` for consistency, OR documented as button-driven with banner.

**Kills:** concurrent-save scramble, missing defaultValue re-baseline, navigation-aborts-save, FlowBlock bootstrap race, editor inconsistencies.

**Verification:** rapid type-and-tab across 4 blocks; tab-switch mid-save; navigate away mid-debounce; rotate between Persona/Flow/Eval. No stomps, no stuck pills, no React unmount warnings.

**Risk:** High UI blast radius — mitigated by the feature flag.

---

## Phase 5 — Canvas client robustness

**Why:** Canvas integration is where the install flow can leave UI in a broken state. Multiple findings cluster around the same Canvas client.

**Scope:**
1. **Teacher-scope binding lookups** — add `.eq("teacher_id", teacherId)` to `resolve.ts:75`, `scrub.ts:37`, `assignments/[aid]/page.tsx:94`. Add a unique constraint on `(teacher_id, canvas_assignment_id)` to make `.maybeSingle()` provably safe.
2. **Canvas 429 retry** — `canvasFetch` honors `Retry-After`, retries up to twice. `paginate` does the same. Surfaces 429 chain to UI only after retries exhausted.
3. **Friendly 401 errors** — generalize `getSelf`'s 401 special-case across all endpoints. Return a structured error: `{ kind: "canvas_token_expired", reconnectUrl: "/dashboard/canvas" }`. UI shows reconnect link.
4. **`hasExamCardBlock` regex robustness** — accept single-quoted `href='...'`, URL-encoded `%2Fexam%2F`. Add fixture tests for both.
5. **`installCardForAssignment` atomicity** — wrap in a Postgres function that does Canvas PUT then binding upsert; on binding failure, automatically PUT to remove the card. Or: do binding upsert FIRST as a pending row, Canvas PUT, then mark binding active. Rollback to remove the binding on Canvas PUT failure.
6. **`uninstallOralExamCard` always deletes binding** — current early-return at line 443 orphans the binding. Move the binding-delete OUT of the conditional.
7. **`setAssignmentAgent({agent: null})` sweeps live sessions** — archive `state IN ('started','in_progress')` sessions for that `canvas_assignment_id` before deleting binding. OR refuse the unassign if any are mid-flight.
8. **Bulk install timeout-safety** — process in chunks of 5, sleep 500ms between chunks, surface per-row results. (Vercel Pro: 300s; chunk size keeps us well under.)

**Kills:** cross-teacher binding hijack, Canvas 429 failures, install non-atomicity, uninstall orphan bindings, bare-card regex fragility, orphan-session-on-unassign, bulk install timeouts.

**Verification:** install → simulate binding insert failure → card is removed automatically. Bulk install 30 assignments → all succeed, no 429. Disconnect Canvas token → all UI shows "reconnect" link, not raw 401.

**Risk:** Medium. The atomicity change is the trickiest. Test compensating-action paths carefully.

---

## Phase 6 — Roster sync correctness

**Why:** roster correctness is the foundation of scrub correctness and sign-in identification.

**Scope:**
1. **Departure detection** — diff current roster vs new sync. Surface in UI: "X added, Y removed, Z still enrolled." Optionally: prompt before removing a student who has completed sessions.
2. **Departure handling for live sessions** — if a student's `auth_user_id` is no longer in the roster, their next `/exam/[id]` page shows "you're not on the roster" (already works). Existing in-flight sessions are NOT affected (snapshot from Phase 1).
3. **Anonymizer salt drift** — when `resolve.ts:124-134` detects a mismatch, fire an Inngest job that walks `course_rosters.students` and recomputes anon tokens, then re-runs scrub on completed sessions if their `scrub_status='ok'`. Or simpler: warn loudly + provide a "re-sync rosters" admin button.
4. **`skipped` surface** — list which students were rejected (no email vs invalid email) so teachers can chase Canvas permission issues.

**Kills:** stale-roster sign-in surprise, salt drift handling, skipped-count opacity.

**Verification:** withdraw a student in Canvas → re-sync → UI lists them as removed. Rotate salt → existing sessions still scrub correctly (anon tokens get updated; or warning loud enough to force action).

**Risk:** Low.

---

## Phase 7 — Polish + small risks

**Scope:**
- Rename `/exam/[token]` → `/exam/[assignmentId]` (cosmetic; do during a quiet window).
- Short-attempt retake abuse: add `attempt_count` column on the session-by-(assignment, student) view, cap at 2 retakes, OR move threshold to 30s + require `transcript IS NULL OR jsonb_array_length(transcript) < 2`.
- `resetExamSession` checks binding ownership, not cache.
- `swapPosition` → SECURITY DEFINER RPC with transaction.
- `cloneQuestionSetForTeacher` → wrapped in transaction.
- `updatePersona` returns per-field errors; auto-save shows field-level error and DOESN'T fail the whole bundle (or splits updates per-field).
- MediaRecorder all-MIME-fail → red banner: "Your browser doesn't support audio recording. Use Chrome 100+ or Safari 17+."
- Recording buffer: cap at 30MB in-memory; warn at 25MB; refuse to start if browser is low-memory (`navigator.deviceMemory`).
- AudioContext cleanup: explicit `isCleaningUp` guard.
- `evaluate-exam.onFailure`: defensive event-shape lookup with fallback + log.
- Refund RPC: change `p_minutes numeric` → `integer` to make the contract explicit; or migrate `live_minutes_used` to `numeric` to match the rest.

**Risk:** Low — file-local changes with small blast radii.

---

## Phase 8 — Infrastructure hardening

**Scope:**
1. **Inngest re-sync post-deploy hook** — Vercel deploy hook that `PUT`s `/api/inngest` after every prod deploy. Eliminates the documented gotcha for OE, HAH, HH simultaneously (one script in `scripts/`).
2. **"Re-install all cards" admin button** — for Vercel renames. Walks every binding for the current teacher, re-PUTs Canvas with current `NEXT_PUBLIC_APP_URL`. Document in the rename runbook.
3. **`super_grader_post_status` decision** — see open question #2 below. Either ship the webhook (M2b TODO) or drop the columns/enum.

**Daily-cap policy:** intentionally NOT included. AI Studio backend enforces spend limits, so the per-teacher cap on real exams isn't needed.

**Risk:** Low for #1, #2. #3 is a feature decision.

---

## Phase 9 — Verification + observability

**Why:** all the invariants we just enforced are at risk of regression in the next feature. Encode them.

**Scope:**
1. **Observability** — log via existing infra:
   - Scrub fail-closed events (count by reason)
   - State-fence rejections (count by action: end / flush / reserve)
   - Reservation clobber attempts (should be 0 after Phase 2)
   - Salt drift events
   - Inngest cron sweep counts
2. **PII canary** — a daily script that scans `exam_sessions.transcript` for any text matching real student names (via `course_rosters`). Alert on hits.
3. **Invariant doc** — extend OE's `CLAUDE.md` with a "Don't break these" section codifying:
   - Snapshot semantics (always read eval/rubric/roster from session snapshot, never live)
   - State-fence pattern for all `update({state:...})` calls
   - Teacher-scope on all binding lookups
   - Fail-closed scrub policy
4. **Regression test plan** — a checklist of manual smoke tests that exercise the bug paths.

**Risk:** Zero.

---

## Open questions to resolve before / during the relevant phase

1. **Phase 1 — auth-token snapshot purity.** Should the auth-token route read from `_snapshot` columns (full snapshot purity, no mid-session prompt edits) or from live template (so a teacher can hotfix a typo right after install, while eval still reads snapshot)? Asymmetry is convenient but worth a deliberate decision. *Status: unresolved.*

2. **Phase 8 — super_grader webhook.** The schema has `super_grader_post_status` enum + `super_grader_response` jsonb columns on `exam_sessions`, but no code path posts to super-grader. Options: (a) ship the webhook (M2b TODO from the original plan), or (b) drop the columns + enum so the data model stops implying queued work. *Status: unresolved.*

## Suggested triage order

If only the critical path is shipped, do Phases 0 → 1 → 2 → 3 in sequence. That alone calms most of the bugginess. Phases 4, 5, 6 are independent and can land any time. Phases 7, 8, 9 are cleanup / hardening to follow.
