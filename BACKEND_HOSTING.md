# Backend Hosting

This app can point to any HTTPS backend that implements the auth endpoints in `server.mjs`.

## Render setup

1. Push this project to GitHub.
2. In Render, choose New > Blueprint and connect the GitHub repo.
3. Select this repo's `render.yaml`.
4. Render should create `keyman-assistant-api` with:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
   - Persistent disk: `/var/data`
   - Environment variable: `AUTH_DATA_FILE=/var/data/auth-db.json`
5. After deploy, open `https://your-service.onrender.com/api/health`.
6. If it returns `{"ok":true}`, copy the service's base URL.

Manual setup also works: create a Web Service from the repo and use the same build command, start command, health check path, disk, and environment variable shown above.

## Point the app to production

Update `config.js`:

```js
window.KEYMAN_CONFIG = {
  authApiBase: "https://your-render-service.onrender.com",
  privacyPolicyUrl: "https://your-public-privacy-policy-url",
};
```

Then run `npm run native:sync` and rebuild the iOS app.

## Production note

The current backend uses a JSON file for account storage. A persistent disk is enough for a small prototype, but a managed database such as Postgres is the better production path before real App Store users depend on it.
