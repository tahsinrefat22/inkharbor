// Rewrites links the system opens the app with. expo-sharing turns a share
// from another app into inkharbor://expo-sharing; it goes to /shared, which
// reads what was shared. Everything else (e.g. the sign-in redirect) passes
// through unchanged.

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/?expo-sharing(?:[/?#]|$)/i.test(path) ? "/shared" : path;
}
