import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";

import "./globals.css";

// The sans stack is the platform UI font (SF on macOS) set in globals.css —
// that is what makes this read as a native app rather than a web page. Only
// the monospace face is loaded, because the diff needs a known metric.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SigmaFold — HBB review",
  description:
    "Version control for genetic engineering. A pull-request review surface for genome edits: branch tree, three-register diff, and a seven-agent CI pipeline with a biosafety gate.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#19191c" },
  ],
};

/**
 * Resolve the theme before first paint so neither mode flashes. Kept inline
 * and tiny on purpose; it reads one localStorage key and one media query.
 */
const themeScript = `(function(){try{var s=localStorage.getItem("sigmafold-theme");var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full overflow-hidden bg-chrome text-foreground">{children}</body>
    </html>
  );
}
