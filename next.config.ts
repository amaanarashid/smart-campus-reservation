import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // the firmware routes read the published builds from disk (src/lib/firmware-build.ts)
  outputFileTracingIncludes: {
    "/api/room/wokwi": ["./public/firmware/**/*"],
    "/api/room/firmware/**": ["./public/firmware/**/*"],
  },
};

export default nextConfig;
