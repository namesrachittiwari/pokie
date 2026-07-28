# Pokie — frontend ↔ backend contract

What each screen consumes. Build the backend to this and the frontend wires up
with zero reshaping. All endpoints JSON over HTTPS, auth via bearer token
(single user). Base URL configurable, e.g. `https://api.rachittiwari.com/pokie/v1`.

## REST

| Endpoint | Verb | Serves screen | Shape (essentials) |
|---|---|---|---|
| `/me` | GET | rail, chat | `{ name, role, city, trustLevel: {label, pct, note} }` |
| `/beliefs` | GET | onboard, memory | `[{ id, group: identity\|preference\|learned, text, source, guessed?: bool }]` |
| `/beliefs/:id` | PATCH / DELETE | onboard, memory | DELETE cascades inferred beliefs; response lists what else was forgotten |
| `/bar` | GET / PUT | onboard | `{ criteria: [{key, hard, values[]}], dealbreakers[] }` |
| `/permissions` | GET / PUT | onboard | `{ apply\|draft\|send\|book\|screen\|cv: 0=never 1=ask 2=auto }` |
| `/jobs?mode=picks\|all&filters=…&sort=…` | GET | jobs | `[{ id, role, company, stage, city, compMin, compMax, compVerified, score, state, note, warmPath?, postedDays, domain, dropped?, dropReason? }]` |
| `/jobs/:id` | GET | jobs detail, job | above + `{ read, scoreBars: [{label,value}], signals: [{ok, text}], warmPath: {name, context}, posting: {raw, url}, cvVariantId, openQuestion }` |
| `/jobs/:id/apply` | POST | jobs | `{ mode: pokie\|self }` → returns `{ actionId, undoableUntil }` |
| `/jobs/:id/skip` | POST | jobs | body `{ reason? }` — feeds learning |
| `/decisions` | GET | approve, brief | `[{ id, kind, title, sub, age, draft?, expiresAt }]` |
| `/decisions/:id/approve` | POST | approve | body `{ teach: [ruleIds], note? }` → `{ actionId, undoableUntil }` |
| `/decisions/:id/reject` | POST | approve | body `{ teach, note }` |
| `/drafts/:id` | GET | approve, decide | `{ subject, words, readSeconds, lines: [{text, sourcedFrom?}], why: [{kind, text}], sources[] }` |
| `/cv/versions` | GET | cvlab | `[{ id, name, note, replyRate }]` |
| `/cv/versions/:id/diff` | GET | cvlab | `[{ op: add\|cut\|rewrite\|rejected, text, why }]` |
| `/history?tab=all\|pokie\|undoable` | GET | history | `[{ id, at, actor: pokie\|you, text, detail, action: undo\|review\|inspect, undoableUntil? }]` |
| `/history/:id/undo` | POST | history | 410 once the undo window lapses |
| `/onboard/cv` | POST (multipart) | welcome | uploads CV → `{ beliefs[] }` streamed or polled |

## Streams (SSE — `text/event-stream`)

`GET /runs/live` — the Live run screen. Events:

```
event: run          data: { id, sweepNo, startedAt, sourceCount, stepNo, stepTotal, state: running|paused|done }
event: step         data: { index, mark: done|current|pending, text, detail, duration }
event: counters     data: { scanned, clearedBar, scored85, needsYou }
event: thought      data: { text }                      # "current thought" card — plain language, always
event: interjected  data: { text, stepAppended }        # echo of POST /runs/live/interject
```

`POST /runs/live/interject` body `{ instruction }` — appends a step mid-run.
`POST /runs/live/pause` · `/resume` · `/stop`.

## Rules the backend must keep (from the handoff)

- **Permission matrix consulted before every outbound action** — no send/apply
  without checking `/permissions` state at execution time.
- **Undo is real and expires** — sent mail 30 min; expired undo returns 410 and
  the frontend hides the button.
- **Cascade forget** — deleting a belief deletes everything inferred from it,
  and the response names the casualties so the UI can show them.
- **Provenance on every belief** — `source` is required, human-readable.
- **Teach chips write rules** — approving with chips creates entries in
  `learned` beliefs, which `/beliefs` then serves to Memory.
- **Agent progress is never a bare spinner** — `/runs/live` must always have a
  fresh `thought` event within ~5s while running.
