import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route handlers read the sample claims, the extract and the cached packets from disk.
  outputFileTracingIncludes: {
    "/api/**": ["./meridian/**/*", "./sample_claims_mock/**/*", "./sample_claims_variants/**/*", "./data/**/*", "./eval/**/*"],
  },
};

export default nextConfig;
