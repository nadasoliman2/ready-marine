/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
      },
      {
        protocol: 'https',
        hostname: 'readymarine.store',
      },
      {
        protocol: 'https',
        hostname: 'www.readymarine.store',
      },
    ],
  },
};

module.exports = nextConfig;
