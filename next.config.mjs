import withSerwistInit from "@serwist/next";

const isDev = process.env.NODE_ENV === "development";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Critical: keep these OFF. With reloadOnOnline=true a network blip on
  // cellular triggers a hard page reload mid-session. With cacheOnNavigation
  // we'd thrash precaching during long-running audio sessions.
  cacheOnNavigation: false,
  reloadOnOnline: false,
  disable: isDev
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true
};

export default withSerwist(nextConfig);
