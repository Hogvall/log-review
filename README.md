# Raid Log Coach

Paste a Warcraft Logs report and find out what killed you, whether you could have avoided it, and why your DPS is behind similar players.

## Setup

1. Create a Warcraft Logs API client at https://www.warcraftlogs.com/api/clients and leave "Public Client" unchecked.
2. `npm install`
3. `specific dev`. You'll be prompted for `wcl_client_id` and `wcl_client_secret`, which are stored in `specific.local` (gitignored).
4. Create the database tables: `specific exec worker -- npm run migrate -w packages/db`

## The website

1. **Paste a link.** Links that already point at a fight or player skip ahead; `?fight=last` jumps to the last pull.
2. **Pick a pull** (`/r/<code>`). Pulls are grouped by boss, with buttons for the best and the last pull.
3. **Pick yourself** (`/r/<code>/<fight>`). Players are grouped by role. The site remembers your character and offers "Continue as …".
4. **Player report** (`/r/<code>/<fight>/<actor>`, shareable). It shows:
   - **Fix these first:** the top 3 findings.
   - **Deaths:** a raid timeline with the wipe highlighted, plus a **death story** for each death:
     - **Summary:** finds the moment it went wrong (the last time you were at ≥75% health) and says what hit you from then on. For example, "81% → dead in 2.2s, mostly from Living Venom and Protovenom Eruption".
     - **Big hits:** hits worth 20%+ of your health are flagged.
     - **Killing blow:** if it was just the last small tick, the summary says so.
     - **Health graph** across the last 15 seconds.
     - **Event log:** timestamped, with your health after every hit and healing grouped between hits. Each healing row shows who healed and with which spells. The final drop is open; earlier events are collapsed.
     - **Who was healing you (for healers):** each healer's healing and shields during the final drop and over the last 15 seconds, their top spells, and any healing that heal-absorb effects ate.
   - **Damage taken:** each ability labeled Avoidable / Situational / Unavoidable, based on top players.

When the weekly snapshot has data for your spec on that boss, the report also compares you with the **top 15** (medians, with the middle half shown as a range):
- **Header:** DPS vs the median, time spent casting, item level and fight length (top players usually have better gear and shorter kills).
- **Rotation:** casts per minute of every ability that at least half of the top players use.
- **Buffs:** uptime of your cooldowns. Procs and externals are shown separately, for context only.
- **Targets:** your damage split across boss and adds.
- **Cooldowns:** your cooldown casts on a timeline next to the #1 player's.

Findings include an **estimated DPS gain** where it can be computed: missed casts × your damage per cast, or downtime × your DPS. Only abilities that do damage, or cooldowns whose buff top players keep up ≥15% of the fight, become findings, so blinks, defensives and potions don't crowd them out. Healers are compared on casts and buffs only, because their rankings use healing.

"Fix these first" ranks everything in one list: deaths that mattered, then DPS findings worth at least 3%, then repeated avoidable damage, then smaller DPS findings.

Deaths are grouped so that blame isn't unfair. When at least 25% of the raid (and at least 3 players) die within 5 seconds, that's the **wipe**:
- Deaths before the wipe matter most.
- The first deaths of the wipe are flagged as possible causes.
- Deaths during the wipe are "probably not your fault".
- Deaths after the wipe are ignored.

Each analysis costs about 7 WCL queries the first time (deaths, damage taken, players, casts, buffs, damage done and active time), plus 2 per death for the health and healing timeline. The fetched data is cached in Postgres (`player_fight_cache`), so shared links are free. The analysis is recomputed on every view, so it picks up newer benchmarks.

## Weekly benchmark snapshot

Every Wednesday at 06:00 UTC (after both the US and EU resets), the `weekly-snapshot` cron starts a snapshot. The `worker` service then:

1. Fetches the **top 15** players for every spec × boss × difficulty (Mythic and Heroic) in the current partition, including their gear and talents.
2. Downloads each unique fight **once**. Logs never change, so later weeks reuse fights already downloaded. A fight gives metrics for all ~20 players in it, which are used for ability avoidability.
3. Fetches buff uptimes for each ranked player and a cast timeline for each spec's #1.
4. As soon as all of one boss and difficulty's fights are done, aggregates that boss, so Mythic data is usable on day one. When the whole queue is empty, it computes **median** benchmarks per spec (with 25th/75th percentiles) and data-driven avoidability per boss ability, then marks the snapshot `complete`.

The newest `complete` snapshot is the one to compare against. The previous one stays available until the new one finishes. Specs with fewer than 5 ranked players are flagged `insufficient`.

**API budget:** WCL allows 720 points/hour, and almost every query costs about 1 point no matter how much data it returns. The crawler stops for the hour once the client has spent `crawl_point_limit` (default 450), which leaves the rest for the website. A full snapshot is roughly 800 rankings queries plus ~8 per new fight and 1 per ranked player, which takes a few days of the week.

Useful commands:

- Start a snapshot now: `specific exec weekly-snapshot`
- Cheap test snapshot: `specific exec weekly-snapshot -- npm run snapshot:start -w apps/worker -- --test --encounters 3470 --specs Mage-Fire --difficulties 5`
- Check progress: `specific psql main -- -c "select kind, status, count(*) from jobs group by 1, 2"`

## Other commands

- `npm test`: unit tests (vitest)
- `npm run typecheck`
- `specific exec web -- npm run spike -- <report link>`: prints the boss pulls and deaths for a report
- `specific exec web -- npm run measure -- <report code>`: measures the API point cost of each query type
- After changing `packages/db/src/schema.ts`: `npm run generate -w packages/db`, then commit the new migration

## Layout

```
apps/web            Next.js site (UI + API routes)
apps/worker         Benchmark crawler: job queue, API budget, rankings/fight jobs, aggregation
packages/wcl        Warcraft Logs v2 GraphQL client and queries
packages/analysis   Pure functions: fight metrics, medians, benchmarks, avoidability
packages/db         Drizzle schema, client and migrations
specific.hcl        Infrastructure (specific.dev)
```
