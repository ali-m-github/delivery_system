/** @type {import('next').NextConfig} */
const nextConfig = {
  // Whitelist your remote server IP so the Next.js router doesn't block background data fetches
  allowedDevOrigins: ["83.149.106.196", "localhost"],

  // (Keep any other existing config options you already have in here)
};

module.exports = nextConfig;
