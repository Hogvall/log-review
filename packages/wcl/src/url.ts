/** A Warcraft Logs report reference parsed from a pasted link or bare code. */
export interface ReportRef {
  code: string;
  /** Numeric fight ID, "last" for the most recent pull, or undefined if not specified. */
  fight?: number | "last";
  /** Actor ID of the selected player, if the link was opened on a player. */
  source?: number;
}

const CODE_RE = /^[a-zA-Z0-9]{16}$/;

/**
 * Accepts things like:
 *   https://www.warcraftlogs.com/reports/AbCdEf1234567890#fight=5&source=12
 *   https://classic.warcraftlogs.com/reports/AbCdEf1234567890?fight=last
 *   AbCdEf1234567890
 * Returns null if no report code can be found.
 */
export function parseReportUrl(input: string): ReportRef | null {
  const trimmed = input.trim();
  if (CODE_RE.test(trimmed)) return { code: trimmed };

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!/(^|\.)warcraftlogs\.com$/.test(url.hostname)) return null;

  const match = url.pathname.match(/\/reports\/([a-zA-Z0-9]{16})/);
  if (!match) return null;

  // WCL puts fight/source in the hash, but older links use the query string.
  const params = new URLSearchParams(url.search);
  for (const [k, v] of new URLSearchParams(url.hash.replace(/^#/, ""))) params.set(k, v);

  const ref: ReportRef = { code: match[1]! };
  const fight = params.get("fight");
  if (fight === "last") ref.fight = "last";
  else if (fight && /^\d+$/.test(fight)) ref.fight = Number(fight);
  const source = params.get("source");
  if (source && /^\d+$/.test(source)) ref.source = Number(source);
  return ref;
}
