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
  /* The status bar follows the map, so it is stated per appearance
     rather than frozen dark. The manual day/night toggle updates the
     same meta tag at runtime. */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F2F7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    /* No web fonts. The type is the platform's own UI face — SF on
       Apple hardware — which is both the right face for this design
       and one less render-blocking request on a phone with two bars
       of signal in the middle of a park. */
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
