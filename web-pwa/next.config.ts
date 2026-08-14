/** @type {import('next').NextConfig} */
const nextConfig = {
  // Whitelist dev-server access origins so the Next.js router doesn't block
  // background data fetches: backup server, primary (new) server, the
  // jett.delivery domain, and localhost.
  allowedDevOrigins: [
    "83.149.106.196",
    "94.23.8.106",
    "jett.delivery",
    "www.jett.delivery",
    "localhost",
  ],

  // Externalize tesseract.js to avoid bundling issues with server components
  serverExternalPackages: ["tesseract.js"],

  // Keep `next dev` builds (.next-dev) separate from the production build
  // (.next) so running a dev server never overwrites the PM2 production output.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",

  // (Keep any other existing config options you already have in here)
};

module.exports = nextConfig;
