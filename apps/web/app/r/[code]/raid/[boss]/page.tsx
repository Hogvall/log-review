import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { AvoidableByPlayer, DamageCheck, DeathCauses, PullStrip, RaidDamageTable, RaidHeader } from "@/components/raid";
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
    <div className="space-y-6">
      <RaidHeader view={view} code={code} page="raid" />
      <PullStrip view={view} code={code} />
      <Section title="Is the damage enough?">
        <DamageCheck view={view} code={code} />
      </Section>
      <Section title="What people die to">
        <DeathCauses view={view} code={code} />
      </Section>
      <Section title="What the raid takes damage from">
        <RaidDamageTable view={view} code={code} />
      </Section>
      <Section title="Who takes the most avoidable damage" meta="click a name for their deaths and hits">
        <AvoidableByPlayer view={view} code={code} />
      </Section>
    </div>
  );
}
