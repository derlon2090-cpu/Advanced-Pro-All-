# Crunchyroll Code Hub

## Supabase Auth for the admin area

The admin form calls a server-side login endpoint. It exchanges the email and password with Supabase Auth, stores only the returned access token in a `HttpOnly`, `Secure`, `SameSite=Strict` cookie, and checks the user again before restoring the admin session.

Configure these runtime secrets in Site settings; never put them in source code:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `ADMIN_EMAILS` — comma-separated approved admin email addresses.

The service-role key is not used for sign-in and must never be exposed to the browser.

## Worker starter notes

Use this starter for a static microsite, click counter, or simple internal UI whose state is browser-scoped. It has no dependencies and needs no install.

Edit `worker/index.js`, then publish through the Sites hosting workflow with this starter's build and validation in `commands`.

The build copies only `worker/index.js` and `.openai/hosting.json`. Do not add standalone asset files. Embed any essential raster bytes in `worker/index.js` and serve or reference them as a data URL.

Pass these argument arrays as `commands`:

```json
[
  ["bash", "scripts/build.sh"],
  ["node", "scripts/validate-artifact.mjs"]
]
```

The deterministic build produces:

```text
dist/
├── .openai/
│   └── hosting.json
└── server/
    └── index.js
```

`dist/server/index.js` is an ES module with a default export containing `fetch(request, env, ctx)`. Edit `worker/index.js`, not the generated file under `dist/`.
