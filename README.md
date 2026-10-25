# Pantry Run

A shared, real-time grocery list for a household. Google sign-in, Supabase backend, no build step.

## How it works

- Static site: `index.html`, `app.css`, `app.js`, and a vendored copy of `@supabase/supabase-js` 2.45.4 in `vendor/` (no third-party script CDN).
- The browser talks straight to Supabase: REST for reads and writes, a WebSocket for live updates.
- The key in `app.js` is the **publishable** key. It is public by design. All access control lives in Postgres:
  - Row Level Security: you only see households you're a member of, and their items and members.
  - You join a household only through `join_household(code)` (rate-limited, 10 wrong codes per hour).
  - The item author is set by a server trigger, so it can't be spoofed.
- Schema history is in `supabase/migrations/`.

## Setup

1. **Database:** run any migration in `supabase/migrations/` that isn't applied yet in the Supabase SQL editor.
2. **Google OAuth:** in Google Cloud Console → APIs & Services → Credentials, create an OAuth client ID (Web application).
   Authorized redirect URI: `https://hwiwlyikrjwkqzmovump.supabase.co/auth/v1/callback`
3. **Supabase → Authentication → Providers:** enable Google and paste the client ID and secret. Turn off Email and Anonymous sign-ins.
4. **Supabase → Authentication → URL Configuration:** set the Site URL to your exact deployed address, and add the same URL under Redirect URLs. Don't use wildcards.

## Agent access (MCP + REST)

Let an assistant, such as a WhatsApp agent, read and edit the list for you.

1. In the app, open **Household → Agent access**, name the token and tap **Create token**. Copy it right away; it's shown only once.
2. Give your agent:
   - **MCP server URL:** `https://hwiwlyikrjwkqzmovump.supabase.co/functions/v1/pantry-agent/mcp`
     (Streamable HTTP, stateless JSON responses)
   - **Header:** `Authorization: Bearer pr_…`
     If your agent can't set headers, use `X-Api-Key: pr_…` or, as a last resort, append `?key=pr_…` to the URL. That puts the token in logs, so revoke and rotate it if the URL leaks.

MCP tools: `list_groceries`, `add_groceries`, `check_off_groceries`, `remove_groceries`, `clear_cart`.

REST (same base URL, without `/mcp`, same auth header):

| Method | Path | Body |
|---|---|---|
| GET | `/items` | n/a |
| POST | `/items` | `{"items": ["milk", {"name": "eggs", "quantity": "12"}]}` |
| POST | `/check` | `{"items": ["eggs"], "checked": true}` |
| POST | `/remove` | `{"items": ["eggs"]}` |
| POST | `/clear` | n/a, deletes checked-off items |

```bash
curl -X POST https://hwiwlyikrjwkqzmovump.supabase.co/functions/v1/pantry-agent/items \
  -H "Authorization: Bearer pr_…" -H "Content-Type: application/json" \
  -d '{"items":["oat milk",{"name":"eggs","quantity":"12"}]}'
```

How tokens work:
- Each token is tied to one person and one household, and is stored only as a SHA-256 hash.
- A token stops working when it's revoked, or when its owner leaves the household.
- Items added through the agent show as "Name via agent".
- Adding something already on the list doesn't create a duplicate. Adding something already in the cart moves it back to the list.
- The Edge Function (`supabase/functions/pantry-agent`) holds no secrets. It forwards to token-checked Postgres functions (`agent_*`).

## Hosting

Any static host works. **Cloudflare Pages** or **Netlify** are recommended because they apply `_headers`, which adds clickjacking protection and HSTS.
GitHub Pages works too (Settings → Pages → deploy from `main`, root folder), but it ignores `_headers`. The CSP still applies through the meta tag.

Supabase can't host the page: Edge Functions and Storage don't serve `text/html`.

## Security notes

- Invite codes are 10 characters (~50 bits). Anyone in the household can rotate the code from the Household sheet.
- Supabase can't filter DELETE realtime events, so every signed-in listener receives the random ID of deleted items. IDs only, never content.
- Limits: 20 households created per user, 500 items per list.
