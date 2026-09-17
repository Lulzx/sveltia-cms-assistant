# The published-posts index

The assistant only links to pages it knows exist. It fetches one JSON file,
set by `posts.indexUrl`, once per editor session:

```json
[
  {
    "title": "How high should a standing desk be?",
    "url": "https://example.com/blog/standing-desk-height/",
    "description": "optional",
    "tags": ["desks"]
  }
]
```

Only `title` and `url` are required. Tags are used to suggest tags the site
already uses. Leave drafts out.

- `astro-posts.json.ts` is an Astro endpoint.
- `generate-posts-json.mjs` works with any static site generator. Run it in your build.

## CORS

The admin is served from a different origin than the site, so the JSON
response needs `Access-Control-Allow-Origin`. The list is public, so `*` is
fine. Set it where the file is served:

**Caddy**
```
@postsIndex path /blog/posts.json
header @postsIndex Access-Control-Allow-Origin "*"
```

**Netlify / Cloudflare Pages** (`_headers` in the published directory)
```
/blog/posts.json
  Access-Control-Allow-Origin: *
```

**Vercel** (`vercel.json`)
```json
{ "headers": [{ "source": "/blog/posts.json", "headers": [{ "key": "Access-Control-Allow-Origin", "value": "*" }] }] }
```

**nginx**
```
location = /blog/posts.json { add_header Access-Control-Allow-Origin *; }
```

If the fetch fails, the panel still works. It just offers no internal links.
