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
