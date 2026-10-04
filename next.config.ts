import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  distDir: process.env.INFRINGE_DIST_DIR || '.next',
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  allowedDevOrigins: ['127.0.0.1'],
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
