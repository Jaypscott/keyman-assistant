# Chief mobile chat

Chief is available through the sparkle button on Home, Calendar, Checklist and Profile. Chat uses the app’s light/dark palette, retains unsent text while navigating, and restores the underlying screen on Back. Conversation history is saved per account and shared across devices.

Chief creates and revises single-shift rotations with the existing scheduler. Validated draft cards open the existing review screen without changing their assignments. Add to Calendar is a user action; replacing the same date/location/shift requires confirmation. Edited Chief drafts are checked again before saving. Partial availability, breaks, qualifications, and overnight/cross-shift scheduling remain unsupported.

## Local setup

Requires Node 20.12+ and the existing dependencies (`npm install`). The approved OpenAI key is in root `.env.local`; keep it server-side.

Start these in separate terminals:

```sh
npm run chief:server
npm run chief:preview
```

Open `http://127.0.0.1:4173`. The preview proxies the local backend, serves only frontend assets, and disables asset caching on that local origin. It does not expose `.env.local`, `server/`, or `agents/`.

Defaults: backend port 3001, preview port 4173. Set `AUTH_PORT` on both processes to change the backend port, and `CHIEF_PREVIEW_PORT` to change the preview port. `OPENAI_AGENT_MODEL` can override the default model if your project has access. Hosted Agents API access and API credits are required.

## Deployment and storage

This change does not deploy the backend. The mobile app’s existing `config.js` still targets the configured Render service; that service must receive this code and `OPENAI_API_KEY` before Chief works in the production app. Do not put the key in frontend config or the iOS bundle.

- With `DATABASE_URL`, Chief creates a dedicated `chief_conversations` table on first access. Its row is owned by the authenticated user, references `users`, and is locked for each mutation. Existing app-data PUTs cannot overwrite it.
- Without PostgreSQL, Chief writes a separate `chief-conversations.json` next to `AUTH_DATA_FILE`. This atomic-file fallback is for one backend process. Use PostgreSQL for multiple replicas.
- The document stores messages, structured drafts, function results, session/turn IDs and a processing lease. Only public messages, validated drafts and status are returned to clients.
- One active turn per account is enforced by storage transactions. Message IDs deduplicate retries. A 45-second lease, renewed every 15 seconds, allows another process to recover work after a crash; recovery begins when the account next fetches or submits to Chief.
- The server responds 202 to accepted messages and keeps the function responder alive independently of the browser. Clients poll every two seconds while processing, and every ten seconds while idle and visible. Reopening or foregrounding retrieves saved results.
- Interrupted runs reconnect and reconcile saved turns before accepting another request. Unresolved outcomes block new messages until an explicit reset. Turns retain the three-minute deadline and 12-function-call limit. Conversations are capped at 200 messages.
- New Conversation cancels active work and deletes the hosted session before replacing history. Failed cleanup retains the session ID for another reset attempt. Account deletion also cleans up its session; a cleanup failure stops deletion so resources are not silently orphaned. Idle sessions remain available for follow-up conversations.
- Local/browser caches clear on logout. No phone numbers, notes, or full calendar are sent as app context. Context includes only selected scheduling details and an optional structurally checked active draft; availability still requires explicit confirmation.

## API

All endpoints use the existing Bearer authentication.

- `GET /api/chief/conversation`: get the account’s conversation and processing status; recover an expired processing lease.
- `POST /api/chief/messages`: `{ conversationId, messageId, text, context }`; returns 202 with the accepted message ID and current conversation. Context is allowlisted server-side. Text limit: 8,000 characters.
- `DELETE /api/chief/conversation`: `{ conversationId }`; clean up and start a fresh conversation. Stale conversation IDs return 409.

Messages and drafts are separate structured records. Assistant text is escaped before rendering, with only simple bold emphasis supported. UI cards use the server’s validated draft data, never parsed model prose.

## Verification

```sh
npm run test:chief
npm run test:rotation-agent
npm test
node scripts/build-native.mjs --preserve-existing
```

The preserve-existing build option overlays generated assets without removing unrelated files in `www` or the native public directory. The default clean build behavior is unchanged. Before this task’s native sync, previous output folders were backed up under ignored `data/chief-build-backup-*`.

Verified in this workspace:

- Automated coverage of authentication, account isolation, history persistence, idempotent sends, one active turn, lease recovery, reset, safe tool-result persistence, turn reconciliation, exact draft review, escaped content, failed-send retry, unsent text, focus restoration and logout races.
- PostgreSQL adapter transaction/rollback behavior is tested with a database double; a live PostgreSQL instance was not used.
- Live synthetic conversation: missing details → clarification → six-person draft → 20-minute revision → review → Calendar save. Saved assignments exactly matched the revised draft.
- A partial-availability request produced an explanation and no additional draft.
- Browser checks at 390×844 and 320×568; dark-mode rendering, 44px entry target, fixed composer, all main-tab entry points, review/back navigation and persisted conversation after reload.
- The workspace’s existing `jsdom` installation stalled on filesystem reads. DOM and full regression tests were run with the same pinned `jsdom@26.1.0` installed in temporary storage; no dependency version was changed to bypass this issue.

The standalone rotation CLI remains available. No production deployment or physical-device keyboard test was performed.

## Roster screenshot attachments

In the installed iPhone app, tap the paperclip and choose a roster image (up to 20 MB). A thumbnail appears beside the composer; selection does not run recognition. Remove or replace it before sending. Send a request such as “Use the volunteers in this screenshot.” If the message is unclear or empty, Chief asks permission and offers **Analyze screenshot**. A written affirmative reply also works. Review extracted names/numbers and tap **Use these volunteers** to continue automatically. Closing review preserves the rows for later review; discard abandons the request.

Recognition uses the same on-device scanner and review markup as manual shift creation. The source image stays only in memory on the originating device and is released on confirmation, removal, reset, or logout. Navigating away preserves it; restarting the app requires reattachment. Other devices show a placeholder, never the image. The browser explains that recognition requires the installed iPhone app.

`POST /api/chief/messages` accepts optional `attachment: { id, kind: "roster_screenshot" }`. Text may be empty only with an attachment. No image data, file names, or local URLs are accepted in attachment metadata. The older optional reviewed `roster` interface remains supported for compatibility, but cannot be combined with an image attachment. Conversation responses include `attachments` with `attached`, `awaiting_permission`, `requested`, `completed`, or `cancelled` state.

`POST /api/chief/attachments` accepts `conversationId`, original `messageId`, `attachmentId`, `operationId`, and `action` (`analyze`, `complete`, or `cancel`). `complete` additionally requires a reviewed `roster: [{ name, phone }]` containing 1–8 unique names and valid optional phone numbers. Completion requires a requested extraction. Operations are account-scoped and idempotent; a reused operation ID with changed data is rejected. The client keeps failed operations intact for retry.

Chief's `request_roster_extraction` tool records permission requests, authorized extraction requests, or refusals. It returns immediately so no hosted turn waits for a device. The app scans after the agent finishes, and confirmed review starts a new agent turn. Only reviewed names enter AI input; phone numbers remain in dedicated account-owned storage. Drafts retain their original roster/contact version. Images never enter storage, API calls, logs, or model inputs. Both PostgreSQL JSONB and local JSON use the same document fields; no database migration is needed.

Existing agent sessions are upgraded on their first screenshot request because hosted sessions cannot change tools in place. The old session is cleaned up and saved conversation prose is supplied to a new session; chat history, validated drafts, and contact versions stay intact. Reset/account deletion removes attachment and roster records, while saved Calendar schedules retain contacts. Source config stays unchanged; simulator testing uses only a compiled local-backend override.

Roster verification includes native simulator OCR with a synthetic four-person screenshot, automated scan cancellation/timeouts, review editing, attachment-only requests, retry identity, persistence/isolation/versioning, and checks that AI input/tool results exclude private contact metadata.

Live verification on September 30, 2026: the simulator scanned four synthetic names/phone numbers, Chief asked for the missing scheduling details, and the confirmed October 4 Jax Fishing Pier draft was reviewed and saved through the browser. Saved assignments exactly matched the draft, and all four contacts were preserved. Summary evidence is in ignored `data/chief-roster-live-verification.json`. The preview conversation and synthetic Calendar event are retained for further testing.

Deferred-extraction verification (September 30, 2026): 111 automated tests passed. A live synthetic intent sequence confirmed that unclear input asks permission, an unrelated reply leaves permission pending, refusal cancels, and an explicit request queues extraction. Its hosted test session was deleted afterward. The preview-account iPhone flow covered image-only send → Chief permission question → written authorization → native OCR → volunteer review → missing details/availability → validated draft → Calendar save for October 5. Saved assignments and all four contacts matched exactly (`data/chief-deferred-live-verification.json`, ignored). Light/dark rendering and the 44-point attachment target were checked. Physical-device testing and a live PostgreSQL run were not performed.
