import type { Metadata, Viewport } from "next";
import { SwRegistrar } from "@/components/SwRegistrar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audiobook Reader",
  description: "Listen to any PDF as a synchronized audiobook.",
  applicationName: "Audiobook Reader",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Audiobook",
    statusBarStyle: "black-translucent"
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  }
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  userScalable: false
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-text antialiased">
        {children}
        <SwRegistrar />
      </body>
    </html>
  );
}
