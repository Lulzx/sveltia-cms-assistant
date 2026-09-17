// The browser scripts have no module system, so each test loads them into a
// fresh VM context the way index.html does: settings, config, analysis, ai.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const admin = join(dirname(fileURLToPath(import.meta.url)), "../admin");

function load(settings) {
  const context = { URL, console, setTimeout, clearTimeout, TextDecoder, AbortController };
  context.window = context;
  context.CMS_ASSISTANT_SETTINGS = settings;
  vm.createContext(context);
  for (const file of ["config.js", "analysis.js", "ai.js"]) {
    vm.runInContext(readFileSync(join(admin, file), "utf8"), context, { filename: file });
  }
  return context.CMSAssistant;
}

/** Just enough of Sveltia's Immutable entry for readPost. */
function entry(data, slug) {
  const map = (object) => ({
    get: (key) => {
      const value = object[key];
      return Array.isArray(value) ? { toArray: () => value } : value;
    },
  });
  return { get: (key) => (key === "data" ? map(data) : key === "slug" ? slug : undefined) };
}

const SETTINGS = {
  site: { name: "Acme", url: "https://acme.test/" },
  posts: { urlPattern: "https://acme.test/notes/{{slug}}/" },
};

test("defaults fill in and the title suffix follows the site name", () => {
  const { config } = load(SETTINGS);
  assert.equal(config.site.titleSuffix, " — Acme");
  assert.equal(config.titleBudget, 60 - " — Acme".length);
  assert.equal(config.fields.body, "body");
  assert.equal(config.breadcrumb("hello-world"), "acme.test › notes › hello-world");
});

test("a custom suffix and nested overrides merge without dropping defaults", () => {
  const { config } = load({ ...SETTINGS, site: { ...SETTINGS.site, titleSuffix: " | Acme Blog" }, fields: { body: "content" } });
  assert.equal(config.site.titleSuffix, " | Acme Blog");
  assert.equal(config.fields.body, "content");
  assert.equal(config.fields.title, "title");
});

test("links to the site's hosts and relative paths are internal", () => {
  const { config } = load({ ...SETTINGS, site: { ...SETTINGS.site, internalHosts: ["docs.acme.test"] } });
  assert.ok(config.isInternalLink("/pricing"));
  assert.ok(config.isInternalLink("https://www.acme.test/x"));
  assert.ok(config.isInternalLink("https://docs.acme.test/y"));
  assert.ok(!config.isInternalLink("https://elsewhere.test/"));
});

test("readPost uses the configured field names and suffix", () => {
  const { analysis } = load({ ...SETTINGS, fields: { title: "heading", body: "content" } });
  const post = analysis.readPost(
    entry(
      {
        heading: "Standing desk height",
        description: "How high a standing desk should be.",
        content: "Set your standing desk height first.\n\n## Standing desk height by body size\n\nSee [the tool](/tool) and [a study](https://elsewhere.test/s).",
        tags: ["desks"],
      },
      "standing-desk-height",
    ),
    "standing desk height",
  );
  assert.equal(post.renderedTitle, "Standing desk height — Acme");
  assert.deepEqual(post.tags, ["desks"]);
  assert.equal(post.internalLinks, 1);
  assert.equal(post.externalLinks, 1);
  assert.equal(post.headings.length, 1);
});

test("the SEO checks see the keyphrase in title, slug, opening and headings", () => {
  const { analysis } = load(SETTINGS);
  const post = analysis.readPost(
    entry({ title: "Standing desk height", body: "Standing desk height matters.\n\n## Standing desk height guide\n\nText." }, "standing-desk-height"),
    "Standing desk height",
  );
  const texts = analysis
    .analyseSeo(post)
    .filter((r) => r.status === analysis.GOOD)
    .map((r) => r.text);
  assert.ok(texts.includes("The title opens with the keyphrase."));
  assert.ok(texts.includes("The keyphrase is in the URL slug."));
  assert.ok(texts.includes("The keyphrase appears in the opening paragraph."));
  assert.ok(texts.some((t) => /1 of 1 subheadings contain the keyphrase/.test(t)));
});

test("an over-long rendered title fails against the suffix-adjusted limit", () => {
  const { analysis } = load(SETTINGS);
  const post = analysis.readPost(entry({ title: "x".repeat(55), body: "" }, "x"), "");
  const title = analysis.analyseSeo(post).find((r) => r.field === "title");
  assert.equal(title.status, analysis.BAD);
});

test("the score is two points per green and one per orange", () => {
  const { analysis } = load(SETTINGS);
  assert.equal(analysis.score([{ status: "good" }, { status: "ok" }, { status: "bad" }]), 50);
});

test("JSON is dug out of a fenced, chatty reply", () => {
  const { ai } = load(SETTINGS);
  assert.equal(JSON.stringify(ai.readJson('Sure! ```json\n{"edits": []}\n``` hope that helps')), '{"edits":[]}');
  assert.throws(() => ai.readJson("no json here"), /prose, not JSON/);
});

test("markdown loses the fence, title line and front matter the model adds", () => {
  const { ai } = load(SETTINGS);
  assert.equal(ai.readMarkdown("```markdown\n# A title\n\nBody text.\n```"), "Body text.");
  assert.equal(ai.readMarkdown("---\ntitle: x\n---\nBody."), "Body.");
});

test("a quoted passage is found across different line breaks", () => {
  const { ai } = load(SETTINGS);
  const haystack = "One two\nthree four five.";
  assert.deepEqual([...ai.looseFind(haystack, "two three\nfour")], [4, 18]);
  assert.equal(ai.looseFind(haystack, "six"), null);
});

test("formats and lengths come from the config", () => {
  const { ai } = load({ ...SETTINGS, lengths: [{ id: "tiny", label: "Tiny", words: 250 }] });
  assert.equal(ai.wordTarget("tiny"), 250);
  assert.equal(ai.wordTarget("unknown"), 250);
});

test("adjacent links are each counted, and images are not links", () => {
  const { analysis } = load(SETTINGS);
  const post = analysis.readPost(entry({ title: "t", body: "[a](/a)[b](https://elsewhere.test/b) ![i](/i.png)" }, "t"), "");
  assert.equal(post.internalLinks, 1);
  assert.equal(post.externalLinks, 1);
});
