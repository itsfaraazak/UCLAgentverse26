import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { ThemeScript } from "@/components/shell/theme-script";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Three faces, each doing one job.
 *
 * Deliberately not Inter and not Helvetica: both are correct and both read as
 * a default rather than a decision.
 *
 * JetBrains Mono carries the most weight here. The codon and amino-acid diff
 * is the centrepiece of the product, so the monospace face *is* the hero
 * typography, not a code-block afterthought. It was picked for a tall x-height
 * and unambiguous letterforms at small sizes — A/C/G/T stay distinct, and the
 * slashed zero and separated l/1/I matter when a reader is comparing sequences
 * character by character.
 */
const sans = Geist({
  variable: "--font-sans-src",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Editorial counterweight for the wordmark, section headings and large
 * figures. A high-contrast serif against a technical mono is what stops the
 * app reading as another dark dashboard template.
 *
 * Regular only — Instrument Serif ships a single weight, so do not reach for
 * `font-bold` on it; size and colour carry the hierarchy instead.
 */
const display = Instrument_Serif({
  variable: "--font-display-src",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SigmaFold — version control for genetic engineering",
  description:
    "Open a branch, apply an edit to a genotype, and a multi-agent CI pipeline decides whether it passes — structurally, functionally, and on biosafety grounds — before it can be merged.",
  applicationName: "SigmaFold",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1c20" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`}
      // `ThemeScript` writes the theme class before first paint, so the
      // server-rendered markup and the first client render can disagree.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider delay={250}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
