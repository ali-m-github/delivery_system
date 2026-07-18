import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script"; // 1. Import Next.js Script
import "./globals.css";
import MainLayout from "@/components/MainLayout";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Delivery System",
  description: "Logistics & Delivery Management Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* 2. Use strategy="beforeInteractive" to execute BEFORE vendor scripts */}
        <Script
          id="crypto-polyfill"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function getSafeUUID() {
                  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
                    return window.crypto.randomUUID();
                  }
                  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                  });
                }

                // Expose globally for any script or component to use
                if (typeof window !== 'undefined') {
                  window.getSafeUUID = getSafeUUID;

                  // Also polyfill window.crypto.randomUUID for libraries that call it directly
                  window.crypto = window.crypto || {};
                  if (typeof window.crypto.randomUUID !== 'function') {
                    window.crypto.randomUUID = getSafeUUID;
                  }
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className="min-h-full flex bg-[#0B0F17] text-white"
        suppressHydrationWarning
      >
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}
