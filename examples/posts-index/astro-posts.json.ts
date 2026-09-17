// Astro: src/pages/posts.json.ts (or under your blog's route).
//
// The published posts as a list the assistant may link to. Drafts are left
// out: there is nothing at their URL yet. Point posts.indexUrl in
// assistant.config.mjs at wherever this is served.
//
// The admin runs on another origin, so the response needs a CORS header.
// A static build cannot set headers from here; add the header in your host
// instead (see README.md in this folder), or keep it here if the route is
// server-rendered.

import { getCollection } from "astro:content";

const SITE = "https://example.com/blog"; // no trailing slash

export async function GET() {
  const posts = (await getCollection("posts", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  return new Response(
    JSON.stringify(
      posts.map((post) => ({
        title: post.data.title,
        description: post.data.description,
        url: `${SITE}/${post.id}/`,
        tags: post.data.tags ?? [],
      })),
    ),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      },
    },
  );
}
