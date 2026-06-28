import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar"; // <-- 1. Import Restored

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
      <body
        className="min-h-full flex bg-[#0B0F17] text-white"
        suppressHydrationWarning
      >
        <Sidebar /> {/* <-- 2. Component Restored */}
        <main className="flex-1 overflow-y-auto min-w-0">{children}</main>
      </body>
    </html>
  );
}
