import Link from 'next/link';
import { BRAND } from '@/lib/brand';

export const metadata = {
  title: `Privacy · ${BRAND.name}`,
  description: 'What Parkbound collects, why, and what stays on your phone.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <main className="privacyPage">
      <div className="privacyPage-inner">
        <p className="privacyPage-kicker">
          <Link href="/">{BRAND.name}</Link>
        </p>
        <h1>Privacy</h1>
        <p className="privacyPage-lede">
          Park Bound: Explore, known in the app as Parkbound, is built for a day inside a World — not for
          selling your data. This page says what leaves your phone, what stays local, and what optional
          sign-in adds.
        </p>

        <section>
          <h2>Guest-first</h2>
          <p>
            You can explore a World, discover Places, and join a Party with a display name only. No Profile
            required. Guest choice is stored in this browser session and clears when you close the tab.
          </p>
        </section>

        <section>
          <h2>Location</h2>
          <p>
            The map uses your phone&apos;s location to place you on the drawn World map, rank nearby Side
            Quests, and walk guest-path directions. If you join a Party, Location is shared with others on
            that roster while you are in the park — that is how Rally Points and live Locations work. We do
            not sell location history.
          </p>
        </section>

        <section>
          <h2>Party and Invite</h2>
          <p>
            Party codes are six characters — short enough to read in a queue. The full Invite credential
            lives in the QR or link fragment when you use those flows; typed codes use a one-time exchange
            with the Host. Treat a Party like a semi-public room: use first names, and leave when you are
            done.
          </p>
        </section>

        <section>
          <h2>Profile (optional)</h2>
          <p>
            Sign in with Apple or Google through Clerk when you want XP, Side Quest progress, and Managed
            Guests saved on this phone. Clerk handles authentication; we store a Profile row linked to your
            Clerk user id (display name, optional email from the provider, progress data). There is no
            email-and-password login.
          </p>
        </section>

        <section>
          <h2>Contributions and Side Quests</h2>
          <p>
            Gap Side Quests and Contributions require a Profile. Live ride reports in a Party use your
            display name only. Uploaded Contributions improve shared map truth; see in-app Side Quests for
            what is sent.
          </p>
        </section>

        <section>
          <h2>Analytics</h2>
          <p>
            We use privacy-focused page analytics (Vercel Analytics / Speed Insights) to understand
            performance — not to track you across other sites. No third-party ad network.
          </p>
        </section>

        <section>
          <h2>Data retention and deletion</h2>
          <p>
            Party roster data is ephemeral to the day. Profile data persists until you delete your account
            from Me. Local map caches and offline World files stay on your device until you clear site
            data or uninstall.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions: <a href="mailto:parthalon025@gmail.com">parthalon025@gmail.com</a>
          </p>
          <p className="privacyPage-muted">Last updated August 2026 · {BRAND.canonicalUrl}</p>
        </section>
      </div>
    </main>
  );
}
