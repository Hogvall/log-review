import { WclClient, WclError, credentialsFromEnv, getReportOverview, parseReportUrl } from "@log-review/wcl";

export const dynamic = "force-dynamic";

let client: WclClient | undefined;

const STATUS: Record<WclError["kind"], number> = { auth: 500, not_found: 404, private: 403, rate_limited: 429, api: 502 };

export async function GET(req: Request) {
  const ref = parseReportUrl(new URL(req.url).searchParams.get("url") ?? "");
  if (!ref) return Response.json({ error: "That doesn't look like a Warcraft Logs report link." }, { status: 400 });

  try {
    client ??= new WclClient(credentialsFromEnv());
    const report = await getReportOverview(client, ref.code);
    return Response.json({ ref, report });
  } catch (err) {
    if (err instanceof WclError) return Response.json({ error: err.message }, { status: STATUS[err.kind] });
    throw err;
  }
}
