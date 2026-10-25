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
        hostname: 'readycar.store',
      },
      {
        protocol: 'https',
        hostname: 'www.readycar.store',
      },
    ],
  },
};

module.exports = nextConfig;
