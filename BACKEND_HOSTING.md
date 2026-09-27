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
