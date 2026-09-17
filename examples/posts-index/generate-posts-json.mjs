// Framework-agnostic: read a folder of Markdown posts and write posts.json.
// Run it as part of your site's build, after the posts are in place:
//
//   node generate-posts-json.mjs src/content/posts "https://example.com/blog/{{slug}}/" public/posts.json
//
// It reads simple frontmatter only: `key: value` scalars and `tags` as either
// [a, b] or a `- item` list. That covers what cms.config.example.yml writes.
// If your frontmatter is richer, swap parseFrontmatter for gray-matter.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const [folder, urlPattern, output] = process.argv.slice(2);
if (!folder || !urlPattern?.includes("{{slug}}") || !output) {
  console.error('usage: generate-posts-json.mjs <posts folder> "<url with {{slug}}>" <output file>');
  process.exit(1);
}

function unquote(value) {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const data = {};
  if (!match) return data;
  let listKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, raw] = pair;
    listKey = null;
    if (raw === "") {
      data[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(raw)) {
      data[key] = raw.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      data[key] = unquote(raw);
    }
  }
  return data;
}

const posts = readdirSync(folder)
  .filter((file) => [".md", ".markdown", ".mdx"].includes(extname(file)))
  .map((file) => {
    const data = parseFrontmatter(readFileSync(join(folder, file), "utf8"));
    const slug = data.slug || basename(file, extname(file));
    return { data, slug };
  })
  .filter(({ data }) => data.title && String(data.draft) !== "true")
  .sort((a, b) => String(b.data.pubDate ?? "").localeCompare(String(a.data.pubDate ?? "")))
  .map(({ data, slug }) => ({
    title: data.title,
    description: data.description ?? "",
    url: urlPattern.replace("{{slug}}", slug),
    tags: Array.isArray(data.tags) ? data.tags : [],
  }));

writeFileSync(output, JSON.stringify(posts, null, 2) + "\n");
console.log(`wrote ${posts.length} posts to ${output}`);
