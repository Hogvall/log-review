import { type ReactNode, Suspense } from "react";
import { Inter_Tight, Space_Mono } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import { ViewNav } from "@/components/view-nav";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter-tight" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-space-mono" });

export const metadata = {
  title: "Raid Log Coach",
  description: "What killed you, whether you could have avoided it, and how you compare with top players.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans text-[15px] text-fg antialiased">
        <header className="border-b border-line bg-[#121a2c]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-stretch px-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Link href="/" className="py-3 leading-tight">
              <span className="block text-lg font-extrabold tracking-tight text-fg">Raid Log Coach</span>
              <span className="text-sm text-muted">The Venomous Abyss · Mythic</span>
            </Link>
            <Suspense fallback={null}>
              <ViewNav />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl border-t border-line px-4 py-4 text-xs text-faint">
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
