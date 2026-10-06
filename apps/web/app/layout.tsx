import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata = {
  title: "Raid Log Coach",
  description: "What killed you, whether you could have avoided it, and how you compare with top players.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans text-[15px] text-fg antialiased">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
            <Link href="/" className="text-sm font-semibold uppercase tracking-[0.07em] text-fg">
              Raid Log Coach
            </Link>
            <span className="text-xs text-faint">The Venomous Abyss</span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl border-t border-line px-4 py-4 text-xs text-faint">
          Logs from{" "}
          <a className="underline decoration-line underline-offset-4 hover:text-muted" href="https://www.warcraftlogs.com">
            Warcraft Logs
          </a>
          , tooltips from{" "}
          <a className="underline decoration-line underline-offset-4 hover:text-muted" href="https://www.wowhead.com">
            Wowhead
          </a>
          , boss guides from{" "}
          <a className="underline decoration-line underline-offset-4 hover:text-muted" href="https://www.mythictrap.com">
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
