import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  agentRules: false,
  turbopack: {
    rules: {
      'maplibre-gl.mjs': {
        loaders: [`${__dirname}/tools/maplibre-url-loader.cjs`],
        as: '*.js',
      },
    },
  },
  transpilePackages: ['maplibre-gl'],
};

export default nextConfig;
