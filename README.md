# Raid Log Coach

Paste a Warcraft Logs report and find out what killed you, whether you could have avoided it, and why your DPS is behind similar players.

## Setup

1. Create a Warcraft Logs API client at https://www.warcraftlogs.com/api/clients and leave "Public Client" unchecked.
2. `npm install`
3. `specific dev`. You'll be prompted for `wcl_client_id` and `wcl_client_secret`, which are stored in `specific.local` (gitignored).
4. Create the database tables: `specific exec worker -- npm run migrate -w packages/db`

## Weekly benchmark snapshot

Every Wednesday at 06:00 UTC (after both the US and EU resets), the `weekly-snapshot` cron starts a snapshot. The `worker` service then:

1. Fetches the **top 15** players for every spec × boss × difficulty (Mythic and Heroic) in the current partition, including their gear and talents.
2. Downloads each unique fight **once**. Logs never change, so later weeks reuse fights already downloaded. A fight gives metrics for all ~20 players in it, which are used for ability avoidability.
3. Fetches buff uptimes for each ranked player and a cast timeline for each spec's #1.
4. When the queue is empty, computes **median** benchmarks per spec (with 25th/75th percentiles) and data-driven avoidability per boss ability, then marks the snapshot `complete`.

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
