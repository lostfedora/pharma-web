// types/next-pwa.d.ts
declare module 'next-pwa' {
  import type { NextConfig } from 'next';
  const nextPWA: (options?: any) => (config?: NextConfig) => NextConfig;
  export default nextPWA;
}
