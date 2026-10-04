# Inkharbor

An unofficial, open-source mobile app for reading [Outline](https://www.getoutline.com) on your phone, mainly for self-hosted instances. It isn't affiliated with General Outline. Outline plans its own mobile app at some point; until then, this fills the gap.

Status: early. Version 0.1 is about reading: sign in to your server, browse collections and documents, search, and keep starred and recent docs available offline. No editing yet.

## How sign-in works

Inkharbor signs in with OAuth and PKCE as a public client, so nobody has to create an OAuth app or share a secret. It registers itself with the server, opens the login page in the system browser, and gets the code back on `inkharbor://oauth`.

Outline only accepts custom-scheme redirect URIs like that from [outline/outline#13945](https://github.com/outline/outline/pull/13945) onwards. For older servers you can point the app at an HTTPS page that forwards the redirect (see `.env.example`). Signing in with a personal API key is planned as a fallback.

## Development

Uses [bun](https://bun.sh) and Expo SDK 57.

```sh
bun install
bunx expo start
```

The `inkharbor://` scheme only works in a development build, not in Expo Go. Build one with EAS (`bunx eas-cli build --profile development --platform android`) or locally with `bunx expo run:android`.

Code layout:

- `src/app/` screens (Expo Router)
- `src/lib/outline/` the Outline API client and sign-in flow
- `src/lib/session.ts` keeps the signed-in session in the platform keystore
- `src/components/` shared components

## License

MIT
