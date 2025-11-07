// next.config.ts
import type { NextConfig } from 'next';
import nextPWA from 'next-pwa';

const isProd = process.env.NODE_ENV === 'production';

const withPWA = nextPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: !isProd,                 // SW only in production
  // fallbacks: { document: '/offline' }, // if you added /offline
});

const baseConfig: NextConfig = {
  reactStrictMode: true,
  // (Dev-only experimental flags removed for production build cleanliness)
};

export default withPWA(baseConfig);
