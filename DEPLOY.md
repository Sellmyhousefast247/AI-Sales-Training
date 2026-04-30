# Get the app online — step by step

**This is the only doc you need.** Three things have your name on them; everything else is already done.

You'll do these once. They take ~20 minutes total. **Read every step. Don't skip.**

---

## Things only you can do

These need an email + password tied to *you*. I can't sign up for you because:

- Supabase, Anthropic, and Vercel verify email ownership.
- Anthropic and Vercel need a credit card on file (yours, not mine).
- Each one is bound to one account; there's no shared "company" sign-up I can do on your behalf.

Cost summary:

| Service | Cost to start |
| --- | --- |
| Supabase (database) | **Free** |
| Vercel (hosting) | **Free** |
| Anthropic (AI brains) | **$5 minimum top-up.** $20 lasts hundreds of analyses. |

---

## The 6 things to do, in order

### 1) Make a Supabase account (5 minutes)

> **Why this:** Supabase is your database. It stores every deal, every user, every comp. The app cannot start without one.

1. Open a new tab. Go to **`https://supabase.com`**.
2. Click the green **Start your project** button (top right).
3. Sign up with GitHub or email. Pick whatever's easiest.
4. After it loads your dashboard, click **New project** (big green button).
5. Fill in the boxes:
   - **Name**: type `acquisitions-ai`
   - **Database Password**: click "Generate a password", then click the **copy icon** next to it. **Paste it into a Notes/text file and save it.** You'll need it later (maybe).
   - **Region**: pick the one closest to you (e.g. "East US (Ohio)" if you're on the East Coast).
   - **Plan**: Free.
6. Click **Create new project**. Wait ~2 minutes for the box that says "Setting up project…" to turn green.
7. When it's ready, click the **gear icon** ⚙ in the very bottom-left corner (Project Settings).
8. Click **API** in the left sub-menu.
9. **Copy these THREE values** into the same Notes file. Each one is on its own line and there's a "Copy" button next to each:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a very long string starting with `eyJ`
   - **service_role secret** key — also starts with `eyJ`. **Click "Reveal" first.** Keep this one secret.

Leave that browser tab open. You'll need it again in step 2.

### 2) Run the database setup scripts (5 minutes)

> **Why this:** The empty Supabase project is just a blank box. The 11 SQL files in `supabase/migrations/` create all the tables (deals, comps, users, etc). I can't push them for you — your service-role key is the password into your database, and you shouldn't share it with anyone, including me.

1. In Supabase, in the **left sidebar**, click the **lightning bolt icon** ⚡ (SQL Editor).
2. Click **+ New query** (top right).
3. Open the file **`supabase/migrations/0001_initial_schema.sql`** in this repo (in VS Code, GitHub, whatever you use).
4. **Select all** (Ctrl+A on Windows / Cmd+A on Mac), **copy** (Ctrl/Cmd+C).
5. **Click into the Supabase query box**, **paste** (Ctrl/Cmd+V).
6. Click the green **Run** button (bottom right of the query box, or press Ctrl/Cmd+Enter).
7. Wait for **"Success. No rows returned"** at the bottom. If it's red, screenshot and send to me — don't proceed.
8. Click **+ New query** again. **Repeat steps 3–7** for every file in `supabase/migrations/`, **in order by filename**:
   - `0001_initial_schema.sql`
   - `0002_auth_hook.sql`
   - `0003_road_to_a_deal.sql`
   - `0004_comping_engine.sql`
   - `0005_comp_overrides.sql`
   - `0006_comp_photos.sql`
   - `0007_analysis_snapshots.sql`
   - `0008_comp_warm_queue.sql`
   - `0009_condition_source.sql`
   - `0010_analysis_share.sql`
   - `0011_comp_photos_bucket.sql`
9. Done. Database is built.

### 3) Get an Anthropic API key (3 minutes)

> **Why this:** Anthropic is Claude's company. The "Analyze photos" button, the "what's wrong with this house" reader, the photo-based property type detector — all of that calls Claude. Without this key, the app still works, but those features just say "vision skipped".

1. Open a new tab. Go to **`https://console.anthropic.com`**.
2. Sign up. Use whatever email.
3. After signing in, click your profile icon (top right) → **Plans & Billing** → click **Add credit balance** → start with **$20**. Enter a card. (You can spend $5 minimum.)
4. Now click **API Keys** in the left sidebar (or the top nav).
5. Click **Create Key**. Name it `acquisitions-ai`.
6. **Copy the key** that appears (starts with `sk-ant-`). **It's only shown once.** Paste it into your Notes file.

### 4) Push your code to GitHub (2 minutes)

> **Why this:** Vercel deploys *from* a GitHub repo. It needs to read your code. The repo is already wired up — you just need to make sure your latest changes are pushed.

I've been pushing all my changes to the branch `claude/real-estate-comping-foundation-5Xp1Z` already. If you want this branch on `main`, do the next sub-step. Otherwise, in step 5 you'll just point Vercel at the existing branch.

**To merge into main (recommended):**

```
git checkout main
git merge claude/real-estate-comping-foundation-5Xp1Z
git push origin main
```

If you'd rather stay on the branch, skip the merge — Vercel can deploy from any branch.

### 5) Deploy to Vercel (5 minutes)

> **Why this:** Vercel actually runs the website. It takes your GitHub code, builds it, and gives you a public URL like `your-app.vercel.app`.

1. Open a new tab. Go to **`https://vercel.com`**.
2. Click **Sign Up**, choose **Continue with GitHub** (easiest).
3. Authorize Vercel to read your repos.
4. Once on your dashboard, click **Add New…** → **Project** (top right).
5. You'll see a list of your GitHub repos. Find `AI-Sales-Training` and click **Import**.
6. On the **Configure Project** screen, you'll see a section called **Environment Variables**. Click it to expand. Add **each of these one at a time**, by typing the name on the left and pasting the value on the right, then clicking **Add**:

   | Key (left) | Value (right) — paste from your Notes file |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | the Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the Supabase anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | the Supabase service_role key |
   | `ANTHROPIC_API_KEY` | the Anthropic key starting with `sk-ant-` |
   | `CRON_SECRET` | `07a62781a36e06d4e2ae66f28927c337710efb7ecf75b45e64beff7ddbd854cd` |

   That's 5 variables. The `CRON_SECRET` value above was generated for you — paste it as-is. (It's a random password used so randos can't trigger your background jobs.)

7. If your code is on a branch (not `main`), find the section that says "Branch" or **Production Branch** and change it to `claude/real-estate-comping-foundation-5Xp1Z`.
8. Click **Deploy**. Wait ~3 minutes. You'll see the build log scroll. When it's done, you get a URL like `acquisitions-ai-xyz123.vercel.app`.
9. Click **Visit**. The login page should appear.

### 6) Make your first user (1 minute)

> **Why this:** No accounts exist yet. The first person who signs up automatically becomes the company admin (super-user) for that workspace.

1. On your live site, click **Create an account**.
2. Use your real email + a password you'll remember.
3. Check your email for a confirmation link. Click it.
4. You're in. Click **Comping → + New analysis** and try a deal.

---

## You're done

The app is live. Bookmark the Vercel URL. From now on, every time someone runs an analysis it goes through:

- Supabase (your data)
- Anthropic (Claude reads photos + condition notes)
- Vercel (the website)

When I push code changes to GitHub, Vercel auto-rebuilds within ~2 minutes. No action from you.

---

## When something breaks

Most issues are one of three things. Check in this order:

1. **Page won't load / says 500.** → Vercel dashboard → your project → **Logs**. Screenshot the red lines.
2. **"Vision skipped" appears in every analysis.** → Anthropic balance ran out. Top up at `console.anthropic.com`.
3. **A button does nothing / stuck on "Analyzing…".** → open browser DevTools (F12), screenshot the **Console** tab.

Send me whichever screenshot matches. I'll fix it.

---

## Optional upgrades (do later)

These add data sources. Each is one more environment variable in Vercel → Settings → Environment Variables. Redeploy after adding.

| Upgrade | Sign up at | Variable |
| --- | --- | --- |
| Auto-pull comps from address | rentcast.io | `RENTCAST_API_KEY` |
| Better national tax/sales data | attomdata.com | `ATTOM_API_KEY` |
| Real MLS comps (needs broker sponsor) | bridgedataoutput.com | `BRIDGE_ACCESS_TOKEN` + `BRIDGE_DATASET` |
| School ratings | greatschools.org/api | `GREATSCHOOLS_API_KEY` |
| Crime stats | api.data.gov | `FBI_CRIME_API_KEY` |
| Flood / slope / rail proximity | (free, no signup) | `LOT_SIGNALS_ENABLED=1` |

Until you add any of these, the app falls back to comps the user pastes in by hand. Everything still works.
