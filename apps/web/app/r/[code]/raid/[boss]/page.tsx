import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { DamageCheck, DamageDonut, DeathCauses, PullStrip, RaidDamageTable, RaidFrames, RaidHeader } from "@/components/raid";
import { Section } from "@/components/ui";
import { type RaidView, getRaidView, parseScope } from "@/lib/raid";

export const dynamic = "force-dynamic";

/** The raid leader's whole-raid page for one boss: damage check, deaths and damage taken over a scope of pulls. */
export default async function RaidPage({ params, searchParams }: { params: Promise<{ code: string; boss: string }>; searchParams: Promise<{ scope?: string }> }) {
  const { code, boss } = await params;
  const { scope } = await searchParams;
  const [encounterId, difficulty] = boss.split("-").map(Number);
  if (!encounterId || !difficulty) return <NotFoundPanel what="Boss" />;

  let view: RaidView | null;
  try {
    view = await getRaidView(code, encounterId, difficulty, parseScope(scope));
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (!view || !view.scoped.length) return <NotFoundPanel what={view ? "Pull" : "Boss"} />;

  return (
    <div className="space-y-5">
      <RaidHeader view={view} code={code} page="raid" />
      {view.scoped.length > 1 && (
        <Section title="Pulls" meta="boss health left at the end of each pull; click one to open it">
          <PullStrip view={view} code={code} />
        </Section>
      )}
      <Section title="Is the damage enough?">
        <DamageCheck view={view} code={code} />
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Where the raid's damage taken goes">
          <DamageDonut view={view} />
        </Section>
        <Section title="Raid frames · avoidable damage">
          <RaidFrames view={view} code={code} />
        </Section>
      </div>
      <Section title="What people die to">
        <DeathCauses view={view} code={code} />
      </Section>
      <Section title="Every ability the raid took damage from">
        <RaidDamageTable view={view} code={code} />
      </Section>
    </div>
  );
}
