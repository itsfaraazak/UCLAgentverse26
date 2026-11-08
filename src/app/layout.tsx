import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Poppins, JetBrains_Mono } from "next/font/google";
import { ThemeScript } from "@/components/shell/theme-script";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Three faces, each doing one job.
 *
 * Plus Jakarta Sans for UI and Poppins for the wordmark, carried over from
 * this project's existing design language so the two products feel related.
 * Deliberately not Inter and not Helvetica.
 *
 * JetBrains Mono carries the most weight here. The codon and amino-acid diff
 * is the centrepiece of the product, so the monospace face *is* the hero
 * typography, not a code-block afterthought. It was picked for a tall x-height
 * and unambiguous letterforms at small sizes — A/C/G/T stay distinct, and the
 * slashed zero and separated l/1/I matter when a reader is comparing sequences
 * character by character.
 */
const sans = Plus_Jakarta_Sans({
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
 * Wordmark and headings. Poppins at medium weight, matching the type system
 * already used across this project's other product. Weight 500 is the default
 * for the wordmark; 600 is available for headings that need more presence.
 */
const display = Poppins({
  variable: "--font-display-src",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SigmaFold Workbench — clinical scientists and AI agents review genetic variants together",
  description:
    "Version control for variant interpretation. Every prompt, piece of evidence, ACMG classification, comment and sign-off is an attributed delta on a branch, and nothing merges into the case record until every check passes and a named human signs off.",
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
