// The one place the assistant learns about the site it is running for.
//
// scripts/build.mjs turns assistant.config.mjs into settings.js, which sets
// window.CMS_ASSISTANT_SETTINGS before this file runs. Here those settings
// are laid over the defaults, the derived values (title budget, internal
// hosts, the snippet breadcrumb) are worked out once, and the result is
// exposed as window.CMSAssistant.config for analysis.js, ai.js and panel.js.
//
// Nothing below names a site. A build with no settings at all still boots:
// the analysis runs and the writer says it has no key.

(function () {
  var settings = window.CMS_ASSISTANT_SETTINGS || {};

  var DEFAULTS = {
    site: {
      // Shown to the model and in the snippet preview.
      name: "My Site",
      // Home page. Links to this origin (and to relative paths) count as internal.
      url: "https://example.com/",
      // What the site is, in a sentence or two, for the model.
      about: "",
      // Who reads the posts, for the model.
      audience: "",
      // Appended to the post title in <title>. null means " — <site.name>".
      titleSuffix: null,
      // Extra hosts that count as internal links (e.g. a docs subdomain).
      internalHosts: [],
    },

    posts: {
      // Where a post lives once published. {{slug}} is replaced.
      urlPattern: "https://example.com/blog/{{slug}}/",
      // JSON list of published posts: [{ title, url, description?, tags? }].
      // The writer may only link to these. Empty string turns it off.
      indexUrl: "",
    },

    // Frontmatter field names, as in config.yml. Change these if your
    // collection calls them something else.
    fields: {
      title: "title",
      description: "description",
      body: "body",
      keyphrase: "keyphrase",
      cover: "cover",
      coverAlt: "coverAlt",
      tags: "tags",
    },

    // House style, one rule per line. Appended to the built-in rules against
    // filler and invented facts.
    voice: ["Plain, direct and specific. Short sentences. Second person."],

    // Pages besides published posts the model may link to.
    // [{ url: "https://example.com/pricing", description: "pricing page" }]
    links: [],

    // An optional call to action the writer works in once per post.
    // { text: "start a free trial", url: "https://example.com/signup" }
    cta: null,

    formats: [
      { id: "howto", label: "How-to", description: "a how-to guide: the steps in order, what to check at each, and the mistakes to avoid" },
      { id: "explainer", label: "Explainer", description: "an explainer: how one thing works and what it means for the reader" },
      { id: "comparison", label: "Comparison", description: "a comparison: two or three options side by side, with a clear recommendation per kind of reader" },
      { id: "listicle", label: "List", description: "a list post: numbered items, each self-contained, with a one-line verdict each" },
      { id: "opinion", label: "Opinion", description: "an opinion piece: one clear argument, the strongest objection, and why the argument still holds" },
    ],

    lengths: [
      { id: "short", label: "Short · 600", words: 600 },
      { id: "standard", label: "Standard · 1,000", words: 1000 },
      { id: "long", label: "Long · 1,600", words: 1600 },
    ],

    // null keeps the built-in quick actions (panel.js). An array replaces
    // them: [{ label, icon (Material Symbols name), instruction }].
    quickActions: null,

    placeholders: {
      brief: "e.g. The three settings most people get wrong on day one, and how to tell whether you did",
      keyphrase: "e.g. how to choose a standing desk",
      instruction: "Tell the editor what to change… e.g. make the intro shorter and lead with the example",
    },

    // OpenRouter model id. "openrouter/free" routes to a random free model.
    model: "openrouter/free",

    // localStorage key prefix for the panel's remembered view and chips.
    storagePrefix: "cmsAssistant.",
  };

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  /** Deep-merge plain objects; arrays and scalars in `over` replace. */
  function merge(base, over) {
    var out = {};
    Object.keys(base).forEach(function (key) {
      out[key] = base[key];
    });
    Object.keys(over || {}).forEach(function (key) {
      var value = over[key];
      if (value === undefined) return;
      out[key] = isObject(base[key]) && isObject(value) ? merge(base[key], value) : value;
    });
    return out;
  }

  var config = merge(DEFAULTS, settings);

  if (config.site.titleSuffix == null) config.site.titleSuffix = " — " + config.site.name;
  // Google shows about 60 characters of a title; the suffix spends some.
  config.titleLimit = 60;
  config.titleBudget = Math.max(20, config.titleLimit - config.site.titleSuffix.length);

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch (error) {
      return "";
    }
  }

  config.internalHosts = [config.site.url, config.posts.urlPattern.replace("{{slug}}", "x")]
    .map(hostOf)
    .concat(
      (config.site.internalHosts || []).map(function (host) {
        return String(host).replace(/^www\./, "").toLowerCase();
      }),
    )
    .filter(function (host, index, all) {
      return host && all.indexOf(host) === index;
    });

  config.postUrl = function (slug) {
    return config.posts.urlPattern.replace("{{slug}}", slug || "…");
  };

  /** "example.com › blog › slug", the way Google draws a result's URL. */
  config.breadcrumb = function (slug) {
    try {
      var url = new URL(config.posts.urlPattern.replace("{{slug}}", "__slug__"));
      var parts = url.pathname.split("/").filter(Boolean);
      return [url.hostname.replace(/^www\./, "")]
        .concat(
          parts.map(function (part) {
            return part === "__slug__" ? slug || "…" : part;
          }),
        )
        .join(" › ");
    } catch (error) {
      return slug || "…";
    }
  };

  config.isInternalLink = function (href) {
    if (!/^https?:\/\//i.test(href)) return true;
    return config.internalHosts.indexOf(hostOf(href)) !== -1;
  };

  window.CMSAssistant = window.CMSAssistant || {};
  window.CMSAssistant.config = config;
})();
