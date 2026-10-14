import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Meridian claim readiness",
  description: "Prototype: one view of a claim from ClaimsPro, Snowflake and Databricks, checked, with a recommended route. A person makes every decision.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
