import type { NextConfig } from 'next';

const devOrigins = (process.env.YOMU_DEV_ORIGIN ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // kuromoji reads its .dat.gz dictionary files off disk with Node fs, and
  // better-sqlite3 loads a native .node binding. Neither survives being traced
  // into the server bundle, so they must be required natively at runtime.
  serverExternalPackages: ['kuromoji', 'better-sqlite3'],

  experimental: {
    serverActions: {
      // An EPUB is uploaded whole, and a light novel with its illustrations in
      // it runs to 15 MB against a 1 MB default. The limit is on the request,
      // not on what is kept: the parser reads four XML files out of the archive
      // and never inflates the JPEGs that account for nearly all of the size.
      bodySizeLimit: '64mb',
    },
  },

  // Dev only: Next blocks dev asset requests from origins it does not
  // recognise, which breaks hydration when the app is opened on the loopback
  // IP rather than on localhost.
  //
  // The LAN address belongs to whoever is running the server, so it comes from
  // YOMU_DEV_ORIGIN in .env.local (comma-separated for more than one) rather
  // than being committed. Next loads .env files before this config, so the
  // variable is already in the environment here.
  allowedDevOrigins: ['127.0.0.1', ...devOrigins],
};

export default nextConfig;
