# Google Sign-In Setup (one-time, ~10 minutes)

The account button (top-right on the mobile Home header) is wired up in
`scripts/auth.js`, but it needs a **Google OAuth Client ID** before it does
anything. Without one, clicking the button shows a friendly "not switched on
yet" message instead of a broken sign-in flow — the site works fine either
way, this just activates the feature.

## What this does (and doesn't do)

- Lets a customer click **Sign in with Google** and see their name/photo in
  the header — a nicer, faster alternative to typing an email at checkout.
- **Client-only.** There is no backend account system. The signed-in name,
  email and photo are decoded from Google's token and kept in
  `localStorage.fs_user` on that one device/browser — nothing is sent to a
  server of ours.
- **Does not sync orders across devices.** "My Orders" still reads
  `localStorage.fs_orders`, exactly as it always has. Signing in on a phone
  and then a laptop shows two separate (empty-until-ordered) histories.
- Signing out clears the local sign-in and tells Google not to auto-resume
  it next visit (`disableAutoSelect`) — it doesn't revoke anything on
  Google's side.

If you later want real cross-device order history, that needs a backend
(e.g. extending the existing Cloudflare Worker + KV used for Nomba orders to
key records by the signed-in email) — a separate, bigger piece of work.

## 1. Create the OAuth Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (or pick an existing one) — e.g. name it "FakeSmile".
2. **APIs & Services → OAuth consent screen.**
   - User type: **External**.
   - App name: `FakeSmile`. User support email: your Gmail. App logo:
     `images/Fakesmile-1.webp` (optional but looks more trustworthy).
   - App domain / Homepage: `https://fakesmilestore.com`.
   - Authorized domain: `fakesmilestore.com`.
   - Scopes: leave the defaults (`email`, `profile`, `openid`) — don't add
     anything sensitive.
   - Publish the app (Testing → Production) once you're happy, or add your
     own Google account under "Test users" while you try it out — apps in
     Testing mode only let listed test users sign in.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
   - Application type: **Web application**.
   - Name: `FakeSmile Web`.
   - **Authorized JavaScript origins** — add all of these:
     - `https://fakesmilestore.com`
     - `https://www.fakesmilestore.com`
     - `http://localhost:8000` (only if you test locally with a dev server —
       harmless to leave in)
   - Leave "Authorized redirect URIs" empty — this flow doesn't use one.
   - Click **Create**. Copy the **Client ID** shown
     (`something.apps.googleusercontent.com`) — you don't need the secret.

## 2. Drop the Client ID into the site

Open [scripts/auth.js](scripts/auth.js) and replace the placeholder:

```js
const GOOGLE_CLIENT_ID = 'YOUR-GOOGLE-CLIENT-ID.apps.googleusercontent.com';
```

with your real one. Commit and push — that's the whole activation step, no
rebuild needed.

## 3. Test it

Open the site on a phone-width browser window (or narrow your desktop
browser below 768px), go to Home, tap the circular account icon top-right.
You should see a real "Sign in with Google" button. Sign in with your own
Google account first to confirm it works before telling customers about it.

## Where it's wired up today

Only the **mobile Home header** button (`index.html`) — that's the one
placeholder that existed before this feature. To add the same account
button to desktop or to other pages, copy the `<button class="header-profile">`
markup from `index.html` into that page's header and load `scripts/auth.js`
there too (after `scripts/base.js`) — `auth.js` finds any `.header-profile`
button on the page automatically, no extra wiring needed.
