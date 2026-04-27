import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { STATIC_SECURITY_HEADERS } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/config.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
    // @ts-expect-error nodeMiddleware is experimental in Next 15.5 and not yet in ExperimentalConfig types
    nodeMiddleware: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: STATIC_SECURITY_HEADERS.map(({ key, value }) => ({ key, value })),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
