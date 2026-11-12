# DocuChat v2 — Angular frontend

An Angular 19 frontend for DocuChat v2, the grounded document Q&A system in
this repo. DocuChat started as pipeline work I did at Capital Group; v2 is my
open rebuild of that pipeline (layout-native ingestion, FastAPI + Celery,
ChromaDB/Postgres, pluggable LLM layer, eval harness, feedback flywheel). The
Streamlit UI in `frontend/` still works — this is new work on that existing
rebuild: a real frontend for the same API, built to production standard
rather than as a demo skin.

What it does: upload a PDF, watch it ingest, chat with it (answers grounded
in the document, with citations — or an explicit "not in this document" when
nothing relevant is retrieved), generate a summary, and read usage stats from
the feedback flywheel's flight recorder.

## Run it

You need the backend running first (from the repo root):

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload   # http://localhost:8000
```

Then this app (Node 18.19+ / 20 / 22):

```bash
cd frontend-angular
npm install
npm start                            # http://localhost:4200
```

The API base URL lives in `src/environments/environment.ts`
(`http://localhost:8000` by default). The backend enables CORS for the
Angular dev origin — see `backend/main.py`. It also returns JSON 500s with
CORS headers on unhandled errors (the exception handler in the same file):
without it, a server error arrives in the browser as a CORS failure and the
frontend cannot tell it from a down backend. If you would rather proxy,
point `apiUrl` at `/api` and serve with `ng serve --proxy-config
proxy.conf.json`.

Chat and summarization need an answering LLM configured on the backend
(OpenAI / Anthropic key, or a local Ollama). Without one, the abstain path
still works end to end — ask something the document does not contain and you
get the grounded "I don't know" — but a question with relevant chunks fails
at the LLM call, and the UI shows that error instead of pretending.

```bash
npm run build                        # production build -> dist/
npm test                             # Karma + Jasmine, headless Chrome
```

Tests run in headless Chrome from the `puppeteer` devDependency
(chrome-headless-shell, downloaded on `npm install`), so `npm test` works
with no system Chrome. Set `CHROME_BIN` to use a local Chrome instead.
`angular.json` pins the test target to `"builderMode": "application"`: the
karma builder's default webpack mode expects the legacy `test.ts` entry
point, and with a custom `karma.conf.js` its test-discovery plugin is
absent — the combination silently runs 0 tests. Ask me how I know.

## Architecture

Standalone components only, strict TypeScript, `OnPush` everywhere, lazy
routes per page. No NgModules, no state library — the API is the state.

```
src/app/
  core/        ApiService (one typed method per endpoint), models.ts
               (interfaces mirroring backend/schemas.py), the error
               interceptor, JobPollingService, validators, drop-zone directive
  features/    documents/ chat/ summary/ stats/ — one lazy route each
  shared/      document-card, citation-list, chat-message, job-progress
```

Decisions I made, and why:

- **Signals for local UI state, RxJS for streams.** Selected document,
  messages, upload jobs live in signals — they are local, synchronous, and
  easy to reason about. HTTP and the ingest poller are RxJS: `timer` +
  `switchMap` keeps one in-flight request at a time, per-poll `retry` with
  exponential backoff rides out transient failures, and a re-fetch on the
  browser `online` event recovers stale state after a reconnect. The stream
  completes (inclusively) on the terminal job, and the page refreshes its
  list from that emission.
- **Polling first, WebSocket as the follow-up.** The backend has no
  WebSocket endpoint, and polling every 2s with backoff is honest,
  debuggable, and good enough for ingest jobs that last seconds. A
  `GET /ws/jobs/{job_id}` push endpoint is the obvious next step, not a
  rewrite — the poller is one service behind one interface.
- **Optimistic UI where the rollback is real.** Sending a message shows the
  user bubble and a pending assistant bubble immediately; on error both are
  removed and the failure is shown. Delete removes the row immediately but
  the real DELETE only fires after a 5-second snackbar Undo window — no
  backend change needed, and a failed DELETE restores the row.
- **Typed forms, async validation where it earns its place.** Chat and
  rewrite forms are typed `FormGroup`s. The upload form's async validator
  checks filename uniqueness against `GET /documents` — a duplicate upload
  is caught before it starts. If the check itself fails, it passes: a failed
  uniqueness check must not block an upload.
- **Errors are surfaced, never swallowed.** The interceptor turns HTTP
  failures into plain Errors with the FastAPI `detail` message; every page
  shows its errors with a retry. A failed chat turn, a failed ingest, and a
  down backend all look different to the user, because they are different.

## Rough edges, honestly

- **Feedback only works on fresh answers.** The API's `MessageOut` carries
  no `generation_id`, so history messages cannot take feedback — the buttons
  only appear on answers received in the current view. Fixing that properly
  means adding the id to the history endpoint, not faking it in the UI.
- **No `GET /documents/{id}`.** The chat and summary pages find their
  document in the library list. Fine at this scale; a detail endpoint is a
  one-line backend addition if the list ever gets big.
- **Two tabs, one session.** There is no conflict handling for two tabs
  chatting in the same session — last write wins, and neither tab knows.
  Out of scope for this build; the undo/delete and optimistic patterns here
  are the single-user versions of the same ideas.
- **No auth.** Same as the backend: local demo, not multi-tenant.

## How this maps to the role I built it for

I built this frontend to evidence hands-on Angular for a Technical Lead
(Angular + Python product engineering) role. The mapping, requirement by
requirement:

| Requirement | Where it lives |
|---|---|
| Angular 17+, readiness for 19.x | Built on Angular 19.2, standalone components only |
| TypeScript, strict mode | `strict: true`, `strictTemplates`, typed interfaces mirroring the Pydantic schemas |
| RxJS / signals | RxJS for HTTP + polling; signals for local state; OnPush change detection |
| Typed Reactive Forms, conditional + async validation | Chat + rewrite forms; upload filename-uniqueness async validator |
| Material / CDK | Table, dialog, snackbar, progress bar/spinner, select, tabs, chips |
| Reusable components | `document-card`, `citation-list`, `chat-message`, `job-progress` |
| Accessibility | aria labels, `aria-live` chat log, focus management, keyboard nav (Enter to send, Shift+Enter newline), visible focus |
| Performance | OnPush, `trackBy`, lazy routes (initial bundle ~116 kB transfer) |
| Frontend testing | Karma + Jasmine: API service, polling logic, one component (23 tests) |
| Real-time UI | RxJS polling + reconnect recovery + optimistic UI + safe undo (WebSocket follow-up noted above) |
| REST-backed durable changes | Every mutation through the typed API client; errors surfaced |

One honesty line: this is a real project I built, not years of Angular
production work — the resume line says "built", and the repo is the receipt.
