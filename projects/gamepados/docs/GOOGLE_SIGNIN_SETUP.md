# Sign in with Google — what is built and what you must do once

**Status (2026-10-19):** the code is written and tested, and it is **switched off** until you
do the one-time Google Cloud setup below. Until then the app does not show the Google button.

## How it works (so you can reason about it)

1. The app (in a WebView) can't use Google sign-in itself: Google refuses OAuth inside embedded
   WebViews. So tapping **Continue with Google** opens the phone's **browser**.
2. The browser goes to our backend `/api/account/google/start`, which sends it to Google.
3. Google asks the person to pick an account, then sends the browser back to our backend
   `/api/account/google/callback`. The backend exchanges the code with Google using the
   **client secret** and reads the verified email and name.
4. The backend finds or creates the account (same verified email = same account; a new Google
   user is created already verified) and shows a page with an **Open GamepadOS** button that
   opens `gamepados://auth?code=…` — a one-time, 2-minute code.
5. The app trades that code (plus a secret it made at the start, so no other app can steal the
   sign-in) for a normal session token. From there nothing differs from a password sign-in.

Files: `website/backend/google.js` (+ `google.test.js`), routes in `server.js`,
app: `controller-ui/src/app/api/account.ts`, `store/account.ts`, `components/AccountAuth.tsx`,
and `MainActivity.kt` + `AndroidManifest.xml` for the `gamepados://auth` link.

## One-time setup (about 10 minutes, in your Google account)

1. Open **https://console.cloud.google.com** and pick (or create) a project, e.g. *GamepadOS*.
2. **APIs & Services → OAuth consent screen**
   - User type **External**, app name **GamepadOS**, your support email.
   - Scopes: only the defaults **openid, email, profile** (these need no Google review).
   - Add your **privacy policy** link: `https://gamepad.space/privacy`.
   - Publishing status: while it says **Testing**, only the test users you list can sign in.
     Click **Publish app** so anyone can. (For these three basic scopes this is immediate.)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**, name *GamepadOS backend*.
   - **Authorised redirect URIs** → add exactly:
     `https://supportportal.gamepad.space/api/account/google/callback`
   - Create. Copy the **Client ID** and **Client secret**.
4. In **Railway → the backend service → Variables** add:
   - `GOOGLE_CLIENT_ID` = the client ID
   - `GOOGLE_CLIENT_SECRET` = the client secret
   and let it redeploy. Check: open
   `https://supportportal.gamepad.space/api/account/google/config` — it must say `"enabled":true`.
5. Ship the app build that contains this feature (new version). Older app versions simply don't
   show the button.

## Checking it end to end (after step 5)

On a phone with the new build: Account → Sign in → **Continue with Google** → pick an account →
tap **Open GamepadOS** if the browser doesn't switch back by itself → you are signed in.
Then try it again with a Google address that already has a password account: it signs into the
**same** account (no duplicate), and that account becomes email-verified.

## Good to know

- **Privacy:** the website privacy policy now says what we receive from Google (email, name).
- **No Google account needed to keep playing** — password sign-in and "Continue without signing in" are unchanged.
- **Password for a Google-only account:** it has an unusable random password. The person can still
  set a real one with *Forgot your password?* (we email a code).
- **Switching it off:** blank the two Railway variables. The button disappears from the app and the
  endpoints answer "not set up". Nothing else is affected.
- **Single backend instance:** the in-flight sign-ins are held in memory (10 min / 2 min). A restart
  only cancels sign-ins in progress; the person taps the button again.
