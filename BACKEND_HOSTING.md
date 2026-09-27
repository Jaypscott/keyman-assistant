# Backend Hosting

This app can point to any HTTPS backend that implements the auth endpoints in `server.mjs`.

## Render setup

1. Push this project to GitHub.
2. In Render, choose New > Blueprint and connect the GitHub repo.
3. Select this repo's `render.yaml`.
4. Render should create `keyman-assistant-api` and `keyman-assistant-db` with:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
   - Environment variable: `DATABASE_URL` from the Postgres database
5. After deploy, open `https://your-service.onrender.com/api/health`.
6. If it returns `{"ok":true}`, copy the service's base URL.

## Password reset email

The password reset flow uses one-time, expiring codes delivered through Resend.

1. Create a Resend API key and verify a sending domain.
2. Set `RESEND_API_KEY` on the backend service.
3. Set `PASSWORD_RESET_FROM_EMAIL` to a verified sender such as `Keyman Assistant <no-reply@example.com>`.
4. Keep the generated `PASSWORD_RESET_SECRET` private and stable. Changing it invalidates outstanding reset codes.

Production password reset requests fail closed when email delivery or the reset secret is not configured. In non-production environments only, the API returns a development code so the flow can be tested without sending email.

After deploying, verify that `/api/health` reports `passwordReset: true`, then submit a reset request for a test account and confirm the email arrives before shipping the mobile build. A generic `{"error":"Not found."}` response means Render is still running an older backend revision.

## Remembered sessions

Sign-in tokens are stored persistently on the device. The backend uses a rolling inactivity timeout controlled by `SESSION_IDLE_TTL_DAYS`, which defaults to 7. Opening or using the app refreshes an active session; after seven days without an authenticated request, the server rejects the saved token and the app asks the user to sign in again.

Manual setup also works: create a Render Postgres database, create a Web Service from the repo, and add `DATABASE_URL` from the database connection string.

The privacy policy is hosted by the backend at:

```text
https://your-service.onrender.com/privacy
```

## Point the app to production

Update `config.js`:

```js
window.KEYMAN_CONFIG = {
  authApiBase: "https://your-render-service.onrender.com",
  privacyPolicyUrl: "https://your-render-service.onrender.com/privacy",
};
```

Then run `npm run native:sync` and rebuild the iOS app.

## Failure handling and diagnostics

Database connections and pool checkout wait at most 1 second. PostgreSQL statements
have a 2-second server-side limit and queries have a 3-second client-side limit.
The health endpoint checks current database connectivity and returns HTTP 503 on
failure, with a 4-second overall deadline (before Render's 5-second timeout).
Failed schema initialization is retried on a later request.

Idle pool errors are handled without terminating the server. Unexpected request
failures return a generic HTTP 500; malformed JSON returns HTTP 400. Structured
logs identify `database_pool_error`, `database_health_error`, and `request_error`.
Requests lasting at least 1 second emit `slow_request_pending` and, when closed,
`slow_request_completed`, including a known route and duration. Logs omit query
strings, bodies, authorization headers, and raw database error details.

These safeguards improve recovery and diagnosis; they do not establish the cause
of the September 2026 timeouts. Deploy the updated backend to activate them.

## Password recovery rollout (September 2026)

The reset UI preserves fields on errors, uses a wall-clock resend countdown, and
keeps passwords only in memory. Requests time out after 15 seconds. The existing
reset endpoints remain compatible; request receipts now include
`retryAfterSeconds: 60` and `expiresInSeconds: 900`. Requests during the cooldown
return the same HTTP 200 receipt without sending another email, matching unknown
accounts and avoiding an account-existence signal. Older clients remain usable.

Reset issuance, attempt counting, and code consumption use a short transaction
locking the user's row. Email delivery runs outside the lock, and failed delivery
removes only its own code. Successful reset revokes all existing sessions.

Production activation requires a verified sending domain in Resend and these
Render values: `RESEND_API_KEY`, `PASSWORD_RESET_FROM_EMAIL`, and the existing
`PASSWORD_RESET_SECRET`. Preserve the existing secret. The requested sender domain
is `keymanassistant.com`, registered and verified in Resend. Render has a
domain-scoped sending key and `Keyman Assistant <no-reply@keymanassistant.com>`
configured as the sender. Confirm real delivery after deploying these changes.

Run `npm test` for local and UI regressions. To include real PostgreSQL concurrency
checks, point `KEYMAN_TEST_DATABASE_URL` at an isolated disposable test database;
never use a production database. The tests create test accounts in that database.
Run `npm run build` to refresh bundled mobile assets. A new mobile release is
required for installed apps to receive the improved screens.
