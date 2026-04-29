/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist ships ESM with optional Node fallbacks.
  // No special webpack config needed for client-side use; pages that import
  // pdfjs are already client components.
  reactStrictMode: true
};

export default nextConfig;
