// Assembles the static admin bundle: the page, the CMS config, the pinned
// Sveltia build out of node_modules, the assistant, and two generated files.
//
//   auth.js      signs the editor in with CMS_GITHUB_TOKEN, if set. Sveltia
//                reads a token from the hash route #/signin/<base64 json> and
//                clears it from the URL straight after, so seeding that route
//                before the CMS script runs skips the login screen. Without
//                the variable the file is inert and the normal sign-in shows.
//   settings.js  the site settings from assistant.config.mjs, plus
//                OPENROUTER_API_KEY and OPENROUTER_MODEL if set.
//
// Either secret makes the output a secret: serve it only behind auth.
//
// Usage:
//   node scripts/build.mjs [--config assistant.config.mjs] [--cms cms.config.yml] [--out dist]

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: "assistant.config.mjs" },
    cms: { type: "string", default: "cms.config.yml" },
    out: { type: "string", default: "dist" },
  },
});

const configPath = resolve(args.config);
const cmsPath = resolve(args.cms);
const out = resolve(args.out);

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

if (!existsSync(configPath)) {
  fail(`${args.config} not found. Copy assistant.config.example.mjs to assistant.config.mjs and fill it in.`);
}
if (!existsSync(cmsPath)) {
  fail(`${args.cms} not found. Copy cms.config.example.yml to cms.config.yml and fill it in.`);
}

const settings = (await import(pathToFileURL(configPath).href)).default ?? {};
const cms = readFileSync(cmsPath, "utf8");

// ------------------------------------------------------------ validation

const problems = [];
if (!settings.site?.name) problems.push("site.name is required");
for (const [path, value] of [
  ["site.url", settings.site?.url],
  ["posts.urlPattern", settings.posts?.urlPattern],
]) {
  if (!value) problems.push(`${path} is required`);
  else if (!URL.canParse(value.replace("{{slug}}", "x"))) problems.push(`${path} is not an absolute URL: ${value}`);
}
if (settings.posts?.urlPattern && !settings.posts.urlPattern.includes("{{slug}}")) {
  problems.push("posts.urlPattern must contain {{slug}}");
}
if (settings.posts?.indexUrl && !URL.canParse(settings.posts.indexUrl)) {
  problems.push(`posts.indexUrl is not an absolute URL: ${settings.posts.indexUrl}`);
}
if (problems.length) fail(`${args.config}:\n  - ${problems.join("\n  - ")}`);

if (!/widget:\s*["']?seo["']?/.test(cms)) {
  console.warn(`build: warning: no field in ${args.cms} uses \`widget: seo\`, so the assistant will not appear.`);
}
const keyphraseField = settings.fields?.keyphrase ?? "keyphrase";
if (!new RegExp(`name:\\s*["']?${keyphraseField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?`).test(cms)) {
  console.warn(`build: warning: no field named "${keyphraseField}" in ${args.cms}; set fields.keyphrase to the seo field's name.`);
}

// --------------------------------------------------------------- secrets

const token = process.env.CMS_GITHUB_TOKEN ?? "";
if (token && !/^(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)$/.test(token)) {
  fail("CMS_GITHUB_TOKEN does not look like a GitHub token");
}
const aiKey = process.env.OPENROUTER_API_KEY ?? "";
if (aiKey && !/^sk-or-[A-Za-z0-9-]+$/.test(aiKey)) {
  fail("OPENROUTER_API_KEY does not look like an OpenRouter key");
}
const aiModel = process.env.OPENROUTER_MODEL ?? "";
if (aiModel && !/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(aiModel)) {
  fail("OPENROUTER_MODEL does not look like an OpenRouter model id (vendor/model)");
}

// ---------------------------------------------------------------- sveltia

/** node_modules/@sveltia/cms, found from the kit or from the working directory upward. */
function findSveltia() {
  for (let dir of [root, process.cwd()]) {
    for (;;) {
      const candidate = join(dir, "node_modules/@sveltia/cms/dist/sveltia-cms.js");
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const sveltia = findSveltia();
if (!sveltia) fail("@sveltia/cms is not installed. Run `npm install` first.");

// ------------------------------------------------------------------ page

function origin(url) {
  try {
    return new URL(url.replace("{{slug}}", "x")).origin;
  } catch {
    return null;
  }
}

const unique = (list) => [...new Set(list.filter(Boolean))];
const siteOrigins = unique([origin(settings.site.url), origin(settings.posts.urlPattern)]);
const connect = unique([...siteOrigins, origin(settings.posts?.indexUrl ?? ""), ...(settings.csp?.connect ?? [])]);
const img = unique([...siteOrigins, ...(settings.csp?.img ?? [])]);

const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const admin = settings.admin ?? {};
const page = readFileSync(join(root, "admin/index.html"), "utf8")
  .replace("%%TITLE%%", escapeHtml(admin.title ?? `${settings.site.name} — Admin`))
  .replace(
    "%%FAVICON%%",
    admin.favicon ? `<link rel="icon" href="${escapeHtml(admin.favicon)}" />` : "<!-- no admin.favicon set -->",
  )
  .replace("%%CSP_CONNECT%%", connect.map((o) => " " + o).join(""))
  .replace("%%CSP_IMG%%", img.map((o) => " " + o).join(""));

// ----------------------------------------------------------------- write

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

writeFileSync(join(out, "index.html"), page);
writeFileSync(join(out, "config.yml"), cms);
for (const file of ["panel.css", "config.js", "analysis.js", "ai.js", "panel.js"]) {
  cpSync(join(root, "admin", file), join(out, file));
}
cpSync(sveltia, join(out, "sveltia-cms.js"));

const DO_NOT_PUBLISH = "// Generated by scripts/build.mjs — do not edit, and do not serve this bundle\n// anywhere that is not behind authentication.\n";

writeFileSync(
  join(out, "auth.js"),
  token
    ? `${DO_NOT_PUBLISH}(function () {
  var hash = window.location.hash;
  // Leave deep links alone: only an empty route means "just opened the admin".
  if (hash && hash !== "#" && hash !== "#/") return;
  window.location.hash =
    "#/signin/" + btoa(JSON.stringify({ token: ${JSON.stringify(token)} }));
})();
`
    : "// Generated by scripts/build.mjs. CMS_GITHUB_TOKEN was not set, so the CMS\n// shows its own sign-in screen.\n",
);

// Build-only keys stay out of the browser.
const { admin: _admin, csp: _csp, ...runtime } = settings;
writeFileSync(
  join(out, "settings.js"),
  (aiKey ? DO_NOT_PUBLISH : "// Generated by scripts/build.mjs. OPENROUTER_API_KEY was not set, so the\n// assistant's writer and Fix buttons are disabled.\n") +
    `window.CMS_ASSISTANT_SETTINGS = ${JSON.stringify(runtime, null, 2)};\n` +
    (aiKey ? `window.CMS_ASSISTANT_KEY = ${JSON.stringify(aiKey)};\n` : "") +
    (aiModel ? `window.CMS_ASSISTANT_MODEL = ${JSON.stringify(aiModel)};\n` : ""),
);

console.log(`admin bundle written to ${out}`);
console.log(token ? "  sign-in: embedded GitHub token (serve behind auth)" : "  sign-in: Sveltia's own screen");
console.log(
  aiKey
    ? `  assistant: enabled (${aiModel || settings.model || "openrouter/free"}) (serve behind auth)`
    : "  assistant: analysis only (no OPENROUTER_API_KEY)",
);
