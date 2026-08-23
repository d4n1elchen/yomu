import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // kuromoji reads its .dat.gz dictionary files off disk with Node fs, and
  // better-sqlite3 loads a native .node binding. Neither survives being traced
  // into the server bundle, so they must be required natively at runtime.
  serverExternalPackages: ['kuromoji', 'better-sqlite3'],

  // Dev only: Next blocks dev asset requests from origins it does not
  // recognise, which breaks hydration when the app is opened on the loopback
  // IP rather than on localhost.
  allowedDevOrigins: ['127.0.0.1', '192.168.86.30'],
};

export default nextConfig;
