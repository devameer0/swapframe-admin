# SwapFrame Admin

The owner's admin dashboard for [SwapFrame](https://github.com/devameer0/swapframe). It's a separate static app that connects to the **same Supabase project** as the main site.

**Live:** https://devameer0.github.io/swapframe-admin/

## Features
- **Stats:** total users, banned users, total jobs, jobs today, succeeded, failed, in progress.
- **Users:** search, then edit email display, name, role (user/admin), credits, banned. Delete all of a user's jobs and files, or delete the user completely.
- **Jobs:** view any job (status, error, signed links to the input video, character image and output) and delete it along with its files. Filter by user.
- **Site settings:** site name, logo URL, theme (dark/light), primary and accent colors, font, background, max upload size and min/max length, free daily swaps per user, sign-ups open/closed, maintenance mode, announcement banner.
- **Content:** landing page tagline, hero text, button text, sections, footer text and links.

Changes save to the shared `site_settings` table and show on the main site live (Realtime), or on its next page load. No redeploy needed.

## Access
Only accounts with `profiles.role = 'admin'` get in. Anyone else is signed out and sees "Access denied". Make the first admin after signing up on the main site:
```sql
update public.profiles set role = 'admin' where email = 'iahmadabubakar0@gmail.com';
```

## Setup
Everything backend-related lives in the main repo. Follow its README first:
- SQL: [`supabase/migrations/`](https://github.com/devameer0/swapframe/tree/main/supabase/migrations) (`0001_init.sql`, `0002_admin.sql`, `0003_site_settings.sql`)
- Edge functions: [`supabase/functions/admin`](https://github.com/devameer0/swapframe/tree/main/supabase/functions/admin) (admin-verified, uses the service role server-side) and `swap`
  ```bash
  supabase functions deploy admin
  ```

Then put the **same** Supabase Project URL and anon key into `public/config.js` and run:
```bash
npm install
npm run deploy   # builds and publishes to the gh-pages branch
```

## Security
- Admin reads and writes go through RLS policies that check `is_admin()` (role = 'admin').
- Service-role actions (deleting auth users and storage files) run only inside the `admin` edge function, after it checks the caller is an admin. The service role key is never in this app.
- This site has `noindex`, but its real protection is the server-side checks, not its URL being hard to find.
