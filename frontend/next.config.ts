/**
 * Next.js settings for the frontend
 * Everything here is optional: without it Next.js uses its defaults
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not tell visitors which framework runs the site (hides "X-Powered-By")
  poweredByHeader: false,

  // Simple security headers that are added to every page
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // The browser must trust the file type we send (no guessing)
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Other websites cannot show our site inside an iframe (clickjacking)
          { key: "X-Frame-Options", value: "DENY" },
          // Send less information about our pages to other websites
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;