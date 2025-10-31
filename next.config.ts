import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure static assets are served correctly
  async headers() {
    return [
      {
        source: '/alphatab/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
