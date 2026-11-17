import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The repo root has its own lockfile; tell Next this folder is the project root.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  // Do not generate an AGENTS.md file inside the app.
  agentRules: false,
  // Optional: let the browser call the backend through this site (same origin, HTTPS) when the backend itself is plain HTTP,
  // e.g. an EC2 Elastic IP with no domain. Set BACKEND_ORIGIN=http://<ip> (server-side, not public) and NEXT_PUBLIC_API_URL=/backend.
  // Without BACKEND_ORIGIN nothing changes.
  async rewrites() {
    const origin = process.env.BACKEND_ORIGIN?.replace(/\/$/, '');
    return origin ? [{ source: '/backend/:path*', destination: `${origin}/:path*` }] : [];
  },
};

export default config;
