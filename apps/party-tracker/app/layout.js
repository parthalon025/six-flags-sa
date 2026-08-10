import './globals.css';

/* The document title is fixed at build time and the venue is not chosen until
   the app boots, so this stays generic — the loaded venue's name is the first
   thing in the header, which is where anyone actually looks. */
export const metadata = {
  title: 'Party Tracker · live group map',
  description:
    'Live group tracking, walking times and a drawn map of wherever you are, built from OpenStreetMap.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Party Tracker' },
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
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  viewportFit: 'cover',
};

/* No <head>: the type is the system font, which is already on the phone. That
   is the point of using it — an app someone opens on park wifi should not be
   waiting on a font server to render its first label, and the service worker
   skips cross-origin requests anyway, so the webfonts were never cached. */
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/venues/manifest.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/venues/kings-island.map.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/venues/kings-island.pois.json" as="fetch" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
