# Raid Log Coach

Paste a Warcraft Logs report and find out what killed you, whether you could have avoided it, and why your DPS is behind similar players.

## Setup

1. Create a Warcraft Logs API client at https://www.warcraftlogs.com/api/clients and leave "Public Client" unchecked.
2. `npm install`
3. `specific dev`. You'll be prompted for `wcl_client_id` and `wcl_client_secret`, which are stored in `specific.local` (gitignored).
4. Create the database tables: `specific exec worker -- npm run migrate -w packages/db`

## The website

The site has two views, picked on the home page before pasting a link and switchable at the top of every page (each page links to the closest page of the other view):

- **Personal improvement:** your own play next to the top players of your spec: opener, cooldowns, potions and rotation.
- **Raid leader:** the raid as a whole, or one player at a time, over one pull, all wipes, the kill or all pulls.

1. **Pick a view and paste a link.** Links that already point at a fight or player skip ahead; `?fight=last` jumps to the last pull. In the raid view a linked pull opens the raid page for that pull.
2. **Pick a pull** (`/r/<code>`, raid view at `?view=raid`). Pulls are grouped by boss. Personal: buttons for the best and the last pull. Raid leader: All pulls, All wipes, The kill and Players, and each pull opens the raid page for that pull.

### Personal improvement

3. **Pick yourself** (`/r/<code>/<fight>`). Players are grouped by role. The site remembers your character and offers "Continue as …".
4. **Player report** (`/r/<code>/<fight>/<actor>`, shareable). DPS-only: deaths and damage taken live in the raid view (the header links there when you died). A **Cast list / Timeline** switch (remembered per browser) changes how the tabs show casts: a timestamped list ("0:01.2 Fireball") or marks on a time axis.
   - **Rotation mistakes:** every DPS finding, biggest estimated gain first.
   - **Opener:** your precast, then your first 16 casts in the first 30s (movement and defensives left out) step by step next to what most of the top 15 cast at the same step (with the share who did) and #1's cast. A step is marked when your spell is neither the most common one nor one a quarter of top players cast there. Timeline mode shows icon strips for you and the top three. Below: first use of each cooldown vs the top median and #1.
   - **Cooldowns:** each DPS cooldown's casts vs how many top players' pace fits in your time alive and #1's count; then every cooldown cast as a merged list with #1's, or as one lane per cooldown.
   - **Potions:** combat potions drunk, when (1st and 2nd) and which, next to the top players' share who drink two, their median times and the most common potion; healthstones and health potions vs the top median. Then every top player's potions as a table, or as lanes on the fight's time axis.
   - **Rotation:** casts per minute, activity per phase, buff uptime and targets (below).
   - **Every cast:** the whole fight, as a merged log with #1, or as one lane per spell like Warcraft Logs' timeline (your casts on top, #1's faded below, cooldowns highlighted).

   Top players' timelines come from the snapshot (`player_metrics.timeline`, no WCL queries); snapshots from before timelines were stored for everyone fall back to #1 only.

### Raid leader

5. **Raid pages** (`/r/<code>/raid/<encounter>-<difficulty>?scope=all|wipes|kill|<fightId>`). The scope picker chooses all pulls, all wipes, the kill or one pull (pulls under 30s are skipped as resets except when picked on their own). Two pages:
   - **Whole raid:**
     - **Pull strip:** boss health left in each pull of the scope; click one to open it.
     - **Is the damage enough?** For wipes: from the 3 furthest wipes (or the picked pull), damage to the bosses (adds excluded; council bosses together), boss health estimated from damage ÷ health removed, and when the boss would die at that damage rate, drawn against the kill times of the kills the crawler has downloaded: "enough" if it would die by the slower quarter of kills (75th percentile), "close" within 10%, otherwise "short" with how much more damage is needed. For a kill: its length next to other raids' kills.
     - **What people die to:** every death put down to what did the most damage in its ~6s death window (from WCL's Deaths table; not the killing blow). Only deaths that mattered are counted (before the wipe, or among its first deaths). Per cause: deaths, pulls, who, the mechanic it often comes with, and deaths per pull in the first vs second half of the scope (getting better / worse).
     - **What the raid takes damage from:** each boss ability's damage over the scope with its avoidability label, hits per pull, and the three players it hit hardest.
     - **Who takes the most avoidable damage:** avoidable damage per pull, per player. Tanks are judged by the tanks' labels.
   - **Players** (`…/players`): everyone in the scope by role, with DPS vs top players of their spec with the closest kill lengths (from the damage pull), deaths that mattered and avoidable damage per pull.
   - **One player** (`…/players/<actor>`): pull by pull (result, when and to what they died, avoidable damage), their deaths, and damage taken by ability. With one pull picked, the full death stories and damage table:
   - **Deaths (one pull):** a raid timeline with the wipe highlighted, plus a **death story** for each death:
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
   - **Damage taken (one pull):** each ability labeled Avoidable / Situational / Unavoidable / Raid-wide / Targeted, based on top players. **Tanks** are judged by top tanks in the same fights instead, and abilities tanks almost always take while other roles almost never do (boss melee, tank busters) show as **"tank mechanic"** for them and never become findings. For DPS and healers those stay avoidable.

     Only **avoidable** abilities become findings. The label starts from the share of top players who took none (≥85% avoidable, ≤10% unavoidable, situational in between), but two patterns across the sampled kills override it, because neither is about where you stood:
     - **Raid-wide:** happens in at most 60% of top kills, and then hits at least half the raid. It's the penalty for a missed raid mechanic (Unchecked Rage when the tank leaves melee, Noxious Blast from unpopped droplets, Final Ascension).
     - **Targeted:** the boss picks who takes it, so it hits the same number of players (2+, under half the raid) in 90%+ of kills (Grasping Fangs, Doomscale Shell). Targeted abilities the data can't spot (Soul Sever, Icebound Flames) are listed per boss in `packages/encounters`.

     Mitigation doesn't change whether you were hit: damage a shield absorbed counts, hits an immunity cancelled don't (they dealt with the mechanic). On Mythic, top players immune avoidable abilities too rarely (Divine Shield, Blessing of Protection, Cloak on Guillotine, Vile Flood, Volatile Purge) to move any ability across a threshold.

   - Cost: deaths are 1 query for the whole night plus Deaths tables in batches under their 200-entry cap. Each pull costs ~2–3 queries the first time for everyone's damage taken (events, enemy sources) and 1 for damage done (only the damage pulls), each cached per pull in `report_cache`, so a 42-pull night's "all wipes" view is ~100 queries the first time and free after.

The header shows **consumables for the pull**: combat potions, healthstones, and health and mana potions. They're counted from casts by name, because WCL's playerDetails potion and healthstone counts read 0 in current logs.

**Boss tips** live in `packages/encounters`. Each one is a short summary, written for this app, of the [Mythic Trap](https://www.mythictrap.com) guide linked for that boss, matched to log abilities by name. They show under abilities in the damage table, in death stories, and on fix cards. Abilities without a tip keep the data-based hint (e.g. "95% of top players take none").

When the weekly snapshot has data for your spec on that boss, the report also compares you with the **top 15** (medians, with the middle half shown as a range):
- **Header:** DPS vs the top players whose kills were closest in length to your pull (the 5 nearest, when there are 8+ top players), with the all-top-15 median below it. Longer fights mean lower DPS for everyone, so a long wipe isn't held to a short kill's number. Also time spent casting, item level and fight length (top players usually have better gear and shorter kills).
- **Rotation:** casts per minute of every ability that at least half of the top players use. **Cooldowns are counted per fight instead** ("5× of 9× fit"): from top players' timelines, their median first use and median time between casts give a pace, and the expected count is how many casts that pace fits in your time alive, so a 7:12 pull and a 5:20 kill compare fairly. Each row shows how far you are from the top median ("−9%"). Only falling short is colored ("fewer", "not used"). "More" is neutral: casting a spell more than top players usually means it's replacing a stronger one, and when a rotational spell is cast more while another is cast less, the table says so ("Arcane Shot +107% while Aimed Shot −9%: Arcane Shot is probably taking its place"). Utility spells show as "situational". **AoE fillers** (Multi-Shot, Blizzard, Flamestrike, Rain of Fire, Fan of Knives, Divine Storm, …, plus any non-cooldown that spread its damage over 3+ enemies in your pull) show "depends on adds" and aren't judged: how often to cast them depends on how many enemies were up, which differs between kills, wipes and strategies. **Execute spells** (Kill Shot, Execute, Condemn, Shadow Word: Death, Hammer of Wrath at 20%, Soul Reaper at 35%, Touch of Death at 15%) are judged only inside the execute window: from the moment any boss reached the threshold (WCL's health graph, 1 cached query, only for players who cast an execute) until you died or the pull ended. Your casts there ("3× <20%") are compared with what top players' casts per minute in *their* execute windows fit. With no window (or under 20s), they show "boss health" and aren't judged. They're never opener cooldowns.
- **Buffs:** uptime of your cooldowns. Procs and externals are shown separately, for context only.
- **Targets:** your damage split across boss and adds.
- **Opener and Rotation tabs (timeline details):** the fight over time, compared with the top players' medians (and the #1 player's kill for reference; only #1 for snapshots without timeline medians):
  - **Start of the pull:** spells you hardcast before the pull. WCL logs nothing before the pull, so a precast is a cast landing in the first 1.5s with no begincast, for a spell that has a cast time elsewhere in the fight.
  - **Start of the pull** also says how many top players precast, and what.
  - **Opener:** every cast in the first 30 seconds as icon strips next to #1's, and when each cooldown and your combat potion were first used vs the top median and #1. Different combat potions count as the same. Utility spells and cooldowns top players don't press in the first minute are left out. A cooldown at least half of top players press in their opener becomes a finding when you're past their 75th percentile and 8+ seconds behind the median.
  - **Through the fight:** casts per minute and idle time (4+ seconds without finishing a cast while alive) per boss phase, from WCL's phase transitions. Repeated phases are added together; bosses without phases are split into minutes. Your longest idle stretches are listed with timestamps. Expected idle time is worked out phase by phase (the reference's idle share in each phase × your time in it), so a wipe with more intermission than the reference kill isn't blamed for it. Idle time 10+ seconds (and 4% of your time alive) over that becomes a finding with an estimated DPS gain, replacing the "too much time not casting" finding. Idle stretches are labeled with the phase they mostly fall in.
  - **DPS cooldowns over the fight:** in the Cooldowns tab. Defensives and movement aren't shown there: when to use them depends on the fight, not the rotation.

Findings include an **estimated DPS gain** where it can be computed: missed casts × your damage per cast, or downtime × your DPS. An ability is "low" when you're under the top players' 25th percentile and either under 85% of their median or the missed casts are worth 2%+ of your DPS (so a main nuke at 90% still counts). **Utility spells** (movement, the class defensives, barriers, Bloodlust and its kin, and consumables) stay in the tables but never become DPS findings, and Bloodlust isn't shown at all, since one player casts it for the raid. Findings with an estimated gain under 0.5% of your DPS are dropped. Spells logged under two IDs (e.g. Alter Time) show as one row. Only abilities that do damage, or cooldowns whose buff top players keep up ≥15% of the fight, become findings, so blinks, defensives and potions don't crowd them out. Healers are compared on casts and buffs only, because their rankings use healing.

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
