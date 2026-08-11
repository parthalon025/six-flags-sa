import './globals.css';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { BRAND } from '@/lib/brand';
import { Analytics } from '@vercel/analytics/next';

/* Self-hosted by Next — same-origin, so park wifi and the service worker can
   keep it after the first load. Used for PARKBOUND, attraction names, and big
   numbers; body copy stays on the system UI stack. */
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

/* The document title is fixed at build time and the venue is not chosen until
   the app boots, so this stays generic — the loaded venue's name is the first
   thing in the header, which is where anyone actually looks. */
export const metadata = {
  title: `${BRAND.name} · ${BRAND.slogan}`,
  description: BRAND.shortDescription,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: BRAND.name,
  },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192' }, { url: '/icon-512.png', sizes: '512x512' }],
    apple: '/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  /* One per appearance, so the status bar and the browser chrome match the
     palette the app is actually drawing. */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F4EC' },
    { media: '(prefers-color-scheme: dark)', color: '#10233F' },
  ],
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={display.variable}>
      <head>
        <link rel="preload" href="/venues/manifest.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/venues/kings-island.map.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/venues/kings-island.pois.json" as="fetch" crossOrigin="anonymous" />
        <style>{`:root { --display: var(--font-display), 'Plus Jakarta Sans', 'Nunito Sans', 'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }`}</style>
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
