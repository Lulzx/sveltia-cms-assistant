// Copy to assistant.config.mjs and fill in. Every key is optional except
// site.name, site.url and posts.urlPattern; admin/config.js holds the
// defaults for the rest.
//
// Everything here except `admin` and `csp` ships to the browser, so put no
// secrets in it. Keys come from environment variables at build time.

export default {
  site: {
    name: "Example",
    url: "https://example.com/",
    // One or two sentences the model reads to understand the site.
    about: "Example publishes practical guides for people setting up a home office.",
    // Who reads the posts.
    audience: "People working from home who want a better setup without overspending.",
    // Appended to the title in <title>. Omit for " — <site.name>".
    // titleSuffix: " | Example",
    // Other hosts that count as internal links.
    // internalHosts: ["docs.example.com"],
  },

  posts: {
    // Where a published post lives. {{slug}} is replaced.
    urlPattern: "https://example.com/blog/{{slug}}/",
    // JSON list of published posts the writer may link to; see
    // examples/posts-index. Must send Access-Control-Allow-Origin for the
    // admin's origin. Leave out to disable internal-link suggestions.
    indexUrl: "https://example.com/blog/posts.json",
  },

  // Frontmatter field names, if yours differ from these.
  // fields: {
  //   title: "title",
  //   description: "description",
  //   body: "body",
  //   keyphrase: "keyphrase",
  //   cover: "cover",
  //   coverAlt: "coverAlt",
  //   tags: "tags",
  // },

  // House style, one rule per line.
  voice: [
    "Plain, direct and specific. Short sentences. Second person.",
    "US English.",
    "Recommend a product only with the reason it suits a specific kind of reader.",
  ],

  // Pages besides published posts the model may link to.
  links: [{ url: "https://example.com/tools/desk-height", description: "the desk height calculator" }],

  // A call to action worked in once per post. Omit for none.
  cta: { text: "work out your desk height", url: "https://example.com/tools/desk-height" },

  // Post formats offered as chips in the Write view. The description is what
  // the model is told.
  // formats: [
  //   { id: "howto", label: "How-to", description: "a how-to guide: ..." },
  // ],

  // Length chips.
  // lengths: [
  //   { id: "short", label: "Short · 600", words: 600 },
  //   { id: "standard", label: "Standard · 1,000", words: 1000 },
  //   { id: "long", label: "Long · 1,600", words: 1600 },
  // ],

  // Replace the built-in quick actions (Continue, Add FAQ, Add takeaway,
  // Tighten, Simplify, Link posts). Icons are Material Symbols names.
  // quickActions: [
  //   { label: "Add example", icon: "science", instruction: "Add one worked example ..." },
  // ],

  placeholders: {
    brief: "e.g. Why most people set their monitor too low, and the two measurements that fix it",
    keyphrase: "e.g. monitor height ergonomics",
    instruction: "Tell the editor what to change… e.g. open with the measuring-tape example",
  },

  // Default OpenRouter model; OPENROUTER_MODEL at build time overrides it.
  // model: "openrouter/free",

  // ---- build-only: not sent to the browser --------------------------------

  admin: {
    title: "Example — Admin",
    favicon: "https://example.com/favicon.svg",
  },

  // Extra origins for the admin page's Content-Security-Policy. The site's
  // own origins (site.url, posts.urlPattern, posts.indexUrl) are added
  // automatically. Add an OAuth proxy's origin here if config.yml has a
  // backend base_url.
  // csp: { connect: ["https://auth.example.com"], img: [] },
};
