import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Loaded from node_modules at run time: ws has optional native add-ons, and
  // ffmpeg-static locates its binary relative to its own folder.
  serverExternalPackages: ["ws", "ffmpeg-static"],
  // Files read from disk at run time; serverless bundles only contain traced files.
  // Health runs ffmpeg too, to report whether conversion is available.
  outputFileTracingIncludes: {
    "/api/convert": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/ffmpeg.exe", "./public/brand/video-cover.png"],
    "/api/health": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/ffmpeg.exe"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
