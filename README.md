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
     - **Boss debuffs:** every boss debuff you had in the last 15 seconds, with its peak stack count. Applications and stack increases appear as timestamped rows in the event log.
     - **What you did to survive:**
       - Personal defensives used in the last 15 seconds.
       - Defensives you probably had ready but didn't press: never used this pull, or past their base cooldown.
       - Healthstone and health-potion use.

       Defensives come from a per-class list matched by spell name (`packages/analysis/src/defensives.ts`). One you never pressed is only mentioned if it's core to the class, or most top players of your spec use it.
     - **How to handle it:** boss tips for the abilities in the final drop.
     - **Who was healing you (for healers):** each healer's healing and shields during the final drop and over the last 15 seconds, their top spells, and any healing that heal-absorb effects ate.
   - **Damage taken:** each ability labeled Avoidable / Situational / Unavoidable, based on top players. **Tanks** are judged by top tanks in the same fights instead, and abilities tanks almost always take while other roles almost never do (boss melee, tank busters) show as **"tank mechanic"** for them and never become findings. For DPS and healers those stay avoidable.

The header shows **consumables for the pull**: combat potions, healthstones, and health and mana potions. They're counted from casts by name, because WCL's playerDetails potion and healthstone counts read 0 in current logs.

**Boss tips** live in `packages/encounters`. Each one is a short summary, written for this app, of the [Mythic Trap](https://www.mythictrap.com) guide linked for that boss, matched to log abilities by name. They show under abilities in the damage table, in death stories, and on fix cards. Abilities without a tip keep the data-based hint (e.g. "95% of top players take none").

When the weekly snapshot has data for your spec on that boss, the report also compares you with the **top 15** (medians, with the middle half shown as a range):
- **Header:** DPS vs the top players whose kills were closest in length to your pull (the 5 nearest, when there are 8+ top players), with the all-top-15 median below it. Longer fights mean lower DPS for everyone, so a long wipe isn't held to a short kill's number. Also time spent casting, item level and fight length (top players usually have better gear and shorter kills).
- **Rotation:** casts per minute of every ability that at least half of the top players use. **Cooldowns are counted per fight instead** ("5× of 9× fit"): from top players' timelines, their median first use and median time between casts give a pace, and the expected count is how many casts that pace fits in your time alive, so a 7:12 pull and a 5:20 kill compare fairly. Each row shows how far you are from the top median ("−9%"). Only falling short is colored ("fewer", "not used"). "More" is neutral: casting a spell more than top players usually means it's replacing a stronger one, and when a rotational spell is cast more while another is cast less, the table says so ("Arcane Shot +107% while Aimed Shot −9%: Arcane Shot is probably taking its place"). Utility spells show as "situational". **AoE fillers** (Multi-Shot, Blizzard, Flamestrike, Rain of Fire, Fan of Knives, Divine Storm, …, plus any non-cooldown that spread its damage over 3+ enemies in your pull) show "depends on adds" and aren't judged: how often to cast them depends on how many enemies were up, which differs between kills, wipes and strategies. **Execute spells** (Kill Shot, Execute, Condemn, Shadow Word: Death, Hammer of Wrath at 20%, Soul Reaper at 35%, Touch of Death at 15%) are judged only inside the execute window: from the moment any boss reached the threshold (WCL's health graph, 1 cached query, only for players who cast an execute) until you died or the pull ended. Your casts there ("3× <20%") are compared with what top players' casts per minute in *their* execute windows fit. With no window (or under 20s), they show "boss health" and aren't judged. They're never opener cooldowns.
- **Buffs:** uptime of your cooldowns. Procs and externals are shown separately, for context only.
- **Targets:** your damage split across boss and adds.
- **Timeline:** the fight over time, compared with the top players' medians (and the #1 player's kill for reference; only #1 for snapshots without timeline medians):
  - **Start of the pull:** spells you hardcast before the pull. WCL logs nothing before the pull, so a precast is a cast landing in the first 1.5s with no begincast, for a spell that has a cast time elsewhere in the fight.
  - **Start of the pull** also says how many top players precast, and what.
  - **Opener:** every cast in the first 30 seconds as icon strips next to #1's, and when each cooldown and your combat potion were first used vs the top median and #1. Different combat potions count as the same. Utility spells and cooldowns top players don't press in the first minute are left out. A cooldown at least half of top players press in their opener becomes a finding when you're past their 75th percentile and 8+ seconds behind the median.
  - **Through the fight:** casts per minute and idle time (4+ seconds without finishing a cast while alive) per boss phase, from WCL's phase transitions. Repeated phases are added together; bosses without phases are split into minutes. Your longest idle stretches are listed with timestamps. Expected idle time is worked out phase by phase (the reference's idle share in each phase × your time in it), so a wipe with more intermission than the reference kill isn't blamed for it. Idle time 10+ seconds (and 4% of your time alive) over that becomes a finding with an estimated DPS gain, replacing the "too much time not casting" finding. Idle stretches are labeled with the phase they mostly fall in.
  - **DPS cooldowns over the fight:** your DPS cooldown and combat potion casts on a timeline next to #1's. Defensives and movement aren't shown anywhere in the Timeline tab: when to use them depends on the fight, not the rotation.

Findings include an **estimated DPS gain** where it can be computed: missed casts × your damage per cast, or downtime × your DPS. An ability is "low" when you're under the top players' 25th percentile and either under 85% of their median or the missed casts are worth 2%+ of your DPS (so a main nuke at 90% still counts). **Utility spells** (movement, the class defensives, barriers, Bloodlust and its kin, and consumables) stay in the tables but never become DPS findings, and Bloodlust isn't shown at all, since one player casts it for the raid. Findings with an estimated gain under 0.5% of your DPS are dropped. Spells logged under two IDs (e.g. Alter Time) show as one row. Only abilities that do damage, or cooldowns whose buff top players keep up ≥15% of the fight, become findings, so blinks, defensives and potions don't crowd them out. Healers are compared on casts and buffs only, because their rankings use healing.

"Fix these first" ranks everything in one list: deaths that mattered, then DPS findings worth at least 3%, then repeated avoidable damage, then smaller DPS findings.

Deaths are grouped so that blame isn't unfair. When at least 25% of the raid (and at least 3 players) die within 5 seconds, that's the **wipe**:
- Deaths before the wipe matter most.
- The first deaths of the wipe are flagged as possible causes.
- Deaths during the wipe are "probably not your fault".
- Deaths after the wipe are ignored.

Each analysis costs about 7 WCL queries the first time (deaths, damage taken, players, casts, buffs, damage done and active time), plus 2 per death for the health and healing timeline, plus 1 for your boss debuffs over the pull, plus 1 a day per boss and spec for the #1 player's phase timings if the crawler didn't store them. The fetched data is cached in Postgres (`player_fight_cache`), so shared links are free. The analysis is recomputed on every view, so it picks up newer benchmarks.

## Weekly benchmark snapshot

Every Wednesday at 06:00 UTC (after both the US and EU resets), the `weekly-snapshot` cron starts a snapshot. The `worker` service then:

1. Fetches the **top 15** players for every spec × boss on the difficulties in `crawl_difficulties` (default `5`, Mythic only; `5,4` adds Heroic) in the current partition, including their gear and talents.
2. Downloads each unique fight **once**. Logs never change, so later weeks reuse fights already downloaded. Per fight:
   - **2 queries for everyone:** active time and target split.
   - **Damage taken** for only the first 60 fights of each boss and difficulty. That sample of ~1,200 players is enough for avoidability, and skipping the rest roughly halves the crawl.
   - **1 query** for the fight's boss phases, each enemy's health over the fight (when bosses reached 15/20/35% for execute windows), and the report's ability names.
3. Per ranked player: their own cast events (cast counts, the full timeline and precasts) and Buffs table. Both are complete, unlike the all-player tables, which cut ability lists at 5.
4. As soon as all of one boss and difficulty's fights are done, aggregates that boss, so Mythic data is usable on day one. A boss is aggregated again whenever its jobs finish after its last aggregation, or when it was aggregated with an older `BENCHMARK_VERSION` (bump it in `packages/analysis/src/benchmark.ts` when aggregation changes; the worker then re-aggregates every snapshot, including complete ones, without a new crawl). Spec benchmarks include timeline medians: first use of each cooldown and the combat potion, share of players who precast, and casts per minute and idle share per phase. When the whole queue is empty, it computes **median** benchmarks (with 25th/75th percentiles) per spec and data-driven avoidability per boss ability, then marks the snapshot `complete`.

On startup the worker re-queues finished fights of running snapshots that are missing timelines or phases (crawled before they were stored); the fight job then fetches only what's missing.

The newest `complete` snapshot is the one to compare against. The previous one stays available until the new one finishes. Specs with fewer than 5 ranked players are flagged `insufficient`.

**API budget:** WCL allows 720 points/hour, and almost every query costs about 1 point no matter how much data it returns. The crawler stops for the hour once the client has spent `crawl_point_limit` (default 450), which leaves the rest for the website. A full snapshot is roughly 800 rankings queries plus ~3 per new fight and ~2 per ranked player, about 45–50k points or ~4–5 days. The budget is shared by everything that uses the client (production, local dev and the website), so a local crawler pauses when production has used the hour's share.

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
packages/analysis   Pure functions: fight metrics, medians, benchmarks, avoidability, deaths, defensives
packages/encounters Per-boss tips and guide links for the current tier
packages/db         Drizzle schema, client and migrations
specific.hcl        Infrastructure (specific.dev)
```
