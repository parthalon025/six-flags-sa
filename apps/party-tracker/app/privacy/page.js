/**
 * Store-required privacy notice. Location is the product: a device Member
 * shares it with their Party while inside the Venue.
 */
import { BRAND } from '@/lib/brand';

export const metadata = {
  title: `Privacy · ${BRAND.name}`,
  description: `How ${BRAND.name} uses Location and party data.`,
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: '40rem', margin: '2rem auto', padding: '0 1.25rem', lineHeight: 1.55 }}>
      <h1>Privacy</h1>
      <p>
        {BRAND.name} is a park-day companion. A device member of a live party always shares
        Location with that party while inside the venue. There is no pause. Live updates stop
        outside venue bounds; last-known position and an in-bounds trail stay visible to the
        party.
      </p>
      <p>
        Location is not sold. It is not used for ads. Party roster facts (display name, height,
        battery) stay with the party. Signed-in profiles may save managed guests for the next
        visit.
      </p>
      <p>
        The installed app (App Store / Google Play) uses the same rules, with native
        Location — including background Location while you are at the venue — so a
        pocketed phone can keep the party map alive. Push notifies the party of NEED
        HELP and meet updates. The camera is used only to scan a party invite QR.
      </p>
      <p>
        Questions: email{' '}
        <a href="mailto:parkbound@kurat0r.ai">parkbound@kurat0r.ai</a>
        {' '}or open an issue on the{' '}
        <a href="https://github.com/parthalon025/six-flags-sa/issues">project tracker</a>.
      </p>
    </main>
  );
}
