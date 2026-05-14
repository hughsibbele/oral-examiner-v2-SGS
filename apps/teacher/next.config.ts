import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@oral-examiner/anonymizer",
    "@oral-examiner/canvas",
    "@oral-examiner/crypto",
    "@oral-examiner/db",
  ],
};

export default nextConfig;
