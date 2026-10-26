/**
 * Root layout: the outer frame that wraps EVERY page of the website.
 * It loads the fonts and the global CSS, and sets the page title.
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Next.js downloads these fonts at build time and serves them from our own site.
// "variable" creates a CSS variable that globals.css uses (--font-sans / --font-mono).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Title and description shown in the browser tab and in search results
export const metadata: Metadata = {
  title: "AI Study Companion",
  description:
    "Upload your study files, then ask questions about them or get a summary with AI.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* "children" is the current page (for example page.tsx) */}
        {children}
      </body>
    </html>
  );
}