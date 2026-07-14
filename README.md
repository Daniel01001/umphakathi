# Umphakathi – Community Hub

A social media app for your community — like your Facebook group, but your own.
Share news, chat with neighbours, and support local businesses.

**Total running cost: R0 per month.** (Optional: your own web address like
`umphakathi.co.za` costs about R99/year.)

## What's inside

| Feature | Description |
|---|---|
| 🏠 Home feed | Posts with photos, likes and comments, filtered by category (News, Talk, For Sale, Events, Alerts) |
| 💬 Community chat | One shared room for everyone, updates live |
| 🏪 Business directory | Members list their businesses with Call and WhatsApp buttons |
| 👤 Profiles | Simple accounts with name and area |

It works on any phone with a browser — nothing to install from an app store.

## Try it right now (Demo mode)

Just open `index.html` in a browser. The app starts in **Demo mode**: it's fully
working with sample posts, but everything is saved on that device only.
Perfect for showing the community what they're getting.

## Going live (free, ~30 minutes)

To make it a real shared app, you need two free things: a **database** (Supabase)
and a **place to host the site** (Netlify or GitHub Pages).

### Step 1 – Free database (Supabase)

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Create a new project (any name, e.g. "umphakathi"). Choose a strong database
   password and save it somewhere safe.
3. In the dashboard, open **SQL Editor → New query**, paste the whole contents of
   [`setup/schema.sql`](setup/schema.sql), and click **Run**.
4. Go to **Storage → New bucket**, name it `photos`, and tick **Public bucket**.
5. Go to **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public key** (a long string starting with `eyJ...`)
6. Open [`js/config.js`](js/config.js) and paste them into `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`.

The free tier includes a 500 MB database, 1 GB of photo storage, and 50,000
monthly active users — far more than a community group needs.

### Step 2 – Free hosting (Netlify)

1. Go to [netlify.com](https://netlify.com) and create a free account.
2. Drag this whole folder onto the "deploy" area — that's it.
3. You get a free address like `umphakathi.netlify.app`. Share that link in the
   Facebook group and on WhatsApp.

(GitHub Pages works just as well if you prefer.)

### Step 3 – Optional extras

- **Own domain (~R99/year):** buy e.g. `umphakathi.co.za` from a registrar like
  domains.co.za and connect it in Netlify's domain settings.
- **"Install" on phones:** members can use their browser's *Add to Home Screen*
  so the app opens like a normal app with its own icon.

## Customising

Everything community-specific lives in [`js/config.js`](js/config.js):
the app name, the tagline, the list of areas, and the post categories.
Change them freely — no other file needs editing.

## If the community grows

The free tiers comfortably handle thousands of members. If you ever outgrow
them, Supabase's paid plan is ~US$25/month — but you'll know long in advance,
and by then the community may be big enough for local businesses to sponsor it.
