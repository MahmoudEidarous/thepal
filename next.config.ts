import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Keep the dev overlay badge out of demo recordings.
  devIndicators: false,
};

export default withEve(nextConfig);
