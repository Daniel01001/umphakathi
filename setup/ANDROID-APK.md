# Making an Android app (APK) from the PWA

Good news: you do **not** build a separate Android app. The website is now a
**PWA** (Progressive Web App), and Android can wrap that exact same PWA into a
real installable app (`.apk` for sharing, `.aab` for the Play Store). One
codebase → iPhone (PWA), desktop (web), and Android (APK).

**Before you start, the site must be live over HTTPS** (your Netlify URL already
is). PWA wrapping does not work from a file on your computer.

## Easiest way — PWABuilder (no tools to install)

1. Go to [pwabuilder.com](https://www.pwabuilder.com).
2. Paste your live URL (e.g. `https://umphakathi.netlify.app`) and click
   **Start**. It scores your PWA — the manifest, service worker and icons we
   added should all pass. ✅
3. Click **Package for stores → Android**.
4. Choose **Signed APK** (for sharing directly) and generate. Download the zip.
5. Inside the zip is your `.apk` (share this with Android users) plus a
   `signing key` and instructions. **Keep the signing key safe** — you need the
   same key every time you update the app.

Android users then: download the `.apk`, tap it, and allow "install from this
source". iPhone users keep using the PWA (Share → **Add to Home Screen**).

## For the Google Play Store later (optional)

To publish on Play (so people find it by searching), you upload the `.aab` file
PWABuilder also produces. A Play Developer account is a **one-time US$25** fee.
Not required for sharing the APK directly — only if you want a Store listing.

## Power-user way — Bubblewrap (command line)

If you prefer the command line and have Node.js + Java installed:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://umphakathi.netlify.app/manifest.webmanifest
bubblewrap build
```

This produces `app-release-signed.apk`. Bubblewrap is what PWABuilder uses under
the hood — same result, just manual.

## Keeping the app updated

Because the APK is a wrapper around your live website, **most updates need no
new APK at all** — when you push changes to Netlify, the app shows them next
time it opens (the service worker refreshes in the background). You only rebuild
the APK if you change the app's name, icon, or want a new Play Store version.
