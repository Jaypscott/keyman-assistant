# App Store Setup

This project is now ready to be packaged as a native iOS app with Capacitor while keeping the existing design and functionality.

## One-time setup

1. Install dependencies:

```sh
npm install
```

2. Build the native web bundle:

```sh
npm run build
```

3. Create the iOS project:

```sh
npm run native:ios
```

4. Open the app in Xcode:

```sh
npm run native:open:ios
```

If CocoaPods was installed with RubyGems, the project scripts already add `/Users/jaylonpoole/.gem/ruby/2.6.0/bin` to the command path and set the UTF-8 locale CocoaPods expects.

## After future web changes

Run:

```sh
npm run native:sync
```

Then open Xcode and test on a simulator or real iPhone.

## Authentication backend

For local testing, start the backend before signing in:

```sh
npm run auth:server
```

The app points to `http://127.0.0.1:3001` by default. That works for local browser testing and the iOS Simulator. For a real iPhone or App Store build, host `server.mjs` behind HTTPS and set the app API URL before building:

```js
localStorage.setItem("keyman-auth-api", "https://your-auth-domain.example");
```

User records are saved to `data/auth-db.json` during local development. Passwords are stored as salted PBKDF2 hashes, not plain text.

## Before App Store submission

- In Xcode, set the final Bundle Identifier if `com.keyman.shiftplanner` needs to be changed.
- Add app icons, launch screen, signing team, and App Store metadata.
- Host the authentication backend on a secure HTTPS server and point the app to that backend URL.
- Confirm the App Privacy answers disclose saved volunteer phone numbers as user-provided contact data, and use the updated hosted privacy-policy URL.
- Test roster OCR and the group-message warning on a physical iPhone; the simulator cannot send SMS.
- Archive the app in Xcode and upload it through Organizer.
