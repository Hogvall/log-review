/**
 * Measures the WCL API point cost of each query type the weekly snapshot needs,
 * and saves sample responses so we can see the real data shapes.
 *   specific exec web -- npm run measure -- <any report code from the current tier> [outDir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WclClient, credentialsFromEnv, getRateLimit } from "../src/index";

const [code, outDir = "measure-out"] = process.argv.slice(2);
if (!code) {
  console.error("Usage: npm run measure -- <report code> [outDir]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const client = new WclClient(credentialsFromEnv());

async function spent(): Promise<number> {
  return (await getRateLimit(client)).pointsSpentThisHour;
}

const rlBefore = await spent();
const rlCost = (await spent()) - rlBefore;
console.log(`rateLimitData query itself: ${rlCost.toFixed(3)} points`);

async function measure<T>(label: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const before = await spent();
  const data = await client.query<T>(query, variables);
  const cost = (await spent()) - before - rlCost;
  const json = JSON.stringify(data);
  console.log(`${label.padEnd(40)} ${cost.toFixed(3).padStart(8)} points   ${(json.length / 1024).toFixed(0).padStart(6)} KB`);
  writeFileSync(join(outDir, `${label.replace(/\W+/g, "_")}.json`), JSON.stringify(data, null, 2));
  return data;
}

const zoneOfReport = await measure<{ reportData: { report: { zone: { id: number } } } }>(
  "report zone",
  `query($code:String!){ reportData { report(code:$code) { zone { id } } } }`,
  { code },
);
const zoneId = zoneOfReport.reportData.report.zone.id;

await measure(
  "zone encounters+partitions",
  `query($id:Int!){ worldData { zone(id:$id) { id name difficulties { id name sizes } encounters { id name } partitions { id name compactName default } } } }`,
  { id: zoneId },
);

await measure("classes+specs", `{ gameData { classes { id name slug specs { id name slug } } } }`);

const zone = await client.query<{ worldData: { zone: { encounters: { id: number; name: string }[] } } }>(
  `query($id:Int!){ worldData { zone(id:$id) { encounters { id name } } } }`,
  { id: zoneId },
);
const encounter = zone.worldData.zone.encounters[0]!;
console.log(`(using encounter ${encounter.id} ${encounter.name})`);

const rankings = await measure<{ worldData: { encounter: { characterRankings: { rankings: any[] } } } }>(
  "characterRankings mythic fire mage",
  `query($id:Int!){ worldData { encounter(id:$id) { characterRankings(className:"Mage", specName:"Fire", difficulty:5, metric:dps, includeCombatantInfo:true) } } }`,
  { id: encounter.id },
);
await measure(
  "characterRankings no combatantInfo",
  `query($id:Int!){ worldData { encounter(id:$id) { characterRankings(className:"Mage", specName:"Fire", difficulty:5, metric:dps, includeCombatantInfo:false) } } }`,
  { id: encounter.id },
);

const top = rankings.worldData.encounter.characterRankings.rankings[0];
if (!top) {
  console.log("No rankings returned; cannot measure fight queries.");
  process.exit(0);
}
const topCode: string = top.report.code;
const topFight: number = top.report.fightID;
console.log(`(using ranked fight ${topCode} #${topFight})`);

const meta = await measure<{
  reportData: { report: { fights: { id: number; startTime: number; endTime: number }[] } };
}>(
  "fight meta + actors",
  `query($code:String!,$f:[Int]!){ reportData { report(code:$code) { fights(fightIDs:$f) { id encounterID difficulty kill startTime endTime friendlyPlayers } masterData { actors(type:"Player") { id name server subType } } } } }`,
  { code: topCode, f: [topFight] },
);
const fight = meta.reportData.report.fights[0]!;

for (const dataType of ["Casts", "Buffs", "DamageTaken", "Deaths"]) {
  await measure(
    `events ${dataType} (page 1, all players)`,
    `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!){ reportData { report(code:$code) { events(fightIDs:$f, dataType:${dataType}, startTime:$s, endTime:$e, limit:10000) { nextPageTimestamp data } } } }`,
    { code: topCode, f: [fight.id], s: fight.startTime, e: fight.endTime },
  );
}

for (const dataType of ["Casts", "Buffs", "DamageTaken"]) {
  await measure(
    `table ${dataType} (all players)`,
    `query($code:String!,$f:[Int]!){ reportData { report(code:$code) { table(fightIDs:$f, dataType:${dataType}) } } }`,
    { code: topCode, f: [fight.id] },
  );
}

await measure(
  "playerDetails",
  `query($code:String!,$f:[Int]!){ reportData { report(code:$code) { playerDetails(fightIDs:$f) } } }`,
  { code: topCode, f: [fight.id] },
);

const rl = await getRateLimit(client);
console.log(`\nTotal spent this hour: ${rl.pointsSpentThisHour.toFixed(2)}/${rl.limitPerHour}`);
