# Inkharbor

An unofficial, open-source Android app for reading [Outline](https://www.getoutline.com) on your phone, mainly for self-hosted instances. It isn't affiliated with General Outline. Outline plans its own mobile app at some point; until then, this fills the gap.

Status: early, at v0.9. Sign in to one or more servers, browse collections and documents, search, keep starred and recent documents available offline, take part in a document's comments, and edit documents. The editor handles text, headings, lists, quotes, toggles, photos and videos; tables, notices and maths can't be edited in the app yet. Android only for now; iOS comes later.

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

- Shows your collections and their document trees, and opens documents in a native reader. The reader handles everything Outline's editor can produce: headings, lists and checklists, tables, code, notices, toggles, images, attachments, videos, embeds, mentions and emoji (including your workspace's own). Videos play in the reader, maths is drawn as it is on the web, and attachments and embeds open in the browser.
- The home screen has three tabs: Collections, Recent and Starred. Recent combines what you viewed in Outline's web or desktop app with what you opened in Inkharbor, since Outline doesn't record views from other apps. The star in a document's or collection's header stars or unstars it, the same stars as on the web.
- Comments: the button in a document's header shows its comment threads, with the passage each one is on, on Open and Resolved tabs. You can comment, reply, react (with every emoji Outline offers, including your workspace's own), resolve and reopen threads, and edit or delete your comments (anyone's, for admins). The badge on the button counts comments you haven't seen yet. While the comments are open they refresh every few seconds, so comments made on the web show up by themselves: Outline's live updates only work with its own web login, so the app checks instead.
- Editing, where Outline lets you edit. A document opens ready to read; tap anywhere in the text to start editing there, and changes save by themselves a moment after you stop typing. The toolbar above the keyboard has bold, italic, strikethrough, code, headings, bullet, numbered and check lists, quotes, toggles, indenting, undo and redo, and adds photos and videos from your phone. While editing, the ⠿ handle beside the current block drags it to a new place. Tables, notices and maths show as they do in the reader but can only be changed on the web for now. Saving sends only the blocks you changed, so comments elsewhere keep their highlights, and changes someone else made in the meantime are kept unless they're in the same place. Without a connection, changes stay on the phone and are saved once it's back. Pull down at the top of a document to load changes made elsewhere.
- Rename a document from its ⋮ menu, and create documents with the + in a collection's header or New nested document in a document's ⋮ menu. A new document takes a title and, optionally, text written in Markdown.
- Several servers: add another from the avatar menu and switch between them there. Each keeps its own offline copy, so switching shows that server's saved documents straight away, even offline.
- Opens Outline links shared to it. Share a document's link from the browser, a chat or anything else to Inkharbor and it opens in the reader, switching to the right server first if you've added more than one; other links get the option to open in the browser. Tapping an Outline link in another app still opens the browser, because Android only sends web links to an app that was built for that exact domain.
- Searches all documents from the box on the home screen. Results replace the collections while you type; clearing the box brings them back.
- Works offline. The collection list, document trees, the 50 most recently opened documents and every starred document are kept on the phone, and lists mark the documents that are. Starred documents are downloaded in the background, so they're there even if you've never opened them on the phone.
- Long documents stay fast: only what's on screen is drawn, including inside huge tables and lists, and a scroll handle on the right lets you jump anywhere. The list button in a document's header shows its headings and jumps to one.
- Light, dark or system theme, and five text sizes for the reader, from the avatar menu or a document's ⋮ menu.

## How sign-in works

Inkharbor signs in with OAuth and PKCE as a public client, so nobody has to create an OAuth app or share a secret. It opens your server's login page in the system browser, and whatever login your server uses (Google, Microsoft, Slack, an OIDC provider like Okta or Keycloak, email links, passkeys) happens there. The app never sees your password.

You only do this once. After that the app opens straight into your account. Signing out locks the app instead of throwing the authorization away, and signing back in uses your phone's fingerprint, face or PIN, without the browser. Disconnect (in Settings) removes the app's access to the open server for real, along with its offline copy, for example before handing your phone to someone else. The browser is needed again only after a disconnect, after clearing the app's data, if the app isn't opened for 30 days (Outline's refresh tokens expire), or if an admin revokes access.

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

A release APK, like the ones on GitHub, comes from the `preview` profile: `bunx eas-cli build --profile preview --platform android`. EAS names its files after the build id, so `bun run apk` downloads the latest one as `dist/Inkharbor-v<version>.apk` and prints its SHA-256 for the release notes. The same build also runs on your own machine, signed with the same EAS-managed key, with `EAS_NO_VCS=1 bunx eas-cli build --profile preview --platform android --local --output dist/Inkharbor-v<version>.apk` (it needs JDK 17, Android SDK 36 and NDK 27.1). Release builds shrink code and resources and only include 64-bit ARM. `bunfig.toml` stops bun from installing peer packages nobody asked for, because expo-router's unused drawer would otherwise pull about 3 MB of native code into the APK.

Code layout:

- `src/app/` screens (Expo Router)
- `src/components/reader/` the document reader and its scroll handle
- `src/components/editor/` the editor: a ProseMirror page in a web view (`rich-editor.tsx`, an Expo DOM component) and the screen around it with the toolbar and autosave (`document-editor.tsx`)
- `src/components/` other shared components, including the opening animation
- `src/lib/editor/` the editor's schema, a Markdown writer that matches Outline's, and `save.ts`, which turns an edit into patches for only the changed blocks
- `src/lib/outline/` the Outline API client and sign-in flow; `markdown.ts` turns comments back into Markdown, `edits.ts` saves checkboxes, titles and new documents, `attachments.ts` uploads photos and videos
- `src/lib/maths.ts` draws TeX maths as SVG with MathJax
- `src/lib/session.ts` keeps each server's session in the platform keystore
- `src/lib/stars.tsx` the user's stars, shared by the home screen and the star buttons
- `src/lib/cache.ts` the offline copy (SQLite, one database per server)
- `src/hooks/` loading with the offline copy, comments, recent documents and search
- `assets/logo-source/` the logo's SVG sources; the PNGs in `assets/images/` are rendered from them
- `scripts/generate-emoji-names.ts` rebuilds the emoji name table and the emoji picker's data (`bun run emoji-names`)
- `scripts/download-apk.ts` downloads a release build with a proper name (`bun run apk`)

## License

MIT
