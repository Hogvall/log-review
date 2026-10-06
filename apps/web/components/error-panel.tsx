import Link from "next/link";
import { WclError } from "@log-review/wcl";
import { Panel } from "./ui";

const MESSAGES: Record<WclError["kind"], { title: string; body: string }> = {
  private: {
    title: "This log is private",
    body: "We can only read public logs for now. Ask the uploader to set the report to public on Warcraft Logs, then try again.",
  },
  not_found: {
    title: "Report not found",
    body: "Double-check the link. The report may have been deleted, or the code may be mistyped.",
  },
  rate_limited: {
    title: "We're busy right now",
    body: "We've hit Warcraft Logs' hourly request limit. Please try again in a few minutes.",
  },
  auth: { title: "Something's wrong on our side", body: "We couldn't connect to Warcraft Logs. Please try again later." },
  api: { title: "Warcraft Logs had a problem", body: "Their API returned an error. Please try again in a moment." },
};

/** Friendly page for Warcraft Logs errors; rethrows anything else. */
export function ErrorPanel({ error }: { error: unknown }) {
  if (!(error instanceof WclError)) throw error;
  const { title, body } = MESSAGES[error.kind];
  return (
    <Panel>
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="mt-1 text-fg/85">{body}</p>
      <Link href="/" className="mt-3 inline-block text-sm text-fg underline decoration-line underline-offset-4 hover:decoration-fg">
        Try another log
      </Link>
    </Panel>
  );
}

export function NotFoundPanel({ what }: { what: string }) {
  return (
    <Panel>
      <h1 className="text-lg font-semibold text-fg">{what} not found</h1>
      <Link href="/" className="mt-3 inline-block text-sm text-fg underline decoration-line underline-offset-4 hover:decoration-fg">
        Start over
      </Link>
    </Panel>
  );
}
