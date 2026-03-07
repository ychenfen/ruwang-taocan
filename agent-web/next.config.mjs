import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  async headers() {
    // Avoid serving stale HTML after redeploys (reverse proxy / shared cache may cache
    // prerendered pages with long s-maxage). Static assets under /_next remain hashed.
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3000/:path*",
      },
    ];
  },
};

export default nextConfig;
