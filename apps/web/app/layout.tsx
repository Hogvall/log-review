import type { ReactNode } from "react";

export const metadata = {
  title: "Raid Log Coach",
  description: "Find out what killed you and why your DPS is low.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "0 auto", padding: "2rem 1rem" }}>
        {children}
      </body>
    </html>
  );
}
