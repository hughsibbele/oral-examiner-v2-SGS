import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@oral-examiner/anonymizer",
    "@oral-examiner/canvas",
    "@oral-examiner/crypto",
    "@oral-examiner/db",
  ],
  experimental: {
    serverActions: {
      // Default is 1MB; intake-attachment uploads cap at 10MB. Give a bit
      // of header slack — Next applies this to ALL server actions, but
      // every other action in OE is small JSON or short form data, so it's
      // a no-op on the rest of the surface.
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
