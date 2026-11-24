# Crunchyroll Code Hub

## Supabase Auth for the admin area

The admin form calls a server-side login endpoint. It exchanges the email and password with Supabase Auth, stores only the returned access token in a `HttpOnly`, `Secure`, `SameSite=Strict` cookie, and checks the user again before restoring the admin session.

Configure these runtime secrets in Site settings; never put them in source code:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `ADMIN_EMAILS` — comma-separated approved admin email addresses.

The service-role key is not used for sign-in and must never be exposed to the browser.

## Email security and device-transfer review

Migration `003_device_transfer_security.sql` adds server-only metadata for a
single-device continuity signal and a one-time, admin-reviewed transfer
request. It intentionally excludes screenshots, raw email bodies, passwords,
OTP values, approval links, third-party session tokens, and remote device
controls.

The inbound-email webhook classifies password or email-change notices as
`critical_blocked`. Webhook responses never expose message bodies or codes to
customers. Use the provider's official account settings for any sign-out,
password change, or device management action.

## Operations

Migration `004_operational_capacity.sql` adds a server-only slot limit per
service account and an `access_reviewed_at` timestamp. Calculate occupied
seats from active `account_assignments`; do not infer account sharing from
email contents. The client renewal action uses a WhatsApp compose link with an
order number only—configure the support destination in your storefront before
using it in production.

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
