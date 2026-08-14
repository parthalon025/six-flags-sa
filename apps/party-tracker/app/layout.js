import './globals.css';
import localFont from 'next/font/local';
import Script from 'next/script';
import { ClerkProvider } from '@clerk/nextjs';
import { BRAND } from '@/lib/brand';
import { INTRO_SEEN_BOOT_SCRIPT } from '@/lib/introGate';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

/* Checked into public/fonts so CI and park wifi never depend on fetching
   Google at build or first paint. Variable face covers 500–800. */
const display = localFont({
  // Latin only on the critical path — brand copy is English; latin-ext adds
  // ~22KB to every first paint for parks that never need it.
  src: [
    {
      path: '../public/fonts/plus-jakarta-sans-latin.woff2',
      weight: '500 800',
      style: 'normal',
    },
  ],
  variable: '--font-display',
  display: 'swap',
});

/* The document title is fixed at build time and the venue is not chosen until
   the app boots, so this stays generic — the loaded venue's name is the first
   thing in the header, which is where anyone actually looks. */
export const metadata = {
  metadataBase: new URL(BRAND.canonicalUrl),
  title: `${BRAND.name} · ${BRAND.slogan}`,
  description: BRAND.shortDescription,
  applicationName: BRAND.name,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: BRAND.canonicalUrl,
    siteName: BRAND.name,
    title: `${BRAND.name} · ${BRAND.slogan}`,
    description: BRAND.shortDescription,
  },
  twitter: {
    card: 'summary',
    title: `${BRAND.name} · ${BRAND.slogan}`,
    description: BRAND.shortDescription,
  },
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
        {/* Manifest only — last venue is often not Kings Island; preloading KI
            map+pois wastes park-wifi bandwidth for returning guests elsewhere. */}
        <link rel="preload" href="/venues/manifest.json" as="fetch" crossOrigin="anonymous" />
        <style>{`:root { --display: var(--font-display), 'Plus Jakarta Sans', 'Nunito Sans', 'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }`}</style>
        <Script
          id="intro-seen-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: INTRO_SEEN_BOOT_SCRIPT }}
        />
      </head>
      <body>
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
        >
          {children}
        </ClerkProvider>
        <Analytics />
        {/* RUM is for ops, not park-day UX — sample so most phones skip the script. */}
        <SpeedInsights sampleRate={0.1} />
      </body>
    </html>
  );
}
