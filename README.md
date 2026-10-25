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

## Hosting

Any static host works. **Cloudflare Pages** or **Netlify** are recommended because they apply `_headers`, which adds clickjacking protection and HSTS.
GitHub Pages works too (Settings → Pages → deploy from `main`, root folder), but it ignores `_headers`. The CSP still applies through the meta tag.

Supabase can't host the page: Edge Functions and Storage don't serve `text/html`.

## Security notes

- Invite codes are 10 characters (~50 bits). Anyone in the household can rotate the code from the Household sheet.
- Supabase can't filter DELETE realtime events, so every signed-in listener receives the random ID of deleted items. IDs only, never content.
- Limits: 20 households created per user, 500 items per list.
