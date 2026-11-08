import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SigmaFold — Bench",
  description:
    "Version control for genetic engineering: a lab-instrument view of a genome edit, its agent CI run and an illustrative capillary-flow simulation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        {/*
          Resolve the stored or system theme before first paint so the
          instrument never flashes the wrong panel lighting.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("sigmafold-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
