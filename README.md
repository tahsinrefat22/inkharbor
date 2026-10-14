# Inkharbor

An unofficial, open-source Android app for reading [Outline](https://www.getoutline.com) on your phone, mainly for self-hosted instances. It isn't affiliated with General Outline. Outline plans its own mobile app at some point; until then, this fills the gap.

Status: early, at v0.3. It's for reading: sign in to your server, browse collections and documents, search, and keep starred and recent documents available offline. No editing yet. Android only for now; iOS comes later.

## Requirements

- **Outline 1.11.0 or newer.** The app signs in with a custom-scheme redirect (`inkharbor://oauth`), which Outline accepts since [outline/outline#13945](https://github.com/outline/outline/pull/13945), first released in 1.11.0. On 1.10.1 and older, the server refuses the sign-in.
- Android 7.0 or newer on a 64-bit ARM phone, which covers practically every phone from the last several years.

Nothing needs to be set up on the server: the app registers itself as an OAuth client the first time it connects.

## Install

1. Download the APK from the [latest release](https://github.com/tahsinrefat22/inkharbor/releases).
2. Open it on your phone. Android asks you to allow installs from your browser or file manager the first time.
3. Enter your Outline server's address and sign in.

Updates install the same way, over the existing app, and keep you signed in.

## What it does

- Shows your collections and their document trees, and opens documents in a native reader. The reader handles everything Outline's editor can produce: headings, lists and checklists, tables, code, notices, toggles, images, attachments, videos, embeds, mentions and emoji (including your workspace's own). Attachments, videos and embeds open in the browser, and maths shows as its source for now.
- The home screen has three tabs: Collections, Recent and Starred. Recent combines what you viewed in Outline's web or desktop app with what you opened in Inkharbor, since Outline doesn't record views from other apps. The star in a document's or collection's header stars or unstars it, the same stars as on the web.
- Searches all documents from the box on the home screen. Results replace the collections while you type; clearing the box brings them back.
- Works offline. The collection list, document trees, the 50 most recently opened documents and every starred document are kept on the phone, and lists mark the documents that are. Starred documents are downloaded in the background, so they're there even if you've never opened them on the phone.
- Long documents stay fast: only what's on screen is drawn, including inside huge tables and lists, and a scroll handle on the right lets you jump anywhere. The list button in a document's header shows its headings and jumps to one.
- Light, dark or system theme, and five text sizes for the reader, from the avatar menu or a document's ⋮ menu.

## How sign-in works

Inkharbor signs in with OAuth and PKCE as a public client, so nobody has to create an OAuth app or share a secret. It opens your server's login page in the system browser, and whatever login your server uses (Google, Microsoft, Slack, an OIDC provider like Okta or Keycloak, email links, passkeys) happens there. The app never sees your password.

You only do this once. After that the app opens straight into your account. Signing out locks the app instead of throwing the authorization away, and signing back in uses your phone's fingerprint, face or PIN, without the browser. Disconnect (in Settings) removes the app's access for real, for example before handing your phone to someone else. The browser is needed again only after a disconnect, after clearing the app's data, if the app isn't opened for 30 days (Outline's refresh tokens expire), or if an admin revokes access.

For servers older than the requirement above, you can build the app with an HTTPS page that forwards the redirect (see `.env.example`). Signing in with a personal API key is planned as a simpler fallback.

## Privacy

The app talks to your Outline server and nothing else: no analytics, no crash reporting, no tracking. The only other requests are images that a document itself embeds from another site. Tokens are kept in Android's keystore-backed secure storage. Offline copies live in the app's private storage and are deleted when you disconnect.

## Development

Uses [bun](https://bun.sh) and Expo SDK 57, with TypeScript throughout.

```sh
bun install
bunx expo start
```

The `inkharbor://` scheme doesn't work in Expo Go, so you need a development build. Build one with EAS (`bunx eas-cli build --profile development --platform android`) or locally with `bunx expo run:android`. Copy `.env.example` to `.env.local` to pre-fill a server address while testing.

Before committing:

```sh
bun run lint
bunx tsc --noEmit
```

A release APK, like the ones on GitHub, comes from the `preview` profile: `bunx eas-cli build --profile preview --platform android`. EAS names its files after the build id, so `bun run apk` downloads the latest one as `dist/Inkharbor-v<version>.apk` and prints its SHA-256 for the release notes. Release builds shrink code and resources and only include 64-bit ARM. `bunfig.toml` stops bun from installing peer packages nobody asked for, because expo-router's unused drawer would otherwise pull about 3 MB of native code into the APK.

Code layout:

- `src/app/` screens (Expo Router)
- `src/components/reader/` the document reader and its scroll handle
- `src/components/` other shared components, including the opening animation
- `src/lib/outline/` the Outline API client and sign-in flow
- `src/lib/session.ts` keeps the signed-in session in the platform keystore
- `src/lib/stars.tsx` the user's stars, shared by the home screen and the star buttons
- `src/lib/cache.ts` the offline copy (SQLite)
- `src/hooks/` loading with the offline copy, recent documents and search
- `assets/logo-source/` the logo's SVG sources; the PNGs in `assets/images/` are rendered from them
- `scripts/generate-emoji-names.ts` rebuilds the emoji name table (`bun run emoji-names`)
- `scripts/download-apk.ts` downloads a release build with a proper name (`bun run apk`)

## License

MIT
