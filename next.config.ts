import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships native binaries; keep it out of the server bundle.
  serverExternalPackages: ["sharp"],
  // Route handlers read the sample claims, the extract and the cached packets from disk.
  outputFileTracingIncludes: {
    "/api/**": ["./meridian/**/*", "./sample_claims_mock/**/*", "./sample_claims_variants/**/*", "./data/**/*", "./eval/**/*"],
  },
};

export default nextConfig;
