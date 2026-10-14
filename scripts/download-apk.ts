// Downloads a finished EAS release build as dist/Inkharbor-v<version>.apk.
// EAS always names its files application-<build id>.apk, which is no good
// for a GitHub release, so the name is set here instead.
//
//   bun run apk               latest finished build of the preview profile
//   bun run apk <build id>    a specific build
//
// Runs under Bun, outside the app's TypeScript project (see tsconfig exclude).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

interface Build {
  id: string;
  status: string;
  appVersion: string;
  gitCommitHash?: string;
  artifacts?: { applicationArchiveUrl?: string };
}

function eas(args: string[]): unknown {
  const out = execFileSync("bunx", ["eas-cli", ...args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out);
}

const buildId = process.argv[2];
const build = buildId
  ? (eas(["build:view", buildId]) as Build)
  : (
      eas([
        "build:list",
        "--platform",
        "android",
        "--build-profile",
        "preview",
        "--status",
        "finished",
        "--limit",
        "1",
        // build:list asks questions without this; build:view doesn't accept it.
        "--non-interactive",
      ]) as Build[]
    )[0];

const url = build?.artifacts?.applicationArchiveUrl;
if (!build || build.status !== "FINISHED" || !url) {
  console.error(buildId ? `Build ${buildId} has no finished APK.` : "No finished preview build found.");
  process.exit(1);
}

const res = await fetch(url);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const apk = Buffer.from(await res.arrayBuffer());
const file = `dist/Inkharbor-v${build.appVersion}.apk`;
mkdirSync("dist", { recursive: true });
writeFileSync(file, apk);

console.log(`${file}  (${(apk.length / 1048576).toFixed(1)} MB)`);
console.log(`build   ${build.id}`);
console.log(`commit  ${build.gitCommitHash ?? "unknown"}`);
console.log(`sha256  ${createHash("sha256").update(apk).digest("hex")}`);
