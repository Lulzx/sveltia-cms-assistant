# sveltia-cms-assistant

This is a [Sveltia CMS](https://github.com/sveltia/sveltia-cms) admin with a writing assistant built into the entry editor. It works with any site that stores Markdown posts in a Git repo.

The assistant is one custom widget, `seo`. You put it on a "Focus keyphrase" field and it becomes a sidebar panel with two views:

- **Write** plans a post from a brief and writes it. It can also suggest titles, keyphrases and reader questions. It edits the existing body from quick actions (Continue, Add FAQ, Tighten, and so on) or a free-text instruction. Every change is shown first, and nothing touches the post until you apply it.
- **Optimise** scores the post while you type, like Yoast. It shows a Google snippet preview, an SEO score and a readability score. Every failing check has a **Fix** button, and fixes are suggested before they're applied.

The analysis runs in the browser and needs no network. Writing and fixes call a model on [OpenRouter](https://openrouter.ai). The default, `openrouter/free`, costs nothing.

There's no bundler and no framework build. The build copies the files, fills in a template and writes two generated files.

## Setup

1. **Add the kit to your project.** Copy this directory into your repo, for example as `cms/`, or keep it as its own repo.

   ```sh
   npm install
   cp assistant.config.example.mjs assistant.config.mjs
   cp cms.config.example.yml cms.config.yml
   ```

   Both copies are in `.gitignore` here, so your site's settings stay out of this repo. If you vendor the kit into your own repo, remove those two lines so the configs get committed.

2. **Describe your site** in `assistant.config.mjs`:
   - site name and URL
   - post URL pattern
   - voice
   - allowed links
   - an optional call to action
   - formats and placeholders

   Only `site.name`, `site.url` and `posts.urlPattern` are required. The defaults are in `admin/config.js`.

3. **Configure the CMS** in `cms.config.yml`. This is a normal Sveltia/Decap config: set the repo, folders and fields. Keep one field with `widget: seo`. If your fields have other names than `title`, `description`, `body`, `cover`, `coverAlt` and `tags`, map them under `fields` in `assistant.config.mjs`.

4. **Publish a posts index** (optional, recommended) so the writer can link to real posts. See [`examples/posts-index`](examples/posts-index).

5. **Try it locally.**

   ```sh
   npm run dev          # build, then serve on http://localhost:8080
   ```

   With no token, use Sveltia's **Work with Local Repository** (Chromium browsers) to edit a checkout on disk, or sign in with a GitHub token. To try the Write view, pass a key:

   ```sh
   OPENROUTER_API_KEY=sk-or-... npm run dev
   ```

6. **Deploy** `dist/` anywhere that serves static files. Read the security section below first.

## Build

```sh
node scripts/build.mjs [--config assistant.config.mjs] [--cms cms.config.yml] [--out dist]
```

| Environment variable | Effect |
|---|---|
| `CMS_GITHUB_TOKEN` | Baked into `auth.js`, so the editor opens already signed in. Use a fine-grained token with Contents read/write on the one repo. |
| `OPENROUTER_API_KEY` | Baked into `settings.js`. Turns on Write and Fix. Without it, only the analysis runs. |
| `OPENROUTER_MODEL` | Overrides `model` from the config, for example `anthropic/claude-sonnet-5`. |

Output:

```
dist/
  index.html        page with CSP filled in for your site's origins
  config.yml        your cms.config.yml
  sveltia-cms.js    pinned by package.json
  auth.js           generated: token sign-in, or inert
  settings.js       generated: site settings (+ key, model)
  config.js analysis.js ai.js panel.js panel.css
```

## Security

**If you set `CMS_GITHUB_TOKEN` or `OPENROUTER_API_KEY`, `dist/` contains secrets.** Anyone who can load the page can read them and push to your repo. Serve it only behind authentication, for example:

- Caddy or nginx basic auth (see [`examples/deploy/Caddyfile`](examples/deploy/Caddyfile))
- Cloudflare Access
- a VPN

[`examples/deploy/github-actions.yml`](examples/deploy/github-actions.yml) builds, ships and then checks that the URL still answers 401.

To publish the admin without baking in a token, build without `CMS_GITHUB_TOKEN`. Then deploy [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) and set `backend.base_url` in `cms.config.yml`, and editors sign in with GitHub. Add that origin under `csp.connect`. The OpenRouter key is still in the bundle if you set one. Either keep auth in front, or use a key with a low credit limit.

## Files

| File | Role |
|---|---|
| `admin/config.js` | Defaults. Merges `settings.js` over them and derives the title budget, internal hosts and snippet breadcrumb. |
| `admin/analysis.js` | The checks, as pure functions. No DOM, no network. |
| `admin/ai.js` | Prompts, OpenRouter streaming with retries, parsing replies, and writing into Sveltia's fields. |
| `admin/panel.js` | The React widget (`window.h`, `createClass`), sidebar tab placement, and starting the CMS. |
| `admin/panel.css` | Styles built on Sveltia's CSS variables, so light and dark themes follow. |
| `admin/index.html` | Page template; load order and CSP. |
| `scripts/build.mjs` | Validates the config and assembles `dist/`. |
| `scripts/serve.mjs` | Local static server, bound to 127.0.0.1. |

## How it works

**Registration.** `index.html` sets `CMS_MANUAL_INIT` so Sveltia waits. `panel.js` registers the `seo` widget and then calls `CMS.init()`. If registration throws, the CMS still boots, without the panel.

**Placement.** Sveltia gives you no way to add a tab to the editor sidebar. The panel copies one of Sveltia's own tab buttons, so it looks and behaves like the others, and builds a matching panel next to it. Then it moves React's root container, not the rendered node, into that panel, because React 18 listens for events on the container. Opening our tab closes Sveltia's, and the reverse. If the sidebar isn't found, the panel stays inline in the form.

**Reading the post.** A custom widget gets the whole entry and re-renders on every change. That's why the scores update as you type.

**Writing into other fields.** A widget can only set its own value. For other fields, the assistant finds the input by Sveltia's `data-key-path`, sets its value with the browser's native setter, and fires `input`, just as typing would. For the body, it writes to the Markdown source textarea behind the rich-text editor, so both views update.

**Checks.** Thresholds follow Yoast's published values:

- title up to 60 characters, including your suffix
- description 120–156 characters
- keyphrase density 0.5–3%
- at least 300 words
- at most 25% of sentences over 25 words
- at most 10% passive voice
- transition words in 30% of sentences
- a subheading at least every 300 words
- Flesch reading ease

A green check scores 2 points and an orange one scores 1. None of it blocks a save. The passive-voice, transition-word and syllable checks are **English-only**.

**Fixes.** Each check is tagged as metadata (title, description, keyphrase, slug) or body. A fix run sends the two groups as parallel requests, so the fast metadata answer doesn't wait for body edits. Body edits come back as `{ where, fix, why }`. `where` quotes the passage to replace, and matching ignores differences in whitespace. An empty `where` means the text is added at the end.

**The free model router.** `openrouter/free` picks a different model on each request, so the code is defensive:

- JSON is requested both with a `response_format` schema and in the prompt, then extracted from whatever comes back.
- Markdown is stripped of added fences, title lines and front matter.
- Rate-limit errors and empty replies are retried after 4 and then 8 seconds.
- Every job streams and has a Cancel button and a 150-second timeout.

## Customising

- **Voice, links, formats, lengths, quick actions and placeholders** are all set in `assistant.config.mjs`.
- **Prompts** are in `TASKS` in `admin/ai.js`. The SEO rules the writer follows (`SEO_RULES`) match the checks, so a new draft starts mostly green. If you change one, change the other.
- **Thresholds and messages** are in `analyseSeo` and `analyseReadability` in `admin/analysis.js`.
- **Another widget name:** rename it in the `registerWidget` call at the end of `panel.js`, in `cms.config.yml`, and in the check in `scripts/build.mjs`.

## Tests

```sh
npm test
```

The tests load the browser scripts into a Node VM, the same way the page loads them, and cover config merging, field mapping, link classification, the checks, scoring, and reply parsing.

## Compatibility

Built against `@sveltia/cms` 0.197. Sidebar placement and field writing depend on Sveltia's markup: `aria-controls="entry-sidebar-content"`, `data-key-path`, and the list widget's Add button. If a Sveltia upgrade changes that markup, the panel falls back to showing inline, and **Apply** copies text to the clipboard instead. Check both after upgrading.

## License

[MIT](LICENSE). Sveltia CMS is MIT-licensed as well.
