// Writes the licences of everything the Android app is built from:
//
// - src/lib/licenses.json: shown on the Open-source licences screen.
// - THIRD-PARTY-LICENSES.txt: the same as text, attached to each release.
//
// What ships is read from a release build rather than from package.json:
//
// - npm packages compiled into the app and the editor's web view, from the
//   source maps of `expo export`;
// - native modules, from Expo's autolinking and Gradle's release
//   dependencies, and Android libraries from Gradle, with the licence their
//   Maven POM declares;
// - C/C++ libraries inside the .so files, fonts and data that come from
//   elsewhere, listed in OTHER below with where their licence text lives.
//   Check that list when a native dependency changes: `strings` on the
//   APK's .so files shows which libraries they contain.
//
// Needs what a local build needs (JDK 17, the Android SDK), then:
//
//   JAVA_HOME=~/.local/jdk-17 ANDROID_HOME=~/Android/Sdk bun run licenses
//
// Runs under Bun, outside the app's TypeScript project (see tsconfig exclude).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const NODE_MODULES = join(ROOT, "node_modules");
const GRADLE_CACHE = join(homedir(), ".gradle/caches/modules-2/files-2.1");

interface Entry {
  title: string;
  license: string;
  /** What it covers: packages with versions, libraries, fonts. */
  components: string[];
  /** Indexes into `texts`. */
  texts: number[];
}

function run(command: string, args: string[], cwd = ROOT): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    // No prompts from Expo's CLI.
    env: { ...process.env, CI: "1" },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const text = await response.text();
  // Gitiles serves raw files as base64.
  return url.includes("format=TEXT") ? Buffer.from(text, "base64").toString("utf8") : text;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const normal = (text: string) => text.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "");

// ---------------------------------------------------------------- npm packages

/** npm packages whose code is compiled into the app or the editor. */
function bundledPackages(): Set<string> {
  const out = mkdtempSync(join(tmpdir(), "inkharbor-licenses-"));
  try {
    run("bunx", ["expo", "export", "--platform", "android", "--source-maps", "--output-dir", out]);
    const found = new Set<string>();
    const maps = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? maps(join(dir, entry.name)) : entry.name.endsWith(".map") ? [join(dir, entry.name)] : [],
      );
    for (const map of maps(out)) {
      for (const source of readJson(map).sources as string[]) {
        const at = source.lastIndexOf("node_modules/");
        if (at === -1) {
          continue;
        }
        const [first, second] = source.slice(at + "node_modules/".length).split("/");
        // Nested copies (node_modules/a/node_modules/b) are kept by path.
        const prefix = source.slice(0, at + "node_modules/".length).replace(/^\//, "");
        found.add(prefix + (first.startsWith("@") ? `${first}/${second}` : first));
      }
    }
    return found;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Expo modules linked into the Android app, some with no JavaScript in the bundle. */
function linkedExpoModules(): string[] {
  const resolved = JSON.parse(run("bunx", ["expo-modules-autolinking", "resolve", "--platform", "android", "--json"]));
  return (resolved.modules ?? resolved).map((module: { packageName: string }) => module.packageName);
}

/** Licence files kept in an npm package; some packages only declare a licence. */
function packageTexts(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /^(licen[cs]e|copying)/i.test(name))
    .sort()
    .map((name) => normal(readFileSync(join(dir, name), "utf8")));
}

// Packages published without a licence file, covered by their repository's.
const SHARED_LICENSE: [RegExp, string][] = [
  [/^@react-native\//, "react-native"],
  [/^(expo($|-)|@expo\/)/, "expo"],
];
const FETCHED_LICENSE: Record<string, string> = {
  "standard-navigation": "https://raw.githubusercontent.com/react-navigation/standard-navigation/main/LICENSE",
};

// ------------------------------------------------------------ Android libraries

interface Gradle {
  projects: string[];
  maven: { group: string; artifact: string; version: string }[];
}

/** Gradle's release dependencies, generating the native project if it isn't there. */
function gradleDependencies(): Gradle {
  const android = join(ROOT, "android");
  const generated = !existsSync(android);
  const packageJson = readFileSync(join(ROOT, "package.json"), "utf8");
  try {
    if (generated) {
      run("bunx", ["expo", "prebuild", "--platform", "android", "--no-install"]);
    }
    const report = run("./gradlew", ["-q", ":app:dependencies", "--configuration", "releaseRuntimeClasspath"], android);
    const projects = new Set<string>();
    const maven = new Map<string, Gradle["maven"][number]>();
    for (const line of report.split("\n")) {
      const project = line.match(/[+\\]--- project :?([\w\-.@/]+)/);
      if (project) {
        projects.add(project[1]);
        continue;
      }
      const library = line.match(/[+\\]--- ([\w.-]+):([\w.-]+):(?:[\w.\-+[\]{},]+ -> )?([\w.-]+)/);
      if (library && !line.includes("(c)")) {
        const [, group, artifact, version] = library;
        maven.set(`${group}:${artifact}`, { group, artifact, version });
      }
    }
    return { projects: [...projects], maven: [...maven.values()] };
  } finally {
    // Prebuild rewrites the run scripts in package.json.
    writeFileSync(join(ROOT, "package.json"), packageJson);
    if (generated) {
      rmSync(android, { recursive: true, force: true });
    }
  }
}

function cachedFiles(group: string, artifact: string, version: string): string[] {
  const dir = join(GRADLE_CACHE, group, artifact, version);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((hash) => readdirSync(join(dir, hash)).map((name) => join(dir, hash, name)));
}

/** The licence names a library's POM declares, or its parent's. */
function pomLicenses(group: string, artifact: string, version: string, depth = 0): string[] {
  const pom = cachedFiles(group, artifact, version).find((file) => file.endsWith(".pom"));
  if (!pom) {
    return [];
  }
  const xml = readFileSync(pom, "utf8");
  const licenses = xml.match(/<licenses>([\s\S]*?)<\/licenses>/);
  if (licenses) {
    return [...licenses[1].matchAll(/<name>([^<]+)<\/name>/g)].map((name) => name[1].trim());
  }
  const parent = xml.match(/<parent>([\s\S]*?)<\/parent>/);
  if (parent && depth < 4) {
    const field = (name: string) => parent[1].match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1].trim() ?? "";
    return pomLicenses(field("groupId"), field("artifactId"), field("version"), depth + 1);
  }
  return [];
}

/** NOTICE files inside a library, which the Apache licence asks to pass on. */
function libraryNotices(group: string, artifact: string, version: string): string[] {
  const notices: string[] = [];
  for (const file of cachedFiles(group, artifact, version).filter((name) => /\.(jar|aar)$/.test(name))) {
    const listing = spawnSync("unzip", ["-Z1", file], { encoding: "utf8" }).stdout ?? "";
    for (const entry of listing.split("\n").filter((name) => /(^|\/)NOTICE(\.txt|\.md)?$/i.test(name))) {
      notices.push(normal(spawnSync("unzip", ["-p", file, entry], { encoding: "utf8" }).stdout ?? ""));
    }
  }
  return notices.filter(Boolean);
}

// Libraries maintained with Expo or React Native: their npm packages above cover them.
const COVERED_BY_NPM = /^(expo\.modules\.|host\.exp\.exponent$|com\.facebook\.react$)/;

// Android libraries under licences other than Apache 2.0, by group or group:artifact.
const ANDROID_TEXTS: Record<string, { title: string; license: string; urls: string[] }> = {
  "com.facebook.fresco": {
    title: "Fresco",
    license: "MIT",
    urls: ["https://raw.githubusercontent.com/facebook/fresco/main/LICENSE"],
  },
  "com.facebook.yoga": {
    title: "Yoga",
    license: "MIT",
    urls: ["https://raw.githubusercontent.com/facebook/yoga/main/LICENSE"],
  },
  "com.facebook.infer.annotation": {
    title: "Infer annotations",
    license: "MIT",
    urls: ["https://raw.githubusercontent.com/facebook/infer/main/LICENSE"],
  },
  "org.brotli": {
    title: "Brotli",
    license: "MIT",
    urls: ["https://raw.githubusercontent.com/google/brotli/master/LICENSE"],
  },
  "org.checkerframework": {
    title: "Checker Framework qualifiers",
    license: "MIT",
    urls: ["https://raw.githubusercontent.com/typetools/checker-framework/master/checker-qual/LICENSE.txt"],
  },
  "com.parse.bolts": {
    title: "Bolts",
    license: "BSD-3-Clause",
    // The version in the app predates the project's move to MIT.
    urls: ["https://raw.githubusercontent.com/BoltsFramework/Bolts-Android/1.4.0/LICENSE"],
  },
  "com.github.bumptech.glide": {
    title: "Glide",
    license: "BSD-2-Clause AND Apache-2.0 AND MIT",
    urls: ["https://raw.githubusercontent.com/bumptech/glide/master/LICENSE"],
  },
  "org.aomedia.avif.android": {
    title: "libavif for Android, with dav1d and libyuv",
    license: "BSD-2-Clause AND BSD-3-Clause",
    urls: [
      "https://raw.githubusercontent.com/AOMediaCodec/libavif/main/LICENSE",
      "https://code.videolan.org/videolan/dav1d/-/raw/master/COPYING",
      "https://chromium.googlesource.com/libyuv/libyuv/+/refs/heads/main/LICENSE?format=TEXT",
    ],
  },
  "io.github.lukmccall.pika": {
    title: "Pika",
    license: "MIT",
    // The project has no licence file; its POM declares MIT, by Łukasz Kosmaty, since 2025.
    urls: [],
  },
};

const PIKA_LICENSE = `MIT License

Copyright (c) 2025 Łukasz Kosmaty

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// ------------------------------------------------- native code, fonts and data

// What's compiled into the .so files or bundled as files, beyond the
// libraries above. `apache` ones join the Apache 2.0 entry.
const OTHER: { title: string; license: string; where: string; urls?: string[]; text?: string; apache?: boolean }[] = [
  {
    title: "Hermes",
    license: "MIT",
    where: "libhermesvm.so, libhermestooling.so",
    urls: ["https://raw.githubusercontent.com/facebook/hermes/main/LICENSE"],
  },
  { title: "Folly", license: "Apache-2.0", where: "libreactnative.so, libjsi.so", apache: true },
  {
    title: "glog 0.3.5",
    license: "BSD-3-Clause",
    where: "libreactnative.so",
    urls: ["https://raw.githubusercontent.com/google/glog/v0.3.5/COPYING"],
  },
  {
    title: "double-conversion",
    license: "BSD-3-Clause",
    where: "libreactnative.so and other React Native libraries",
    urls: ["https://raw.githubusercontent.com/google/double-conversion/master/LICENSE"],
  },
  {
    title: "fast_float",
    license: "MIT",
    where: "libreactnative.so, libjsi.so",
    urls: ["https://raw.githubusercontent.com/fastfloat/fast_float/main/LICENSE-MIT"],
  },
  {
    title: "{fmt}",
    license: "MIT",
    where: "libreactnative.so",
    urls: ["https://raw.githubusercontent.com/fmtlib/fmt/master/LICENSE"],
  },
  {
    title: "Boost",
    license: "BSL-1.0",
    where: "libreactnative.so",
    urls: ["https://www.boost.org/LICENSE_1_0.txt"],
  },
  {
    title: "LLVM libc++",
    license: "Apache-2.0 WITH LLVM-exception",
    where: "libc++_shared.so",
    urls: ["https://raw.githubusercontent.com/llvm/llvm-project/main/libcxx/LICENSE.TXT"],
  },
  {
    title: "libjpeg-turbo",
    license: "IJG AND BSD-3-Clause AND Zlib",
    where: "libnative-imagetranscoder.so (Fresco)",
    urls: ["https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/main/LICENSE.md"],
    text: "This software is based in part on the work of the Independent JPEG Group.",
  },
  {
    title: "libwebp",
    license: "BSD-3-Clause",
    where: "libstatic-webp.so (Fresco)",
    urls: ["https://raw.githubusercontent.com/webmproject/libwebp/main/COPYING"],
  },
  {
    title: "giflib",
    license: "MIT",
    where: "libgifimage.so (Fresco)",
    urls: ["https://sourceforge.net/p/giflib/code/ci/master/tree/COPYING?format=raw"],
  },
  {
    title: "Zstandard",
    license: "BSD-3-Clause",
    where: "libzstd-kmp.so",
    urls: ["https://raw.githubusercontent.com/facebook/zstd/dev/LICENSE"],
  },
  {
    title: "SQLite",
    license: "blessing",
    where: "libexpo-sqlite.so",
    text: "SQLite is in the public domain. The author disclaims copyright to its source code, and in place of a legal notice, here is a blessing:\n\n    May you do good and not evil.\n    May you find forgiveness for yourself and forgive others.\n    May you share freely, never taking more than you give.\n\nhttps://sqlite.org/copyright.html",
  },
  {
    title: "Ionicons (font)",
    license: "MIT",
    where: "Ionicons.ttf, through @expo/vector-icons",
    urls: ["https://raw.githubusercontent.com/ionic-team/ionicons/main/LICENSE"],
  },
  {
    title: "Roboto Medium, numbers only (font)",
    license: "Apache-2.0",
    where: "in AndroidX Media3 UI",
    apache: true,
  },
];

// ----------------------------------------------------------------- the output

/** A name for npm packages listed together. */
function projectName(components: string[]): string {
  const names = components.map((component) => component.replace(/@[^@/]+$/, ""));
  const known: [RegExp, string][] = [
    [/^(expo|@expo\/)/, "Expo"],
    [/^(react(-dom|-is|-native)?|scheduler|@react-native\/.*)$/, "React and React Native"],
    [/^prosemirror-/, "ProseMirror"],
  ];
  for (const [pattern, name] of known) {
    if (names.every((item) => pattern.test(item))) {
      return name;
    }
  }
  const unique = [...new Set(names)];
  return unique.length === 2 ? `${unique[0]} and ${unique[1]}` : `${unique[0]} and ${unique.length - 1} more`;
}

const texts: string[] = [];
function textId(text: string): number {
  const at = texts.indexOf(text);
  return at === -1 ? texts.push(text) - 1 : at;
}

async function main() {
  const entries: Entry[] = [];
  const keys = new Map<string, Entry>();
  // Components with the same `key` are listed together; a missing key keeps one apart.
  const add = (title: string, license: string, components: string[], ids: number[], key?: string) => {
    const same = key ? keys.get(key) : undefined;
    if (same) {
      same.components.push(...components);
      return;
    }
    const entry = { title, license, components: [...components], texts: ids };
    entries.push(entry);
    if (key) {
      keys.set(key, entry);
    }
  };

  // npm packages: compiled-in JavaScript, linked native modules, and the
  // emoji data the app's emoji JSON is generated from.
  console.log("Exporting the app to see which npm packages it's made of…");
  const packageDirs = new Set(bundledPackages());
  const linked = linkedExpoModules();
  for (const name of [...linked, "@emoji-mart/data"]) {
    packageDirs.add(`node_modules/${name}`);
  }
  console.log("Reading Gradle's release dependencies…");
  const gradle = gradleDependencies();
  // Gradle names a scoped package's project without the @ and with - or _ for the /.
  const projectOf = (name: string) => name.replace(/^@/, "").replace(/[/_]/g, "-");
  for (const project of gradle.projects) {
    const name = existsSync(join(NODE_MODULES, project))
      ? project
      : (linked.find((module) => projectOf(module) === projectOf(project)) ?? `@${project.replace("_", "/")}`);
    if (!existsSync(join(NODE_MODULES, name, "package.json"))) {
      throw new Error(`Can't tell which npm package Gradle's project :${project} is`);
    }
    packageDirs.add(`node_modules/${name}`);
  }

  const npm: { name: string; version: string; license: string; ids: number[] }[] = [];
  for (const dir of packageDirs) {
    const path = join(ROOT, dir);
    const pkg = readJson(join(path, "package.json"));
    let found = packageTexts(path);
    if (!found.length) {
      const shared = SHARED_LICENSE.find(([pattern]) => pattern.test(pkg.name));
      if (shared) {
        found = packageTexts(join(NODE_MODULES, shared[1]));
      } else if (FETCHED_LICENSE[pkg.name]) {
        found = [normal(await fetchText(FETCHED_LICENSE[pkg.name]))];
      } else {
        throw new Error(`${pkg.name} has no licence file; add it to SHARED_LICENSE or FETCHED_LICENSE`);
      }
    }
    const license = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "see text");
    npm.push({ name: pkg.name, version: pkg.version, license, ids: found.map(textId) });
  }
  // A package can be there twice (nested copies); one line each version.
  const seen = new Set<string>();
  for (const pkg of npm.sort((a, b) => a.name.localeCompare(b.name))) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.add(key);
      // Packages of one project share their licence file word for word.
      add(pkg.name, pkg.license, [key], pkg.ids, `npm:${pkg.license}:${pkg.ids.join()}`);
    }
  }
  for (const entry of entries.filter((item) => item.components.length > 1)) {
    entry.title = projectName(entry.components);
  }

  // Android libraries.
  const apacheText = textId(normal(readFileSync(join(NODE_MODULES, "mathjax-full/LICENSE"), "utf8")));
  const apache: string[] = [];
  const notices = new Set<number>();
  const fetched = new Map<string, number[]>();
  for (const { group, artifact, version } of gradle.maven.sort((a, b) =>
    `${a.group}:${a.artifact}`.localeCompare(`${b.group}:${b.artifact}`),
  )) {
    if (COVERED_BY_NPM.test(group)) {
      continue;
    }
    const name = `${group}:${artifact}:${version}`;
    const special = ANDROID_TEXTS[`${group}:${artifact}`] ?? ANDROID_TEXTS[group];
    const declared = pomLicenses(group, artifact, version);
    if (special) {
      if (!fetched.has(special.title)) {
        const ids =
          special.title === "Pika"
            ? [textId(PIKA_LICENSE)]
            : await Promise.all(special.urls.map(async (url) => textId(normal(await fetchText(url)))));
        fetched.set(special.title, ids);
      }
      add(special.title, special.license, [name], fetched.get(special.title)!, `android:${special.title}`);
    } else if (declared.length && declared.every((license) => /apache/i.test(license))) {
      apache.push(name);
    } else {
      throw new Error(`${name} is under ${declared.join(", ") || "an unknown licence"}; add it to ANDROID_TEXTS`);
    }
    for (const notice of libraryNotices(group, artifact, version)) {
      notices.add(textId(notice));
    }
  }

  // Native code, fonts and data from elsewhere.
  console.log("Fetching licences of the native libraries…");
  for (const other of OTHER) {
    const component = `${other.title} (${other.where})`;
    if (other.apache) {
      apache.push(component);
      continue;
    }
    const found = await Promise.all((other.urls ?? []).map(async (url) => normal(await fetchText(url))));
    if (other.text) {
      found.push(other.text);
    }
    add(other.title, other.license, [component], found.map(textId));
  }
  entries.push({
    title: "Android libraries under the Apache License 2.0",
    license: "Apache-2.0",
    components: apache,
    texts: [apacheText, ...notices],
  });

  entries.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  const version = readJson(join(ROOT, "package.json")).version;
  writeFileSync(join(ROOT, "src/lib/licenses.json"), `${JSON.stringify({ version, entries, texts })}\n`);

  const rule = "=".repeat(78);
  const plain = [
    `Inkharbor ${version}: third-party licences`,
    "",
    "Inkharbor is MIT licensed (see LICENSE). The Android app is built with the",
    "software below, under these licences. The same list is in the app, under",
    "Settings > Open-source licences.",
    "",
    ...entries.flatMap((entry) => [
      rule,
      `${entry.title} (${entry.license})`,
      ...entry.components.map((component) => `  ${component}`),
      "",
      ...entry.texts.flatMap((id) => [texts[id], ""]),
    ]),
  ];
  writeFileSync(join(ROOT, "THIRD-PARTY-LICENSES.txt"), `${plain.join("\n").trimEnd()}\n`);

  const count = entries.reduce((sum, entry) => sum + entry.components.length, 0);
  console.log(`${entries.length} entries, ${count} components, ${texts.length} licence texts.`);
}

await main();
