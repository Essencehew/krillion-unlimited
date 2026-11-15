# Krillion Unlimited

A deep-sea word game with **no daily limit**. You get 7 prompts with 25 seconds each. The rarer your answer, the deeper you sink. At the end you get a score graph showing how you compare with everyone else, plus a per-round dive log.

- **Frontend:** plain HTML/CSS/JS with a pixel-art canvas ocean. There's no build step.
- **Backend:** Vercel serverless functions in `/api`, plus a free **Supabase** Postgres database that counts everyone's answers.
- **Optional:** a free **Google Gemini** API key. It rejects nonsense answers and estimates how common a brand-new answer is.

---

## Run it on your computer

Needs Node 18+.

```bash
npm run dev
# open http://localhost:3000
```

This works with no setup. Without a `.env` file, answers are kept in memory and reset when you restart. To use your real database locally, copy `.env.example` to `.env` and fill it in.

---

## Deploy (all free)

### 1. Put the code on GitHub
Create a new repo and push this folder to it.

### 2. Create the database (Supabase)
1. Go to https://supabase.com and create a free project.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings → API Keys** and copy:
   - your **Project URL** (`https://xxxx.supabase.co`)
   - your **secret key** (starts with `sb_secret_`; on older projects the `service_role` key also works)

Keep the secret key private. It only goes into Vercel's settings, never into the frontend.

### 3. (Recommended) Get a Gemini key
Go to https://aistudio.google.com/apikey and create a free API key. Without it the game still works, but:
- it can't tell that "Pizza" isn't a city in Europe, so brand-new answers are capped at **RARE** to stop people farming points with random words;
- the **ONE IN A KRILLION** tier only unlocks once a second player gives the same rare answer.

### 4. Deploy on Vercel
1. Go to https://vercel.com → **Add New → Project** and import your GitHub repo.
2. Framework preset: **Other**. Leave the build and output settings empty.
3. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SECRET_KEY` | your secret key |
   | `GEMINI_API_KEY` | your Gemini key (optional) |

4. Click **Deploy**.
5. Visit `https://your-app.vercel.app/api/health`. It should say `"database":"supabase"`, and `"aiCheck":true` if you added Gemini.

If you change environment variables later, redeploy so they take effect.

> Free Supabase projects pause after about a week with no activity. If the game suddenly says it's in offline mode, open your Supabase dashboard and restore the project.

---

## How scoring works

Each prompt has a hand-made list of likely answers with estimated popularity (`lib/prompts.js`). That's how the game knows "France" is common before anyone has played. Every real answer is then counted in the database, so real data gradually takes over from the estimates.

An answer's **share** is roughly (estimated + real count) ÷ (all answers to that prompt):

| Tier | Share of divers | Points | Sinks |
|---|---|---|---|
| Plankton | 15% or more | 10 | 100 m |
| Too Clever | not a valid answer | 15 | 150 m |
| Schooler | 3.5 – 15% | 30 | 300 m |
| Rare | 1 – 3.5% | 55 | 550 m |
| Deep Cut | 0.1 – 1% | 85 | 850 m |
| One in a Krillion | under 0.1% and verified | 150 | 1,500 m |

Typos and alternate names are merged ("comp sci" becomes Computer science, "switzerlnd" becomes Switzerland, "KFC" becomes Fried chicken). The final screen shows where your score falls on the distribution of all finished dives, which comes from the `score_buckets` table.

## Customising

- **Name / rounds / timer:** `src/config.js`
- **Prompts:** add a line to `RAW` in `lib/prompts.js`, using the format `[id, question, 'answer:percent|…', 'alias=answer|…']`
- **Prompt ideas from players** land in Supabase → Table editor → `suggestions`

## Project layout

```
index.html, style.css      page + styles
src/                       game code (world rendering, sprites, sounds, charts, game flow)
lib/                       prompts + scoring, shared by browser and API
api/                       Vercel serverless functions (answer, score, suggest, health)
supabase/schema.sql        database setup
dev-server.js              local server for `npm run dev`
```
