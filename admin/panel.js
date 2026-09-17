// The writing assistant in the Sveltia CMS entry editor: a sidebar panel
// with two views.
//
//   Write    — plan a post from a brief, write it, and improve what is
//              there: outline, full draft streamed as it arrives, title and
//              keyphrase ideas, and edits to an instruction.
//   Optimise — the Yoast-style analysis from analysis.js, with a Fix button
//              on every failing check.
//
// It is registered as one custom widget, `seo`, whose value is the focus
// keyphrase — so the phrase a post was written for is kept in the post's own
// frontmatter. Sveltia hands a custom control the whole entry as an
// Immutable map and re-renders it whenever any field changes, which is what
// lets the analysis run on every keystroke and the writer read the draft.
//
// No build step and no bundler: React is not importable here, so elements
// are built with window.h (React.createElement, exposed by the CMS) and the
// component is a createClass component. Styles are in panel.css.
//
// config.js, analysis.js and ai.js load first; this file boots the CMS at
// the end.

(function () {
  var h = window.h;
  var config = window.CMSAssistant.config;
  var FIELDS = config.fields;
  var A = window.CMSAssistant.analysis;
  var AI = window.CMSAssistant.ai;
  var F = AI.fields;

  var GOOD = A.GOOD;
  var OK = A.OK;
  var BAD = A.BAD;
  var COLORS = { good: "#137333", ok: "#b06000", bad: "#c5221f" };

  // ------------------------------------------------------------ prefs

  var PREFIX = config.storagePrefix;

  function pref(name, fallback) {
    try {
      var value = window.localStorage.getItem(PREFIX + name);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function setPref(name, value) {
    try {
      window.localStorage.setItem(PREFIX + name, value);
    } catch (error) {
      /* private browsing; the default is fine */
    }
  }

  // --------------------------------------------------------- elements

  function icon(name) {
    return h("span", { className: "icon material-symbols-outlined", "aria-hidden": "true" }, name);
  }

  /** A button. `kind` picks the style variants, `icon` a leading glyph. */
  function button(props, label) {
    var attrs = Object.assign({ type: "button" }, props, { className: "ca-btn" + (props.kind ? " " + props.kind : "") });
    delete attrs.kind;
    delete attrs.icon;
    return h("button", attrs, props.icon ? icon(props.icon) : null, label);
  }

  function chip(label, pressed, onClick, disabled, key) {
    return h(
      "button",
      { key: key, type: "button", className: "ca-chip", "aria-pressed": String(!!pressed), onClick: onClick, disabled: !!disabled },
      label,
    );
  }

  function bullet(status) {
    return h("span", { className: "ca-bullet", "aria-hidden": "true", style: { backgroundColor: COLORS[status] } });
  }

  function card(title, children, extra, className) {
    return h(
      "div",
      { className: "ca-card" + (className ? " " + className : "") },
      title ? h("div", { className: "ca-card-title" }, title, h("span", { className: "ca-spacer" }), extra || null) : null,
      children,
    );
  }

  function wordCount(markdown) {
    return A.words(A.stripMarkdown(markdown)).length;
  }

  function headingCount(markdown) {
    var matches = String(markdown || "").match(/^\s{0,3}##\s+/gm);
    return matches ? matches.length : 0;
  }

  // -------------------------------------------------------- placement
  //
  // The panel belongs in the editor's right sidebar, as one more tab beside
  // validation and history, so it can be put away like they can. That sidebar
  // is a Svelte component with a fixed array of tabs and no hook to add one,
  // so the tab is added to the DOM instead: a clone of a real tab button (a
  // clone, so it inherits every class and state style Sveltia gives them) and
  // a panel that mirrors the markup of theirs.
  //
  // React's root container — the div Sveltia mounts the widget in — is then
  // moved into that panel. It has to be the container and not the node React
  // rendered: React 18 attaches its event listeners to the container, so a
  // rendered node moved out from under it looks fine and answers no clicks.
  // React does not care where in the document its container sits.
  //
  // Everything here is anchored on the tab strip's aria-controls, which is
  // present whether or not a tab is open. If the strip is not found nothing
  // moves and the panel stays in the form, which is only the old behaviour.

  var TAB_ICON = "auto_awesome";
  var TAB_LABEL = "Assistant";

  function tabStrip() {
    return document.querySelector('[aria-controls="entry-sidebar-content"]');
  }

  /** A tab button of our own, cut from one of theirs. */
  function makeTabButton(strip) {
    var model = strip.querySelector("button");
    if (!model) return null;

    var button = model.cloneNode(true);
    button.classList.add("ca-tab");
    button.setAttribute("aria-label", TAB_LABEL);
    button.setAttribute("aria-checked", "false");
    button.removeAttribute("data-label");
    button.removeAttribute("data-value");
    button.disabled = false;
    button.removeAttribute("disabled");
    button.removeAttribute("aria-disabled");

    var glyph = button.querySelector(".icon");
    if (glyph) glyph.textContent = TAB_ICON;

    strip.appendChild(button);
    return button;
  }

  /** A panel shaped like the ones in panel-container.svelte. */
  function makeTabPanel(sidebar, strip) {
    var panel = document.createElement("section");
    panel.className = "ca-panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", TAB_LABEL);

    var header = document.createElement("header");
    var title = document.createElement("h3");
    title.textContent = TAB_LABEL;
    header.appendChild(title);
    var model = document.createElement("span");
    model.className = "ca-model";
    model.title = "The model every request goes to";
    model.textContent = AI.model();
    header.appendChild(model);

    var body = document.createElement("div");
    body.className = "ca-body";

    panel.appendChild(header);
    panel.appendChild(body);
    // Same slot their own content div occupies.
    sidebar.insertBefore(panel, strip.nextSibling);
    return panel;
  }

  // ----------------------------------------------------------- widget

  var DEFAULT_QUICK_ACTIONS = [
    {
      label: "Continue",
      icon: "playlist_add",
      instruction:
        "Continue the post from where it ends: add the one or two sections it is obviously missing, in the same voice, ending with a short takeaway if there is none.",
    },
    {
      label: "Add FAQ",
      icon: "quiz",
      instruction:
        "Append a “## Frequently asked questions” section: three or four questions readers type into Google about the focus keyphrase, each as a ### heading, each answered in two or three plain sentences.",
    },
    {
      label: "Add takeaway",
      icon: "checklist",
      instruction:
        "Append a short closing section headed “## The short version”: a three-to-five item list of what the reader should actually do" +
        (config.cta && config.cta.url
          ? ", then one sentence that links “" + (config.cta.text || "learn more") + "” to " + config.cta.url + " ."
          : "."),
    },
    {
      label: "Tighten",
      icon: "compress",
      instruction:
        "Cut filler. Find the weakest sentences and paragraphs — throat-clearing, repetition, generic advice — and either delete them or rewrite them shorter. Keep every fact and every heading.",
    },
    {
      label: "Simplify",
      icon: "lightbulb",
      instruction:
        "Make the hardest passages easier to read: split sentences over 25 words, swap passive voice for active, replace jargon with the plain word. Do not change the meaning.",
    },
    {
      label: "Link posts",
      icon: "link",
      instruction:
        "Where one of the published posts is genuinely relevant, link to it once from an existing sentence (or add one short sentence to introduce it). Use the exact URLs given. Do not add a link that does not fit.",
    },
  ];

  var QUICK_ACTIONS = Array.isArray(config.quickActions) ? config.quickActions : DEFAULT_QUICK_ACTIONS;

  var Control = window.createClass({
    displayName: "AssistantPanel",

    getInitialState: function () {
      return {
        view: pref("view", "write"),

        // Write
        brief: "",
        format: pref("format", (config.formats[0] || {}).id || ""),
        length: pref("length", (config.lengths[Math.floor(config.lengths.length / 2)] || {}).id || ""),
        ideas: null,
        outline: null,
        draft: "",
        draftDone: false,
        draftInserted: false,
        confirmReplace: false,
        instruction: "",
        edits: null, // { label, list }
        applied: {},

        // Optimise. `selected` is keyed by the check's own text: the checks
        // are rebuilt on every keystroke, so an index would drift as issues
        // come and go, and a check that has been fixed stops being offered.
        selected: {},
        meta: null,
        fixEdits: null,
        fixing: [],

        // One job at a time; a job may have several parts in flight.
        job: null, // { label, parts, chars, retry }
        seconds: 0,
        error: "",
        note: "",

        posts: [],
      };
    },

    componentDidMount: function () {
      var self = this;
      this.relocate(0);
      AI.sitePosts().then(function (posts) {
        if (self.root) self.setState({ posts: posts });
      });
    },

    componentWillUnmount: function () {
      this.cancel(true);
      if (this.moveTimer) clearTimeout(this.moveTimer);
      if (this.strip && this.onStripClick) this.strip.removeEventListener("click", this.onStripClick, true);
      // React takes its own node with it; the tab and the panel are ours.
      if (this.panel && this.panel.parentElement) this.panel.remove();
      if (this.button && this.button.parentElement) this.button.remove();
      if (this.fieldWrapper) this.fieldWrapper.style.display = "";
      this.root = null;
    },

    // ------------------------------------------------------- placement

    /**
     * Add the tab, move the rendered panel into it, and keep it in step with
     * the sidebar's own tabs. Retries while the editor finishes mounting and
     * gives up quietly after a couple of seconds.
     */
    relocate: function (attempt) {
      var self = this;
      if (!this.root || this.panel) return;

      var strip = tabStrip();
      var sidebar = strip && strip.parentElement;
      if (!sidebar) {
        if (attempt > 20) return;
        this.moveTimer = setTimeout(function () {
          self.relocate(attempt + 1);
        }, 100);
        return;
      }

      var tab = makeTabButton(strip);
      if (!tab) return;

      this.strip = strip;
      this.button = tab;
      this.panel = makeTabPanel(sidebar, strip);
      this.panel.querySelector(".ca-body").appendChild(this.root.parentElement);

      tab.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        self.setOpen(self.button.getAttribute("aria-checked") !== "true");
      });

      // Their tabs and ours are one radio group in spirit if not in markup:
      // opening one closes the other. Capture, so this runs before Svelte
      // decides what its own sidebar is showing.
      this.onStripClick = function (event) {
        if (self.closingTheirs) return;
        if (!self.button.contains(event.target)) self.setOpen(false);
      };
      strip.addEventListener("click", this.onStripClick, true);

      // The field row it came from is now a label with nothing under it; the
      // panel carries its own keyphrase input.
      this.fieldWrapper = document.querySelector('[data-key-path="' + FIELDS.keyphrase + '"]');
      if (this.fieldWrapper) this.fieldWrapper.style.display = "none";

      this.setOpen(pref("open", "1") !== "0");
    },

    /** Show or hide the panel, closing whichever tab the other one had. */
    setOpen: function (open) {
      if (!this.button || !this.panel) return;
      this.button.setAttribute("aria-checked", String(open));
      // Not the `hidden` attribute: its UA rule loses to the inline display.
      this.panel.style.display = open ? "flex" : "none";

      if (open && this.strip) {
        // Close the sidebar's own tab so two panels never sit side by side.
        // Their handler toggles a tab off when it is already the active one.
        var active = this.strip.querySelector('[aria-checked="true"]:not(.ca-tab)');
        if (active) {
          // That click travels through the listener above, which would read
          // it as "a native tab was chosen" and close us again.
          this.closingTheirs = true;
          active.click();
          this.closingTheirs = false;
        }
      }

      setPref("open", open ? "1" : "0");
    },

    setView: function (view) {
      setPref("view", view);
      this.setState({ view: view });
    },

    // ------------------------------------------------------------ jobs

    /** Start a job of `parts` requests; returns the signal they share. */
    startJob: function (label, parts) {
      var self = this;
      var started = Date.now();
      this.aborter = new AbortController();
      this.timer = setInterval(function () {
        self.setState({ seconds: Math.round((Date.now() - started) / 1000) });
      }, 1000);
      this.deadline = setTimeout(function () {
        self.cancel();
        self.setState({ error: "Timed out after " + Math.round(AI.TIMEOUT / 1000) + " seconds. Try again, or ask for less at once." });
      }, AI.TIMEOUT);
      this.partsLeft = parts;
      this.setState({ job: { label: label, parts: parts, chars: 0, retry: 0 }, seconds: 0, error: "", note: "" });
      this.reveal(".ca-status", "nearest");
      return this.aborter.signal;
    },

    /**
     * One request of the job finished (or failed); the last one ends it.
     * The count lives on the instance, not in state: two parts can finish
     * in the same tick, and setState reads would both see the same number.
     */
    partDone: function () {
      if (!this.partsLeft) return;
      this.partsLeft -= 1;
      if (this.partsLeft === 0) {
        this.stopTimers();
        this.setState({ job: null, fixing: [] });
      } else {
        this.updateJob({ parts: this.partsLeft });
      }
    },

    /** Merge into the running job, reading the latest state, not a stale copy. */
    updateJob: function (patch) {
      this.setState(function (state) {
        return state.job ? { job: Object.assign({}, state.job, patch) } : null;
      });
    },

    stopTimers: function () {
      if (this.timer) clearInterval(this.timer);
      if (this.deadline) clearTimeout(this.deadline);
      if (this.frame) cancelAnimationFrame(this.frame);
      this.timer = this.deadline = this.frame = null;
      this.aborter = null;
      this.partsLeft = 0;
    },

    cancel: function (silent) {
      if (this.aborter) this.aborter.abort();
      this.stopTimers();
      if (silent) return;
      var update = { job: null, fixing: [], note: "Cancelled.", seconds: 0 };
      // Half a draft is no use; the plan it was written from stays.
      if (!this.state.draftDone) update.draft = "";
      this.setState(update);
    },

    /** Scroll the panel so `selector` is in view, once React has drawn it. */
    reveal: function (selector, block) {
      var self = this;
      setTimeout(function () {
        var node = self.panel && self.panel.querySelector(selector);
        if (node) node.scrollIntoView({ block: block || "start", behavior: "smooth" });
      }, 80);
    },

    /** Copy `text`, then show `copied` or, if the clipboard refused, `failed`. */
    copyWithNote: function (text, copied, failed, extra) {
      var self = this;
      F.copy(text).then(function (ok) {
        self.setState(Object.assign({ note: ok ? copied : failed }, extra));
      });
    },

    /** Report an error from a request unless it was our own abort. */
    fail: function (error) {
      if (error.name === "AbortError") return;
      this.setState({ error: error.message });
      this.partDone();
    },

    /**
     * Streaming callbacks arrive per token; batching them into one state
     * update per frame keeps a 6,000-token draft from re-rendering the panel
     * a few thousand times.
     */
    onDelta: function (extra) {
      var self = this;
      return function (content) {
        self.pending = Object.assign({ chars: content.length }, extra ? extra(content) : null);
        if (self.frame) return;
        self.frame = requestAnimationFrame(function () {
          self.frame = null;
          var update = self.pending;
          self.pending = null;
          if (!update || !self.partsLeft) return;
          var chars = update.chars;
          delete update.chars;
          self.updateJob({ chars: chars });
          self.setState(update);
        });
      };
    },

    onRetry: function () {
      var self = this;
      return function (count) {
        self.updateJob({ retry: count });
      };
    },

    /** The inputs every writing job gets: the post as it stands, the site. */
    inputs: function (post) {
      return {
        brief: this.state.brief,
        format: this.state.format,
        length: this.state.length,
        keyphrase: this.props.value || "",
        title: post.title,
        description: post.description,
        slug: post.slug,
        posts: this.state.posts,
        siteTags: AI.siteTags(this.state.posts),
      };
    },

    // ----------------------------------------------------------- write

    ideas: function (post) {
      var self = this;
      if (this.state.job) return;
      var signal = this.startJob("Thinking of angles", 1);
      var input = Object.assign(this.inputs(post), { excerpt: post.firstParagraph.slice(0, 600) });
      AI.complete("ideas", input, { signal: signal, onDelta: this.onDelta(), onRetry: this.onRetry() })
        .then(function (result) {
          self.setState({
            ideas: {
              titles: strings(result.titles).slice(0, 6),
              keyphrases: strings(result.keyphrases).slice(0, 8),
              questions: strings(result.questions).slice(0, 6),
            },
          });
          self.partDone();
        })
        .catch(function (error) {
          self.fail(error);
        });
    },

    /** Plan the post. Resolves with the outline, for writeNow to chain on. */
    outline: function (post, signal) {
      var self = this;
      return AI.complete("outline", this.inputs(post), {
        signal: signal,
        onDelta: this.onDelta(),
        onRetry: this.onRetry(),
      }).then(function (result) {
        var outline = {
          title: String(result.title || "").trim(),
          keyphrase: String(result.keyphrase || "").trim(),
          description: String(result.description || "").trim(),
          tags: strings(result.tags).map(function (tag) {
            return tag.trim().toLowerCase().replace(/\s+/g, "-");
          }),
          sections: (Array.isArray(result.sections) ? result.sections : [])
            .filter(Boolean)
            .map(function (section) {
              return { heading: String(section.heading || "").trim(), note: String(section.note || "").trim() };
            })
            .filter(function (section) {
              return section.heading;
            }),
        };
        self.setState({ outline: outline, draft: "", draftDone: false, draftInserted: false, confirmReplace: false });
        return outline;
      });
    },

    outlineOnly: function (post) {
      var self = this;
      if (this.state.job) return;
      var signal = this.startJob("Planning the post", 1);
      this.outline(post, signal)
        .then(function () {
          self.partDone();
        })
        .catch(function (error) {
          self.fail(error);
        });
    },

    /** Write the body from an outline, streaming into the preview. */
    article: function (post, outline, signal) {
      var self = this;
      var input = Object.assign(this.inputs(post), { outline: outline });
      return AI.complete("article", input, {
        signal: signal,
        onRetry: this.onRetry(),
        onDelta: this.onDelta(function (content) {
          return { draft: content };
        }),
      }).then(function (markdown) {
        self.setState({ draft: markdown, draftDone: true, draftInserted: false, confirmReplace: false });
        // Back to the top of the draft to read it, and bring its buttons up.
        var preview = self.panel && self.panel.querySelector(".ca-draft");
        if (preview) preview.scrollTop = 0;
        self.reveal(".ca-draft-card");
      });
    },

    /** One click: plan (unless a plan is on screen), then write. */
    writeNow: function (post) {
      var self = this;
      if (this.state.job) return;
      var existing = this.state.outline;
      var signal = this.startJob(existing ? "Writing the post" : "Planning, then writing", existing ? 1 : 2);
      this.setState({ draft: "", draftDone: false });

      var plan = existing
        ? Promise.resolve(existing)
        : this.outline(post, signal).then(function (outline) {
            self.partDone();
            return outline;
          });

      plan
        .then(function (outline) {
          self.updateJob({ label: "Writing the post" });
          return self.article(post, outline, signal);
        })
        .then(function () {
          self.partDone();
        })
        .catch(function (error) {
          // The chain stops at the first failure, so end the whole job here
          // rather than counting down one part and leaving it running.
          if (error.name === "AbortError") return;
          self.stopTimers();
          self.setState({ job: null, error: error.message });
        });
    },

    /**
     * Put the draft into the body, and the plan's metadata into any field
     * that is still empty. A body that already has text is only replaced on
     * a second click.
     *
     * The DOM writes go first and the keyphrase last, after a pause: our own
     * onChange hands Sveltia a snapshot of the draft, and one taken in the
     * same tick as the input events still has the old values in it.
     */
    insertDraft: function (post) {
      var self = this;
      var draft = this.state.draft;
      var outline = this.state.outline || {};
      if (post.body.trim() && !this.state.confirmReplace) {
        this.setState({ confirmReplace: true });
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(function () {
          self.setState({ confirmReplace: false });
        }, 8000);
        return;
      }

      if (!F.setBody(draft)) {
        this.copyWithNote(
          draft,
          "The body field could not be written to — the draft is on your clipboard.",
          "The body field could not be written to, and the clipboard is unavailable. Use Copy on the draft.",
          { confirmReplace: false },
        );
        return;
      }

      var filled = ["body"];
      if (!post.title.trim() && outline.title && F.set(FIELDS.title, outline.title)) filled.push("title");
      if (!post.description.trim() && outline.description && F.set(FIELDS.description, outline.description)) filled.push("description");
      this.setState({ confirmReplace: false, draftInserted: true, note: "Inserted: " + filled.join(", ") + "." });

      var wantKeyphrase = !(this.props.value || "").trim() && outline.keyphrase;
      var wantTags = !post.tags.length && outline.tags && outline.tags.length;
      if (!wantKeyphrase && !wantTags) return;

      setTimeout(function () {
        if (wantKeyphrase) {
          self.props.onChange(outline.keyphrase);
          filled.push("keyphrase");
        }
        var tags = wantTags ? F.addTags(outline.tags, post.tags) : Promise.resolve(0);
        tags.then(function (added) {
          if (added) filled.push(added + " tag" + (added === 1 ? "" : "s"));
          self.setState({ note: "Inserted: " + filled.join(", ") + "." });
        });
      }, 80);
    },

    applyOutlineField: function (key, post) {
      var outline = this.state.outline;
      var self = this;
      if (!outline) return;
      if (key === "keyphrase") {
        this.props.onChange(outline.keyphrase);
        this.setState({ note: "Keyphrase applied." });
      } else if (key === "tags") {
        F.addTags(outline.tags, post.tags).then(function (added) {
          self.setState({ note: added ? added + " tag" + (added === 1 ? "" : "s") + " added." : "Every tag was already there." });
        });
      } else if (F.set(FIELDS[key], outline[key])) {
        this.setState({ note: (key === "title" ? "Title" : "Description") + " applied." });
      } else {
        this.copyWithNote(outline[key], "Field not found — copied to the clipboard instead.", "Field not found, and the clipboard is unavailable.");
      }
    },

    editSection: function (index, heading) {
      var outline = this.state.outline;
      var sections = outline.sections.slice();
      sections[index] = Object.assign({}, sections[index], { heading: heading });
      this.setState({ outline: Object.assign({}, outline, { sections: sections }) });
    },

    removeSection: function (index) {
      var outline = this.state.outline;
      var sections = outline.sections.slice();
      sections.splice(index, 1);
      this.setState({ outline: Object.assign({}, outline, { sections: sections }) });
    },

    addSection: function () {
      var outline = this.state.outline;
      this.setState({ outline: Object.assign({}, outline, { sections: outline.sections.concat([{ heading: "", note: "" }]) }) });
    },

    /** Edits to the body from an instruction: the quick actions and the box. */
    improve: function (post, instruction, label) {
      var self = this;
      if (this.state.job || !instruction.trim()) return;
      var signal = this.startJob(label || "Editing", 1);
      var input = Object.assign(this.inputs(post), { instruction: instruction, body: F.body() || post.body });
      AI.complete("improve", input, { signal: signal, onDelta: this.onDelta(), onRetry: this.onRetry() })
        .then(function (result) {
          self.setState({ edits: { label: label || "Edits", list: cleanEdits(result.edits) }, applied: {} });
          self.partDone();
        })
        .catch(function (error) {
          self.fail(error);
        });
    },

    /**
     * Write one body edit into the Markdown field and remember that it went
     * in. Falls back to the clipboard when the quoted text cannot be found —
     * the model occasionally quotes a passage it has already rewritten.
     */
    applyEdit: function (edit) {
      if (F.applyBodyEdit(edit)) {
        var applied = Object.assign({}, this.state.applied);
        applied[editKey(edit)] = true;
        this.setState({ applied: applied, note: "Edit applied." });
        return true;
      }
      var self = this;
      F.copy(edit.fix).then(function (copied) {
        self.setState({
          note: "Could not find that passage" + (copied ? " — the replacement is on your clipboard." : ", and the clipboard is unavailable."),
        });
      });
      return false;
    },

    applyAll: function (list) {
      var self = this;
      var applied = 0;
      var missed = [];
      list.forEach(function (edit) {
        if (self.state.applied[editKey(edit)]) return;
        if (F.applyBodyEdit(edit)) {
          applied += 1;
          self.setState(function (state) {
            var done = Object.assign({}, state.applied);
            done[editKey(edit)] = true;
            return { applied: done };
          });
        } else {
          missed.push(edit.fix);
        }
      });
      var note = applied + " of " + list.length + " edits applied.";
      if (!missed.length) {
        this.setState({ note: note });
        return;
      }
      // One copy of every missed replacement, since each copy overwrites the last.
      F.copy(missed.join("\n\n")).then(function (copied) {
        var what = missed.length + " passage" + (missed.length === 1 ? " was" : "s were") + " not found in the body";
        self.setState({
          note: note + " " + what + (copied ? " — the replacement" + (missed.length === 1 ? " is" : "s are") + " on the clipboard." : "."),
        });
      });
    },

    // -------------------------------------------------------- optimise

    toggle: function (text) {
      var selected = Object.assign({}, this.state.selected);
      if (selected[text]) delete selected[text];
      else selected[text] = true;
      this.setState({ selected: selected });
    },

    selectAll: function (failing) {
      var selected = {};
      failing.forEach(function (result) {
        selected[result.text] = true;
      });
      this.setState({ selected: selected });
    },

    /** The checks a run should address: what is ticked, or everything. */
    targets: function (failing) {
      var selected = this.state.selected;
      var ticked = failing.filter(function (result) {
        return selected[result.text];
      });
      return ticked.length ? ticked : failing;
    },

    /**
     * Fix checks. Each check carries the half it belongs to (see
     * analysis.js): the metadata half is small and back in seconds, the body
     * half is slow. They are sent together and rendered as each lands, so a
     * title check never waits for the body to be rewritten.
     */
    runFix: function (post, checks) {
      var self = this;
      if (!checks.length || this.state.job) return;

      var groups = { meta: [], body: [] };
      checks.forEach(function (result) {
        groups[result.field === "body" ? "body" : "meta"].push(result.text);
      });
      var kinds = Object.keys(groups).filter(function (kind) {
        return groups[kind].length;
      });

      var signal = this.startJob("Fixing " + checks.length + " check" + (checks.length === 1 ? "" : "s"), kinds.length);
      this.setState({
        meta: null,
        fixEdits: null,
        applied: {},
        fixing: checks.map(function (result) {
          return result.text;
        }),
      });

      kinds.forEach(function (kind) {
        var input = Object.assign(self.inputs(post), { checks: groups[kind], prose: post.prose, body: post.body });
        AI.complete(kind, input, { signal: signal, onDelta: self.onDelta(), onRetry: self.onRetry() })
          .then(function (answer) {
            if (kind === "meta") {
              var meta = {};
              ["title", "description", "keyphrase"].forEach(function (key) {
                if (typeof answer[key] === "string") meta[key] = answer[key];
              });
              self.setState({ meta: meta });
            } else {
              self.setState({ fixEdits: cleanEdits(answer.edits) });
            }
            self.partDone();
          })
          .catch(function (error) {
            self.fail(error);
          });
      });
    },

    // ---------------------------------------------------------- render

    renderStatus: function () {
      var self = this;
      var job = this.state.job;
      if (!job) return null;
      var detail = [this.state.seconds + "s"];
      if (job.chars) detail.push(job.chars + " chars in");
      else detail.push("waiting for the first token");
      if (job.retry) detail.push("retry " + job.retry);
      return h(
        "div",
        { className: "ca-status", role: "status" },
        h("span", { className: "ca-pulse" }),
        h("span", { className: "ca-status-text" }, job.label + "…", h("small", null, detail.join(" · "))),
        button(
          {
            kind: "small",
            onClick: function () {
              self.cancel();
            },
          },
          "Cancel",
        ),
      );
    },

    renderMessages: function () {
      return [
        this.state.note ? h("p", { key: "note", className: "ca-note ca-good" }, this.state.note) : null,
        this.state.error ? h("p", { key: "error", className: "ca-error" }, this.state.error) : null,
      ];
    },

    renderNoKey: function () {
      return h(
        "div",
        { className: "ca-empty" },
        h("strong", null, "No model key in this build."),
        h(
          "p",
          { style: { margin: "6px 0 0" } },
          "Set the ",
          h("code", null, "OPENROUTER_API_KEY"),
          " when building the admin (see the README). The analysis in Optimise works without it.",
        ),
      );
    },

    renderBrief: function (post) {
      var self = this;
      var busy = !!this.state.job;
      var formats = config.formats.map(function (format) {
        return [format.id, format.label];
      });
      var lengths = config.lengths.map(function (length) {
        return [length.id, length.label];
      });

      return h(
        "div",
        { className: "ca-section", style: { marginTop: 0 } },
        h("label", { className: "ca-label", htmlFor: "ca-brief" }, "What should this post say?"),
        h("textarea", {
          id: "ca-brief",
          rows: 3,
          value: this.state.brief,
          placeholder: config.placeholders.brief,
          onChange: function (event) {
            self.setState({ brief: event.target.value });
          },
        }),
        h(
          "div",
          { className: "ca-row", style: { marginTop: 8 } },
          h("span", { className: "ca-muted", style: { width: 48 } }, "Format"),
          h(
            "div",
            { className: "ca-chips" },
            formats.map(function (pair) {
              return chip(
                pair[1],
                self.state.format === pair[0],
                function () {
                  setPref("format", pair[0]);
                  self.setState({ format: pair[0] });
                },
                busy,
                pair[0],
              );
            }),
          ),
        ),
        h(
          "div",
          { className: "ca-row", style: { marginTop: 6 } },
          h("span", { className: "ca-muted", style: { width: 48 } }, "Length"),
          h(
            "div",
            { className: "ca-chips" },
            lengths.map(function (pair) {
              return chip(
                pair[1],
                self.state.length === pair[0],
                function () {
                  setPref("length", pair[0]);
                  self.setState({ length: pair[0] });
                },
                busy,
                pair[0],
              );
            }),
          ),
        ),
        h(
          "div",
          { className: "ca-row", style: { marginTop: 10 } },
          button(
            {
              kind: "primary",
              icon: "auto_awesome",
              disabled: busy || (!this.state.brief.trim() && !(this.props.value || "").trim() && !post.title.trim()),
              title: "Plan the post and write it, in one go",
              onClick: function () {
                self.writeNow(post);
              },
            },
            this.state.outline ? "Write from outline" : "Write the post",
          ),
          button(
            {
              icon: "format_list_bulleted",
              disabled: busy,
              title: "Plan the headings first, so you can change them before anything is written",
              onClick: function () {
                self.outlineOnly(post);
              },
            },
            "Outline",
          ),
          button(
            {
              icon: "lightbulb",
              disabled: busy,
              title: "Title options, related keyphrases and the questions readers ask",
              onClick: function () {
                self.ideas(post);
              },
            },
            "Ideas",
          ),
        ),
        h(
          "p",
          { className: "ca-hint" },
          "A brief, a keyphrase or a title is enough to start. The draft is written to the plan and shown here first — nothing touches the post until you insert it.",
        ),
      );
    },

    renderIdeas: function (post) {
      var self = this;
      var ideas = this.state.ideas;
      if (!ideas) return null;
      var busy = !!this.state.job;

      return card(
        "Ideas",
        [
          h("div", { key: "t", className: "ca-label", style: { marginTop: 4 } }, "Titles"),
          h(
            "ul",
            { key: "tl", className: "ca-options" },
            ideas.titles.map(function (title, index) {
              return h(
                "li",
                { key: index },
                h("span", null, title),
                h("span", { className: "ca-len" }, title.length + config.site.titleSuffix.length + "ch"),
                button(
                  {
                    kind: "small",
                    onClick: function () {
                      if (F.set(FIELDS.title, title)) self.setState({ note: "Title applied." });
                      else {
                        self.copyWithNote(title, "Title copied — the field could not be written to.", "The title field could not be written to, and the clipboard is unavailable.");
                      }
                    },
                  },
                  "Use",
                ),
              );
            }),
          ),
          h("div", { key: "k", className: "ca-label", style: { marginTop: 10 } }, "Keyphrases"),
          h(
            "div",
            { key: "kl", className: "ca-chips" },
            ideas.keyphrases.map(function (phrase, index) {
              return chip(
                phrase,
                A.normalize(phrase) === A.normalize(self.props.value),
                function () {
                  self.props.onChange(phrase);
                },
                false,
                index,
              );
            }),
          ),
          h("div", { key: "q", className: "ca-label", style: { marginTop: 10 } }, "Questions readers ask"),
          h(
            "ul",
            { key: "ql", className: "ca-options" },
            ideas.questions.map(function (question, index) {
              return h("li", { key: index }, h("span", null, question));
            }),
          ),
          h(
            "div",
            { key: "qb", className: "ca-row", style: { marginTop: 8 } },
            button(
              {
                kind: "small",
                icon: "quiz",
                disabled: busy || !post.body.trim(),
                title: post.body.trim() ? "Append a FAQ section answering these" : "Write the post first",
                onClick: function () {
                  self.improve(
                    post,
                    "Append a “## Frequently asked questions” section answering these questions, each as a ### heading with a two-or-three-sentence answer:\n" +
                      ideas.questions
                        .map(function (question) {
                          return "- " + question;
                        })
                        .join("\n"),
                    "Writing the FAQ",
                  );
                },
              },
              "Answer these in a FAQ",
            ),
            h("span", { className: "ca-muted" }, "Or fold them into the brief above."),
          ),
        ],
        button(
          {
            kind: "small",
            onClick: function () {
              self.setState({ ideas: null });
            },
          },
          "Dismiss",
        ),
      );
    },

    renderOutline: function (post) {
      var self = this;
      var outline = this.state.outline;
      if (!outline) return null;
      var busy = !!this.state.job;

      var metaRow = function (label, key, current, text) {
        if (!text) return null;
        var same = key === "tags" ? false : A.normalize(current) === A.normalize(text);
        return h(
          "div",
          { key: key, className: "ca-suggestion" },
          h(
            "div",
            { className: "ca-row" },
            h("strong", null, label),
            key === "tags" ? null : h("span", { className: "ca-muted" }, text.length + " chars"),
            h("span", { className: "ca-spacer", style: { marginLeft: "auto" } }),
            same
              ? h("span", { className: "ca-muted" }, "in place")
              : button(
                  {
                    kind: "small",
                    onClick: function () {
                      self.applyOutlineField(key, post);
                    },
                  },
                  current && key !== "tags" ? "Replace" : "Apply",
                ),
          ),
          h("div", { className: "ca-suggestion-text" }, text),
        );
      };

      return card(
        "Plan",
        [
          metaRow("Title", "title", post.title, outline.title),
          metaRow("Focus keyphrase", "keyphrase", this.props.value || "", outline.keyphrase),
          metaRow("Description", "description", post.description, outline.description),
          metaRow("Tags", "tags", post.tags.join(", "), outline.tags.join(", ")),
          h("div", { key: "sl", className: "ca-label", style: { marginTop: 12 } }, "Sections"),
          h(
            "ol",
            { key: "sections", className: "ca-outline" },
            outline.sections.map(function (section, index) {
              return h(
                "li",
                { key: index },
                h("input", {
                  type: "text",
                  value: section.heading,
                  placeholder: "Heading",
                  "aria-label": "Section " + (index + 1) + " heading",
                  onChange: function (event) {
                    self.editSection(index, event.target.value);
                  },
                }),
                h(
                  "button",
                  {
                    type: "button",
                    className: "ca-icon-btn",
                    title: "Remove this section",
                    "aria-label": "Remove section " + (index + 1),
                    onClick: function () {
                      self.removeSection(index);
                    },
                  },
                  icon("close"),
                ),
                section.note ? h("div", { className: "ca-outline-note" }, section.note) : null,
              );
            }),
          ),
          h(
            "div",
            { key: "actions", className: "ca-row", style: { marginTop: 10 } },
            button(
              {
                kind: "primary",
                icon: "auto_awesome",
                disabled: busy || !outline.sections.length,
                onClick: function () {
                  self.writeNow(post);
                },
              },
              this.state.draftDone ? "Write again" : "Write from this outline",
            ),
            button(
              {
                kind: "small",
                icon: "add",
                onClick: function () {
                  self.addSection();
                },
              },
              "Section",
            ),
            button(
              {
                kind: "small",
                disabled: busy,
                onClick: function () {
                  self.outlineOnly(post);
                },
              },
              "Redo",
            ),
          ),
        ],
        button(
          {
            kind: "small",
            onClick: function () {
              self.setState({ outline: null, draft: "", draftDone: false });
            },
          },
          "Dismiss",
        ),
      );
    },

    renderDraft: function (post) {
      var self = this;
      var draft = this.state.draft;
      var done = this.state.draftDone;
      if (!draft && !(this.state.job && /writing/i.test(this.state.job.label))) return null;

      var streaming = !done && !!this.state.job;
      var count = wordCount(draft);
      var target = AI.wordTarget(this.state.length);
      var replacing = !!post.body.trim();

      return card(
        done ? "Draft" : "Writing",
        [
          h(
            "div",
            {
              key: "text",
              className: "ca-draft" + (streaming ? " streaming" : ""),
              ref: function (node) {
                // Follow the text as it arrives; stop once it is all here.
                if (node && streaming) node.scrollTop = node.scrollHeight;
              },
            },
            draft || " ",
          ),
          h(
            "div",
            { key: "stats", className: "ca-stats" },
            h("span", null, count + " words" + (done ? " of ~" + target : "")),
            h("span", null, headingCount(draft) + " headings"),
            done && (this.props.value || "").trim()
              ? h("span", null, A.countPhrase(A.stripMarkdown(draft), A.normalize(this.props.value)) + "× keyphrase")
              : null,
          ),
          done
            ? h(
                "div",
                { key: "actions", className: "ca-row", style: { marginTop: 10 } },
                this.state.draftInserted
                  ? button({ kind: "primary", icon: "check", disabled: true }, "Inserted")
                  : button(
                      {
                        kind: this.state.confirmReplace ? "primary danger" : "primary",
                        icon: this.state.confirmReplace ? "warning" : "publish",
                        onClick: function () {
                          self.insertDraft(post);
                        },
                      },
                      this.state.confirmReplace ? "Replace the body? Click again" : replacing ? "Replace body" : "Insert into post",
                    ),
                button(
                  {
                    kind: "small",
                    icon: "content_copy",
                    onClick: function () {
                      self.copyWithNote(draft, "Draft copied.", "The clipboard is unavailable.");
                    },
                  },
                  "Copy",
                ),
                button(
                  {
                    kind: "small",
                    onClick: function () {
                      self.setState({ draft: "", draftDone: false, draftInserted: false, confirmReplace: false });
                    },
                  },
                  "Discard",
                ),
              )
            : null,
          done
            ? h(
                "p",
                { key: "hint", className: "ca-hint" },
                this.state.draftInserted
                  ? "It is in the post now. Read it through, then check the Optimise tab before you save."
                  : "Inserting also fills the title, description, keyphrase and tags if they are empty. Then check the Optimise tab.",
              )
            : null,
        ],
        null,
        "ca-draft-card",
      );
    },

    renderImprove: function (post) {
      var self = this;
      var busy = !!this.state.job;
      var hasBody = !!post.body.trim();

      return h(
        "div",
        { className: "ca-section" },
        h("div", { className: "ca-label" }, "Improve what's written"),
        h(
          "div",
          { className: "ca-chips" },
          QUICK_ACTIONS.map(function (action) {
            return h(
              "button",
              {
                key: action.label,
                type: "button",
                className: "ca-chip",
                disabled: busy || !hasBody,
                title: hasBody ? action.instruction : "Nothing in the body yet",
                onClick: function () {
                  self.improve(post, action.instruction, action.label);
                },
              },
              action.label,
            );
          }),
        ),
        h(
          "div",
          { className: "ca-row", style: { marginTop: 8, flexWrap: "nowrap", alignItems: "stretch" } },
          h("textarea", {
            rows: 2,
            value: this.state.instruction,
            placeholder: hasBody ? config.placeholders.instruction : "Write something first, then ask for changes here",
            disabled: !hasBody,
            "aria-label": "Instruction for the editor",
            onChange: function (event) {
              self.setState({ instruction: event.target.value });
            },
            onKeyDown: function (event) {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                self.improve(post, self.state.instruction, "Editing");
              }
            },
          }),
          button(
            {
              kind: "primary",
              icon: "send",
              disabled: busy || !hasBody || !this.state.instruction.trim(),
              title: "Send (⌘↩)",
              "aria-label": "Send instruction",
              style: { alignSelf: "flex-end" },
              onClick: function () {
                self.improve(post, self.state.instruction, "Editing");
              },
            },
            null,
          ),
        ),
      );
    },

    /** Proposed edits to the body, each with an Apply button. */
    renderEdits: function (label, list, onDismiss) {
      var self = this;
      if (!list) return null;

      var rows = list.map(function (edit, index) {
        var key = editKey(edit);
        var append = !edit.where || !edit.where.trim();
        return h(
          "div",
          { key: index, className: "ca-edit" },
          append
            ? h("div", { className: "ca-muted" }, "Add at the end")
            : h("div", { className: "ca-where" }, edit.where.slice(0, 200) + (edit.where.length > 200 ? "…" : "")),
          h("div", { className: "ca-fix" + (append ? " append" : "") }, edit.fix),
          h(
            "div",
            { className: "ca-row", style: { marginTop: 4 } },
            h("span", { className: "ca-muted" }, edit.why),
            h("span", { style: { marginLeft: "auto" } }),
            button(
              {
                kind: "small",
                disabled: !!self.state.applied[key],
                onClick: function () {
                  self.applyEdit(edit);
                },
              },
              self.state.applied[key] ? "Applied" : "Apply",
            ),
          ),
        );
      });

      return card(
        label,
        list.length ? rows : h("p", { className: "ca-muted", style: { margin: 0 } }, "The model had nothing to change."),
        h(
          "span",
          { className: "ca-row" },
          list.length > 1
            ? button(
                {
                  kind: "small",
                  onClick: function () {
                    self.applyAll(list);
                  },
                },
                "Apply all",
              )
            : null,
          button({ kind: "small", onClick: onDismiss }, "Dismiss"),
        ),
      );
    },

    renderWrite: function (post) {
      var self = this;
      if (!AI.hasKey()) return this.renderNoKey();
      return h(
        "div",
        null,
        this.renderBrief(post),
        this.renderStatus(),
        this.renderMessages(),
        this.renderDraft(post),
        this.renderOutline(post),
        this.renderIdeas(post),
        this.renderImprove(post),
        this.state.edits
          ? this.renderEdits(this.state.edits.label, this.state.edits.list, function () {
              self.setState({ edits: null });
            })
          : null,
      );
    },

    // -------------------------------------------------------- optimise

    /** The select box and Fix button that sit on a failing row. */
    rowControls: function (post, result) {
      var self = this;
      if (result.status === GOOD) return null;
      var running = !!this.state.job;
      var busy = running && this.state.fixing.indexOf(result.text) !== -1;
      var key = AI.hasKey();

      return h(
        "span",
        { className: "ca-controls" },
        h("input", {
          type: "checkbox",
          checked: !!this.state.selected[result.text],
          title: "Select this check for the toolbar's Fix button",
          "aria-label": "Select this check",
          onChange: function () {
            self.toggle(result.text);
          },
        }),
        button(
          {
            kind: "small",
            disabled: running || !key,
            title: key ? "Fix just this one" : "No model key in this build",
            onClick: function () {
              self.runFix(post, [result]);
            },
          },
          busy ? "…" : "Fix",
        ),
      );
    },

    checkList: function (post, results) {
      var self = this;
      return h(
        "ul",
        { className: "ca-checks" },
        results.map(function (result, index) {
          return h("li", { key: index }, bullet(result.status), h("span", null, result.text), self.rowControls(post, result));
        }),
      );
    },

    group: function (label, post, results, open) {
      var value = A.score(results);
      var status = A.scoreStatus(value);
      return h(
        "details",
        { className: "ca-group", open: open },
        h(
          "summary",
          null,
          bullet(status),
          h("span", null, label),
          h("span", { className: "ca-total ca-" + status }, value + " / 100"),
        ),
        this.checkList(post, results),
      );
    },

    /** The result as Google would draw it, from the title suffix and URL pattern in the config. */
    snippet: function (post) {
      var limit = config.titleLimit;
      var title = post.renderedTitle || "Untitled post" + config.site.titleSuffix;
      var description = post.description || "No meta description yet.";
      return h(
        "div",
        { className: "ca-snippet" },
        h("div", { className: "ca-url" }, config.breadcrumb(post.slug)),
        h("div", { className: "ca-title" }, title.length > limit ? title.slice(0, limit).trim() + "…" : title),
        h("div", { className: "ca-desc" }, description.length > 156 ? description.slice(0, 156).trim() + "…" : description),
      );
    },

    /** One metadata suggestion: what it is, what it says, how to take it. */
    suggestion: function (label, text, apply) {
      var self = this;
      return h(
        "div",
        { key: label, className: "ca-suggestion" },
        h(
          "div",
          { className: "ca-row" },
          h("strong", null, label),
          h("span", { className: "ca-muted" }, text.length + " chars"),
          h("span", { style: { marginLeft: "auto" } }),
          button(
            {
              kind: "small",
              onClick: function () {
                if (apply()) self.setState({ note: label + " applied." });
                else {
                  // The field could not be found, which means Sveltia's markup
                  // moved. Losing the text would be worse than a manual paste.
                  self.copyWithNote(text, label + " copied — the field could not be written to.", label + " could not be written to, and the clipboard is unavailable.");
                }
              },
            },
            "Apply",
          ),
        ),
        h("div", { className: "ca-suggestion-text" }, text),
      );
    },

    fixPanel: function (post) {
      var self = this;
      var props = this.props;
      var meta = this.state.meta;
      var edits = this.state.fixEdits;
      if (!meta && !edits) return null;

      // The model returns every metadata field whether or not it changed it,
      // so only what actually differs is worth showing.
      var changed = [];
      if (meta) {
        if (meta.title && meta.title.trim() !== post.title.trim()) {
          changed.push(
            this.suggestion("Title", meta.title, function () {
              return F.set(FIELDS.title, meta.title);
            }),
          );
        }
        if (meta.description && meta.description.trim() !== post.description.trim()) {
          changed.push(
            this.suggestion("Description", meta.description, function () {
              return F.set(FIELDS.description, meta.description);
            }),
          );
        }
        if (meta.keyphrase && A.normalize(meta.keyphrase) !== A.normalize(props.value)) {
          changed.push(
            this.suggestion("Focus keyphrase", meta.keyphrase, function () {
              // This one is our own field, so it needs no DOM at all.
              props.onChange(meta.keyphrase);
              return true;
            }),
          );
        }
      }

      var dismiss = function () {
        self.setState({ meta: null, fixEdits: null });
      };

      return h(
        "div",
        null,
        meta
          ? card(
              "Metadata",
              changed.length ? changed : h("p", { className: "ca-muted", style: { margin: 0 } }, "The model left the title, description and keyphrase alone."),
              edits ? null : button({ kind: "small", onClick: dismiss }, "Dismiss"),
            )
          : null,
        edits ? this.renderEdits("Body edits", edits, dismiss) : null,
      );
    },

    toolbar: function (post, failing) {
      var self = this;
      var job = this.state.job;
      var key = AI.hasKey();
      var ticked = failing.filter(function (result) {
        return self.state.selected[result.text];
      }).length;
      var ready = !job && key && failing.length;

      return h(
        "div",
        { className: "ca-toolbar" },
        h(
          "div",
          { className: "ca-row" },
          button(
            {
              kind: "primary",
              icon: "auto_fix_high",
              disabled: !ready,
              title: key ? "Send the selected checks to " + AI.model() : "No model key in this build — see the README",
              onClick: function () {
                self.runFix(post, self.targets(failing));
              },
            },
            ticked ? "Fix " + ticked + " selected" : failing.length ? "Fix all " + failing.length : "Nothing to fix",
          ),
          !job && failing.length
            ? button(
                {
                  kind: "small",
                  onClick: function () {
                    if (ticked === failing.length) self.setState({ selected: {} });
                    else self.selectAll(failing);
                  },
                },
                ticked === failing.length ? "Select none" : "Select all",
              )
            : null,
        ),
        h(
          "span",
          { className: "ca-muted" },
          !key
            ? "Fixes need a model key; the analysis does not."
            : ticked
              ? ticked + " of " + failing.length + " selected"
              : failing.length
                ? "Tick checks to fix a few, or fix them all. Fixes are shown before they are applied."
                : "Everything is green.",
        ),
      );
    },

    renderOptimise: function (post, seo, readability) {
      var failing = seo.concat(readability).filter(function (result) {
        return result.status !== GOOD;
      });
      return h(
        "div",
        null,
        this.toolbar(post, failing),
        this.renderStatus(),
        this.renderMessages(),
        this.fixPanel(post),
        this.snippet(post),
        this.group("SEO", post, seo, true),
        this.group("Readability", post, readability, false),
      );
    },

    render: function () {
      var self = this;
      var props = this.props;
      var value = props.value || "";
      var post = A.readPost(props.entry, value);
      var seo = A.analyseSeo(post);
      var readability = A.analyseReadability(post);
      var total = A.score(seo.concat(readability));
      var view = this.state.view;

      return h(
        "div",
        {
          className: props.classNameWrapper,
          style: { display: "block" },
          ref: function (node) {
            if (node) self.root = node;
          },
        },
        h(
          "div",
          { className: "ca-tabs", role: "tablist" },
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": String(view === "write"),
              onClick: function () {
                self.setView("write");
              },
            },
            icon("edit_note"),
            "Write",
          ),
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": String(view === "optimise"),
              onClick: function () {
                self.setView("optimise");
              },
            },
            icon("search"),
            "Optimise",
            h("span", { className: "ca-score", style: { background: COLORS[A.scoreStatus(total)] } }, total),
          ),
        ),
        h("label", { htmlFor: props.forID, className: "ca-label" }, "Focus keyphrase"),
        h("input", {
          id: props.forID,
          type: "text",
          value: value,
          placeholder: config.placeholders.keyphrase,
          spellCheck: false,
          onChange: function (event) {
            props.onChange(event.target.value);
          },
        }),
        h(
          "p",
          { className: "ca-hint", style: { marginBottom: 14 } },
          view === "write"
            ? "The phrase this post should rank for. The writer builds around it; leave it blank and the plan proposes one."
            : "Everything below updates as you write. It is advice, not a gate — nothing here blocks publishing.",
        ),
        view === "write" ? this.renderWrite(post) : this.renderOptimise(post, seo, readability),
      );
    },
  });

  /** The model's answer to a list field, kept only if it is strings. */
  function strings(value) {
    return Array.isArray(value)
      ? value.filter(function (item) {
          return typeof item === "string" && item.trim();
        })
      : [];
  }

  /** Body edits as { where, fix, why } strings, dropping any with no fix. */
  function cleanEdits(value) {
    return (Array.isArray(value) ? value : [])
      .filter(function (edit) {
        return edit && typeof edit.fix === "string" && edit.fix.trim();
      })
      .map(function (edit) {
        return { where: typeof edit.where === "string" ? edit.where : "", fix: edit.fix, why: typeof edit.why === "string" ? edit.why : "" };
      });
  }

  function editKey(edit) {
    return (edit.where || "") + "\u0000" + (edit.fix || "");
  }

  function Preview(props) {
    return h("div", null, props.value || "—");
  }

  // index.html holds the CMS back with CMS_MANUAL_INIT so the widget exists
  // before config.yml is read. That makes this file responsible for starting
  // the editor: if registration ever throws, boot anyway and lose the panel
  // rather than leaving the admin on a blank page.
  try {
    window.CMS.registerWidget("seo", Control, Preview);
  } catch (error) {
    console.error("Assistant panel failed to register", error);
  } finally {
    window.__seoWidgetLoaded = true;
    window.CMS.init();
  }
})();
