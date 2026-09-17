// Everything the editor's panel needs to talk to a model and to write the
// answer back into the entry: the OpenRouter transport, the prompts for each
// job, and the field-driving helpers that put text into Sveltia's own inputs.
//
// The model is whatever the build names, and by default `openrouter/free`,
// OpenRouter's router over its free models. It picks one at random per
// request, so nothing here assumes a particular model: JSON is asked for
// with a schema *and* spelled out in the prompt, then dug out of whatever
// arrives; markdown is asked for with rules the weaker models can follow.
//
// Who the site is, its voice and the links it allows come from config.js.
// Loaded after config.js and analysis.js; exposed as window.CMSAssistant.ai.

(function () {
  var config = window.CMSAssistant.config;
  var FIELDS = config.fields;
  var TIMEOUT = 150000;

  function key() {
    return window.CMS_ASSISTANT_KEY || "";
  }

  function model() {
    return window.CMS_ASSISTANT_MODEL || config.model;
  }

  // ------------------------------------------------------------- prompts

  var SUFFIX = config.site.titleSuffix;
  var BUDGET = config.titleBudget;

  function quote(text) {
    return "\u201c" + text + "\u201d";
  }

  // What every job is held to. Written for a model that has never seen the
  // site: who it is writing for, what the voice is, and what it may not do.
  var VOICE = (function () {
    var lines = ["You write for " + config.site.name + " (" + config.site.url + ")."];
    if (config.site.about) lines.push(config.site.about);
    if (config.site.audience) lines.push("Readers: " + config.site.audience);
    lines.push("", "Voice:");
    [].concat(config.voice || []).forEach(function (rule) {
      lines.push("- " + rule);
    });
    lines.push(
      "- No hype and no filler \u2014 never \u201cunlock\u201d, \u201cin today's fast-paced world\u201d, \u201cgame-changer\u201d,",
      "  \u201cdive in\u201d, \u201cit's important to note\u201d. Do not open with a rhetorical question.",
      "",
      "Facts: never invent a number, a date, a statistic, a study or a quote. When a number is needed",
      "and none was given, write around it or use an obviously illustrative one and say so.",
      "",
      "Links: never invent a URL. You may link to " + allowedLinks() + ". Nothing else.",
    );
    return lines;
  })();

  function allowedLinks() {
    var list = [config.site.url + " (the home page)"];
    (config.links || []).forEach(function (link) {
      list.push(link.url + (link.description ? " (" + link.description + ")" : ""));
    });
    if (config.cta && config.cta.url) list.push(config.cta.url);
    list.push("the site's own posts when a list of them is provided");
    return list.join(", ");
  }

  var JSON_ONLY = "Answer with one JSON object and nothing else: no prose around it, no markdown fence.";

  // SEO rules the article and the outline are both written against; they
  // mirror the checks in analysis.js so a fresh draft starts mostly green.
  var SEO_RULES = [
    "SEO rules:",
    "- The focus keyphrase appears in the first paragraph, in at least one ## heading, and",
    "  naturally through the text at 0.5–2% of the words. Never stuffed.",
    "- Headings are ## and ### only. Never a # heading — the title is a separate field.",
    "- No stretch of more than 300 words without a heading. Paragraphs under 100 words.",
    "- At most a quarter of sentences over 25 words. Under 10% passive voice.",
    "- Use transition words (however, so, because, for example, then) in about a third of sentences.",
  ].concat(
    config.cta && config.cta.url
      ? ["- Link the phrase " + quote(config.cta.text || "learn more") + " (or similar) to " + config.cta.url + " once."]
      : [],
  );

  var TASKS = {
    /**
     * A plan for a new post: title, description, keyphrase, tags and the
     * ## headings with one line each about what goes under them.
     */
    outline: {
      json: true,
      maxTokens: 1500,
      system: VOICE.concat(
        [
          "",
          "You are planning a blog post from an editor's brief. Return a plan, not the post.",
          "",
          "- title: at most " + BUDGET + " characters (" + quote(SUFFIX) + " is appended and the total must fit " + config.titleLimit + ");",
          "  starts with or contains the keyphrase; specific, no clickbait.",
          "- keyphrase: two to four words a reader would actually type into Google. Use the one",
          "  given if there is one.",
          "- description: 120–156 characters, contains the keyphrase, reads as a sentence someone would click.",
          "- tags: two to four, lowercase, hyphenated. Reuse the existing tags where they fit.",
          "- sections: 4–7 ## headings in reading order. Each has a `note`: one line on what the",
          "  section says. At least one heading contains the keyphrase. The last section is a short",
          "  takeaway or a “what to do” list. Add a “Frequently asked questions” section only for a",
          "  guide with obvious questions.",
          "",
          JSON_ONLY,
          'Shape: {"title": "...", "keyphrase": "...", "description": "...", "tags": ["..."],',
          ' "sections": [{"heading": "...", "note": "..."}]}',
        ],
      ),
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          keyphrase: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: { heading: { type: "string" }, note: { type: "string" } },
              required: ["heading", "note"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "keyphrase", "description", "tags", "sections"],
        additionalProperties: false,
      },
      user: function (input) {
        return [
          "BRIEF: " + (input.brief || "(none — work from the keyphrase and title)"),
          "FORMAT: " + describeFormat(input.format),
          "TARGET LENGTH: about " + wordTarget(input.length) + " words",
          "FOCUS KEYPHRASE: " + (input.keyphrase || "(none yet — propose one)"),
          "CURRENT TITLE: " + (input.title || "(none)"),
          "EXISTING TAGS ON THE SITE: " + (input.siteTags && input.siteTags.length ? input.siteTags.join(", ") : "(none)"),
          postsBlock(input.posts),
        ].join("\n");
      },
    },

    /** The post itself, written to a plan. Markdown, streamed. */
    article: {
      json: false,
      maxTokens: 6000,
      system: VOICE.concat(
        [""],
        SEO_RULES,
        [
          "",
          "Write the whole post in Markdown from the outline. Rules:",
          "- Start with the opening paragraph — no title line, no front matter, no preamble.",
          "- Use exactly the ## headings in the outline, in order. Add ### only inside a section.",
          "- Concrete over general: a worked example with real figures beats an abstract claim.",
          "  Mark invented figures as examples (\u201csay 40 minutes\u201d).",
          "- Lists where the reader would scan: steps, checks, comparisons. Prose elsewhere.",
          "- One short blockquote at most, and only if it earns its place.",
          "- Where a related post from the list fits, link it once with its exact URL.",
          "- Hit the target length within about 15%.",
          "- Output the Markdown only. No commentary before or after it.",
        ],
      ),
      user: function (input) {
        var plan = input.outline || {};
        return [
          "TITLE: " + (plan.title || input.title || ""),
          "FOCUS KEYPHRASE: " + (plan.keyphrase || input.keyphrase || ""),
          "META DESCRIPTION: " + (plan.description || ""),
          "TARGET LENGTH: about " + wordTarget(input.length) + " words",
          "FORMAT: " + describeFormat(input.format),
          "BRIEF: " + (input.brief || "(none)"),
          "",
          "OUTLINE:",
          (plan.sections || [])
            .map(function (section) {
              return "## " + section.heading + (section.note ? "\n   " + section.note : "");
            })
            .join("\n"),
          postsBlock(input.posts),
        ].join("\n");
      },
    },

    /**
     * Edits to an existing body from an instruction — the freeform box and
     * every quick action. Same edit shape the SEO fixes use, plus an empty
     * `where` for text that goes on the end.
     */
    improve: {
      json: true,
      maxTokens: 3500,
      system: VOICE.concat(
        [""],
        SEO_RULES,
        [
          "",
          "You are editing a draft post to an instruction. Return edits, not the whole post.",
          "",
          "- Each edit is a replacement: `where` quotes the existing text to replace, exactly as it",
          "  appears and long enough to be unambiguous (a whole sentence or paragraph); `fix` is the",
          "  new text; `why` is one short clause.",
          "- To add text at the end of the post, use an empty `where` and put the new section in `fix`.",
          "- Keep to the instruction. Do not touch text it does not concern.",
          "- At most six edits, most valuable first. Return an empty array if nothing should change.",
          "",
          JSON_ONLY,
          'Shape: {"edits": [{"where": "...", "fix": "...", "why": "..."}]}',
        ],
      ),
      schema: editsSchema(),
      user: function (input) {
        return [
          "INSTRUCTION: " + input.instruction,
          "",
          "FOCUS KEYPHRASE: " + (input.keyphrase || "(none set)"),
          "TITLE: " + (input.title || "(none)"),
          postsBlock(input.posts),
          "",
          "BODY:",
          input.body || "(empty)",
        ].join("\n");
      },
    },

    /** Titles, keyphrases and reader questions to pick from before writing. */
    ideas: {
      json: true,
      maxTokens: 1200,
      system: VOICE.concat([
        "",
        "You are brainstorming for a post. Return options, not a post.",
        "",
        "- titles: five, each at most " + BUDGET + " characters, each containing the keyphrase or its closest",
        "  natural form. Vary the angle: how-to, mistake to avoid, comparison, timing, checklist.",
        "- keyphrases: six related phrases readers search, two to four words, most specific first.",
        "  Include the long-tail forms, not just synonyms.",
        "- questions: five questions a reader types into Google about this topic, phrased as they",
        "  would type them.",
        "",
        JSON_ONLY,
        'Shape: {"titles": ["..."], "keyphrases": ["..."], "questions": ["..."]}',
      ]),
      schema: {
        type: "object",
        properties: {
          titles: { type: "array", items: { type: "string" } },
          keyphrases: { type: "array", items: { type: "string" } },
          questions: { type: "array", items: { type: "string" } },
        },
        required: ["titles", "keyphrases", "questions"],
        additionalProperties: false,
      },
      user: function (input) {
        return [
          "TOPIC / BRIEF: " + (input.brief || "(none)"),
          "FOCUS KEYPHRASE: " + (input.keyphrase || "(none yet)"),
          "CURRENT TITLE: " + (input.title || "(none)"),
          "OPENING OF THE DRAFT: " + (input.excerpt || "(nothing written yet)"),
        ].join("\n");
      },
    },

    /** The SEO panel's fixes: the metadata half. */
    meta: {
      json: true,
      maxTokens: 600,
      system: VOICE.concat([
        "",
        "You are fixing the metadata of a draft post against specific SEO checks.",
        "",
        "- Fix only the checks listed. Leave everything else exactly as it is.",
        "- The rendered page title is your title plus " + quote(SUFFIX) + " (" + SUFFIX.length + " characters) and the whole",
        "  thing has to fit " + config.titleLimit + ", so keep the title itself at or under " + BUDGET + " characters.",
        "- The description must read as a sentence a human would click, contain the keyphrase, and",
        "  land between 120 and 156 characters.",
        "- A keyphrase is two to four words someone would actually type into Google.",
        "- Return all three fields. Any the checks did not ask you to touch, return exactly as they are.",
        "",
        JSON_ONLY,
        'Shape: {"title": "...", "description": "...", "keyphrase": "..."}',
      ]),
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          keyphrase: { type: "string" },
        },
        required: ["title", "description", "keyphrase"],
        additionalProperties: false,
      },
      user: function (input) {
        return [
          "FOCUS KEYPHRASE: " + (input.keyphrase || "(none set)"),
          "TITLE: " + (input.title || "(none)"),
          "DESCRIPTION: " + (input.description || "(none)"),
          "SLUG: " + (input.slug || "(none)"),
          "",
          "FIX THESE CHECKS:",
          bullets(input.checks),
          "",
          "OPENING OF THE BODY:",
          // A headline job does not need the whole article, and a shorter
          // prompt is a faster first token.
          (input.prose || "").slice(0, 1200),
        ].join("\n");
      },
    },

    /** The SEO panel's fixes: the body half. */
    body: {
      json: true,
      maxTokens: 3000,
      system: VOICE.concat(
        [""],
        SEO_RULES,
        [
          "",
          "You are fixing the body of a draft post against specific SEO and readability checks.",
          "",
          "- Fix only the checks listed. Leave everything else exactly as it is.",
          "- Each edit is a replacement: `where` quotes enough of the existing text to locate it",
          "  unambiguously, `fix` is the text that replaces it, `why` is one short clause.",
          "- For a word-count check, `where` may quote a paragraph to extend and `fix` is that",
          "  paragraph rewritten longer. To add a whole new section, use an empty `where`.",
          "- For an outbound-source check, do not fabricate a citation: leave the sentence as prose",
          "  and say in `why` what the writer should go and link.",
          "- At most four edits, most valuable first. Return an empty array if the body needs nothing.",
          "",
          JSON_ONLY,
          'Shape: {"edits": [{"where": "...", "fix": "...", "why": "..."}]}',
        ],
      ),
      schema: editsSchema(),
      user: function (input) {
        return [
          "FOCUS KEYPHRASE: " + (input.keyphrase || "(none set)"),
          "TITLE: " + (input.title || "(none)"),
          "DESCRIPTION: " + (input.description || "(none)"),
          postsBlock(input.posts),
          "",
          "FIX THESE CHECKS:",
          bullets(input.checks),
          "",
          "BODY:",
          input.body || "(empty)",
        ].join("\n");
      },
    },
  };

  function editsSchema() {
    return {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: { where: { type: "string" }, fix: { type: "string" }, why: { type: "string" } },
            required: ["where", "fix", "why"],
            additionalProperties: false,
          },
        },
      },
      required: ["edits"],
      additionalProperties: false,
    };
  }

  function bullets(lines) {
    return (lines || [])
      .map(function (line) {
        return "- " + line;
      })
      .join("\n");
  }

  function describeFormat(id) {
    var formats = config.formats || [];
    for (var i = 0; i < formats.length; i += 1) {
      if (formats[i].id === id) return formats[i].description || formats[i].label;
    }
    return formats.length ? formats[0].description || formats[0].label : "a blog post";
  }

  function wordTarget(id) {
    var lengths = config.lengths || [];
    for (var i = 0; i < lengths.length; i += 1) {
      if (lengths[i].id === id) return lengths[i].words;
    }
    return lengths.length ? lengths[Math.floor(lengths.length / 2)].words : 1000;
  }

  /** The site's published posts, as the one set of internal links allowed. */
  function postsBlock(posts) {
    if (!posts || !posts.length) return "";
    return (
      "\nPUBLISHED POSTS YOU MAY LINK TO (exact URLs):\n" +
      posts
        .slice(0, 40)
        .map(function (post) {
          return "- " + post.title + " — " + post.url;
        })
        .join("\n")
    );
  }

  // ----------------------------------------------------------- transport

  /**
   * Pull the answer out of whatever the model sent. A fenced block, a
   * sentence of throat-clearing before the object, or bare JSON all parse;
   * anything else is reported as what it is rather than as a syntax error.
   */
  function readJson(content) {
    var text = String(content || "").replace(/```(?:json)?/gi, "").trim();
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (error) {
        /* fall through to the message below */
      }
    }
    throw new Error("The model answered in prose, not JSON. Try again — the free router picks a different model each time.");
  }

  /**
   * Markdown as the article task should return it, with the wrapping the
   * weaker free models add anyway taken off: a fence around the whole thing,
   * a leading title line, a trailing sign-off.
   */
  function readMarkdown(content) {
    var text = String(content || "").trim();
    var fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
    if (fenced) text = fenced[1].trim();
    // A # title line, or "Title: ..." — the title lives in its own field.
    text = text.replace(/^(?:#\s+[^\n]*|\*{0,2}Title:?\*{0,2}\s*[^\n]*)\n+/, "");
    // Front matter the model may have mimicked from somewhere.
    text = text.replace(/^---\n[\s\S]*?\n---\n+/, "");
    return text.trim();
  }

  /**
   * One streamed completion. Resolves with the whole content; `onDelta` gets
   * the running content so the caller can show it arriving. `signal` aborts.
   */
  function stream(task, input, signal, onDelta) {
    var spec = TASKS[task];
    var body = {
      model: model(),
      stream: true,
      temperature: spec.json ? 0.3 : 0.7,
      max_tokens: spec.maxTokens,
      messages: [
        { role: "system", content: spec.system.join("\n") },
        { role: "user", content: spec.user(input) },
      ],
    };
    // With a schema attached the free router only picks models that support
    // structured output, which is the closest thing to a promise of JSON.
    if (spec.json && spec.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "assistant_" + task, strict: true, schema: spec.schema },
      };
    }

    // No HTTP-Referer or X-Title header: OpenRouter reads both as app
    // attribution, and nothing here needs to announce itself.
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key(), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal,
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          if (response.status === 429) {
            throw new Error("Rate limited — the free tier allows about 20 requests a minute. Wait a moment and try again.");
          }
          var detail = text.slice(0, 200);
          try {
            detail = JSON.parse(text).error.message;
          } catch (ignored) {
            /* not the error shape; the raw text will do */
          }
          throw new Error("OpenRouter " + response.status + ": " + detail);
        });
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var content = "";
      var failure = null;

      // SSE: "data: {json}" lines, ": comment" keep-alives, "data: [DONE]".
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            if (failure) throw new Error(failure);
            if (!content.trim()) throw new Error("The model returned nothing. Try again.");
            return content;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop();
          lines.forEach(function (line) {
            if (line.indexOf("data: ") !== 0) return;
            var payload = line.slice(6).trim();
            if (payload === "[DONE]") return;
            try {
              var parsed = JSON.parse(payload);
              // A provider can fail mid-stream; OpenRouter relays that as an
              // error frame rather than a status code.
              if (parsed.error && parsed.error.message) failure = parsed.error.message;
              var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
              if (delta && delta.content) {
                content += delta.content;
                if (onDelta) onDelta(content);
              }
            } catch (ignored) {
              /* a partial frame; the next chunk completes it */
            }
          });
          return pump();
        });
      }

      return pump();
    });
  }

  /**
   * stream(), retried when the free tier's limiter answers or the router
   * lands on a model that returns nothing. Each try may reach a different
   * model, which is the point.
   */
  function complete(task, input, options) {
    options = options || {};
    var tries = 0;
    var spec = TASKS[task];
    var signal = options.signal;
    var delays = [4000, 8000];

    function attempt() {
      return stream(task, input, signal, options.onDelta).catch(function (error) {
        var retriable = /^Rate limited|returned nothing/.test(error.message);
        if (!retriable || tries >= delays.length || (signal && signal.aborted)) throw error;
        var delay = delays[tries];
        tries += 1;
        if (options.onRetry) options.onRetry(tries, delay);
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            attempt().then(resolve, reject);
          }, delay);
        });
      });
    }

    return attempt().then(function (content) {
      return spec.json ? readJson(content) : readMarkdown(content);
    });
  }

  // -------------------------------------------------------------- posts
  //
  // The published posts, so a draft can link to real pages rather than
  // invented ones. The site publishes the list at posts.indexUrl (see
  // examples/posts-index) with a CORS header that lets the admin origin read
  // it. Fetched once per session; a failure or no URL just means no internal
  // links are offered.

  var postsPromise = null;

  function sitePosts() {
    if (!postsPromise && !config.posts.indexUrl) postsPromise = Promise.resolve([]);
    if (!postsPromise) {
      postsPromise = fetch(config.posts.indexUrl, { cache: "no-store" })
        .then(function (response) {
          return response.ok ? response.json() : [];
        })
        .then(function (list) {
          return Array.isArray(list)
            ? list.filter(function (post) {
                return post && post.title && post.url;
              })
            : [];
        })
        .catch(function () {
          return [];
        });
    }
    return postsPromise;
  }

  /** Every tag in use on the site, most used first. */
  function siteTags(posts) {
    var counts = Object.create(null);
    posts.forEach(function (post) {
      (post && Array.isArray(post.tags) ? post.tags : []).forEach(function (tag) {
        if (typeof tag !== "string") return;
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a];
    });
  }

  // ------------------------------------------------------------- fields
  //
  // A widget can only set its own value through onChange, so writing into
  // somebody else's field means driving the editor's own input. Sveltia
  // stamps every field wrapper with data-key-path, which is a far steadier
  // handle than a label, and its inputs are Svelte-bound: set the value
  // through the native setter and dispatch `input`, and the draft updates
  // exactly as if it had been typed.
  //
  // The body is the interesting one. The Markdown field renders a Lexical
  // rich-text editor *and* a plain <textarea> bound to the Markdown source;
  // the textarea is only hidden in rich-text mode, and its setter reconverts
  // the Markdown into Lexical nodes. So writing to that textarea updates the
  // WYSIWYG view and the draft together.

  /** Set a Svelte-bound input the way a keystroke would. */
  function setNativeValue(element, text) {
    var prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fieldWrapper(keyPath) {
    return document.querySelector('[data-key-path="' + keyPath + '"]');
  }

  /** The editable element of a field, by the key path Sveltia stamps on it. */
  function fieldInput(keyPath) {
    var wrapper = fieldWrapper(keyPath);
    if (!wrapper) return null;
    return wrapper.querySelector('textarea, input[type="text"], input:not([type])');
  }

  function setField(keyPath, text) {
    var input = fieldInput(keyPath);
    if (!input) return false;
    setNativeValue(input, text);
    return true;
  }

  function bodyText() {
    var input = fieldInput(FIELDS.body);
    return input ? input.value : "";
  }

  function setBody(text) {
    return setField(FIELDS.body, text);
  }

  /** Add to the end of the body, separated by a blank line. */
  function appendToBody(text) {
    var current = bodyText();
    return setBody(current.trim() ? current.replace(/\s+$/, "") + "\n\n" + text.trim() + "\n" : text.trim() + "\n");
  }

  /**
   * Find `needle` in `haystack` allowing any run of whitespace to stand in for
   * any other. The model quotes the text it is replacing, and a quote that
   * crossed a line break in the source arrives with the break in a different
   * place. Returns [start, end] or null.
   */
  function looseFind(haystack, needle) {
    var exact = haystack.indexOf(needle);
    if (exact !== -1) return [exact, exact + needle.length];

    var pattern = needle
      .trim()
      .split(/\s+/)
      .map(function (word) {
        return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("\\s+");
    var match = new RegExp(pattern).exec(haystack);
    return match ? [match.index, match.index + match[0].length] : null;
  }

  /**
   * Apply one edit to the body: replace the quoted passage, or append when
   * nothing was quoted. Reads the current text out of the field rather than
   * any analysis, so several edits applied in a row each see the ones before.
   */
  function applyBodyEdit(edit) {
    if (!edit.where || !edit.where.trim()) return appendToBody(edit.fix);
    var input = fieldInput(FIELDS.body);
    if (!input) return false;
    var at = looseFind(input.value, edit.where);
    if (!at) return false;
    setNativeValue(input, input.value.slice(0, at[0]) + edit.fix + input.value.slice(at[1]));
    return true;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Add tags the post does not already have. The list widget has no single
   * input to write to: each tag is its own row, made by the list's Add
   * button and filled in through the input Sveltia renders for it. Resolves
   * with how many went in.
   */
  function addTags(tags, existing) {
    var wrapper = fieldWrapper(FIELDS.tags);
    var have = (existing || []).map(function (tag) {
      return tag.toLowerCase();
    });
    var fresh = (tags || []).filter(function (tag) {
      return tag && have.indexOf(tag.toLowerCase()) === -1;
    });
    if (!wrapper || !fresh.length) return Promise.resolve(0);

    var added = 0;
    function next(index) {
      if (index >= fresh.length) return Promise.resolve(added);
      // An empty list keeps its Add button in the top toolbar; one with rows
      // moves it below them. The label is the steady part.
      var add = wrapper.querySelector('button[data-label^="Add"]') || wrapper.querySelector(".toolbar.bottom.add button");
      if (!add) return Promise.resolve(added);
      var before = wrapper.querySelectorAll(".item-list > *").length;
      add.click();
      // The row is rendered on the next tick; give Svelte one frame.
      return wait(60).then(function () {
        var input = wrapper.querySelector('[data-key-path="' + FIELDS.tags + "." + before + '"] input');
        if (!input) return added;
        setNativeValue(input, fresh[index]);
        added += 1;
        have.push(fresh[index].toLowerCase());
        return wait(40).then(function () {
          return next(index + 1);
        });
      });
    }
    return next(0);
  }

  /** Resolves true once the text is on the clipboard, false if it could not be. */
  function copy(text) {
    try {
      return navigator.clipboard.writeText(String(text)).then(
        function () {
          return true;
        },
        function () {
          return false;
        },
      );
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  window.CMSAssistant.ai = {
    model: model,
    hasKey: function () {
      return !!key();
    },
    TIMEOUT: TIMEOUT,
    complete: complete,
    readJson: readJson,
    sitePosts: sitePosts,
    siteTags: siteTags,
    wordTarget: wordTarget,
    readMarkdown: readMarkdown,
    looseFind: looseFind,
    fields: {
      set: setField,
      input: fieldInput,
      body: bodyText,
      setBody: setBody,
      appendToBody: appendToBody,
      applyBodyEdit: applyBodyEdit,
      addTags: addTags,
      copy: copy,
    },
  };
})();
