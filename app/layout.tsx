import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audiobook Reader",
  description: "Listen to any PDF as a synchronized audiobook.",
  appleWebApp: {
    capable: true,
    title: "Audiobook",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#0b0b10",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink dark:bg-ink dark:text-paper">
        {children}
      </body>
    </html>
  );
}
