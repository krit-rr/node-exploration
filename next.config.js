/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Google profile avatars
    remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }],
  },
  // Performance optimizations
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverComponentsHmrCache: true,
  },
};

module.exports = nextConfig;
