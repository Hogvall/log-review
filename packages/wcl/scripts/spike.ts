/**
 * Phase 0 spike: prints the boss pulls, players and deaths for a public report.
 *   specific exec web -- npm run spike -- <wcl link or report code>
 */
import {
  WclClient,
  credentialsFromEnv,
  getFightEvents,
  getRateLimit,
  getReportOverview,
  parseReportUrl,
} from "../src/index";

const input = process.argv[2];
const ref = input ? parseReportUrl(input) : null;
if (!ref) {
  console.error("Usage: npm run spike -- <warcraftlogs report link or code>");
  process.exit(1);
}

const client = new WclClient(credentialsFromEnv());
const report = await getReportOverview(client, ref.code);
console.log(`${report.title} (${report.zone?.name ?? "unknown zone"})\n`);

for (const f of report.fights) {
  const result = f.kill ? "KILL" : `wipe @ ${f.bossPercentage?.toFixed(1)}%`;
  const duration = ((f.endTime - f.startTime) / 1000).toFixed(0);
  console.log(`  #${f.id.toString().padStart(3)}  ${f.name.padEnd(30)} ${result.padEnd(14)} ${duration}s`);
}

const fight =
  typeof ref.fight === "number"
    ? report.fights.find((f) => f.id === ref.fight)
    : report.fights.findLast((f) => f.kill) ?? report.fights.at(-1);
if (!fight) {
  console.log("\nNo boss pulls in this report.");
  process.exit(0);
}

const names = new Map(report.players.map((p) => [p.id, `${p.name} (${p.subType})`]));
const abilities = new Map(report.abilities.map((a) => [a.gameID, a.name]));
const deaths = await getFightEvents(client, ref.code, fight, "Deaths");

console.log(`\nDeaths in #${fight.id} ${fight.name}:`);
for (const d of deaths) {
  const t = ((d.timestamp - fight.startTime) / 1000).toFixed(1).padStart(6);
  const who = names.get(d.targetID ?? -1) ?? `actor ${d.targetID}`;
  const killingId = (d.killingAbilityGameID ?? d.abilityGameID) as number | undefined;
  console.log(`  ${t}s  ${who.padEnd(32)} ${abilities.get(killingId ?? -1) ?? "unknown"}`);
}
if (!deaths.length) console.log("  none");

const rl = await getRateLimit(client);
console.log(`\nAPI points used this hour: ${rl.pointsSpentThisHour}/${rl.limitPerHour}`);
