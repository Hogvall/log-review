import type { ReactNode } from "react";
import Link from "next/link";
import Script from "next/script";
import "./globals.css";

export const metadata = {
  title: "Raid Log Coach",
  description: "Find out what killed you, whether you could have avoided it, and how your raid performance compares.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-slate-200 antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight text-white">
              Raid Log <span className="text-accent">Coach</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-slate-500">
          Log data from{" "}
          <a className="underline hover:text-slate-300" href="https://www.warcraftlogs.com">
            Warcraft Logs
          </a>
          . Spell tooltips from{" "}
          <a className="underline hover:text-slate-300" href="https://www.wowhead.com">
            Wowhead
          </a>
          . Boss strategy guides:{" "}
          <a className="underline hover:text-slate-300" href="https://www.mythictrap.com">
            Mythic Trap
          </a>
          .
        </footer>
        <Script id="wowhead-config" strategy="afterInteractive">
          {`window.whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };`}
        </Script>
        <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
