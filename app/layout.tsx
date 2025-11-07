// app/layout.tsx (RootLayout)
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import './globals.css';
import Navbar from '@/components/Navbar';
import PwaStatus from '@/components/PwaStatus';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Inspections Portal',
  description: 'Realtime inspections dashboard',

  // --- PWA metadata ---
  manifest: '/manifest.webmanifest',
  themeColor: '#0ea5e9', // match your manifest theme_color
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Inspections Portal',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* Top navigation (optional if you already render it per-page) */}
          <Navbar />

          {/* Page content */}
          <main className="min-h-screen">{children}</main>

          {/* Temporary helper to verify SW registration */}
          <PwaStatus />
        </ThemeProvider>
      </body>
    </html>
  );
}
