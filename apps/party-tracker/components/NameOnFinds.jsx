'use client';

import { useEffect, useState } from 'react';
import { patchProfileCache, readProfileCache, sharesName } from '@/lib/auth/profileCache';

/**
 * "Name on your finds" — whether a Contribution carries who filed it.
 *
 * It sits under the name field in Settings → You because that is the question
 * it answers: this is the second half of "what other guests see me called".
 * The flag rides on every Contribution as `authorName` / `authorTitle` (see
 * SideQuestsPanel's submit), so turning it off does not hide the find, it
 * makes the find read as "a fellow guest".
 *
 * Reads the Profile cache directly and writes it back with `patchProfileCache`,
 * which merges rather than replaces — the throttled stats sync on Me is
 * writing to the same record and must not clobber a toggle mid-flight.
 * Deliberately does NOT touch /api/profile/sync: that fetch is throttled at
 * module scope on ProfileJourney and a second caller would double-fire it.
 */
export default function NameOnFinds({ session = null }) {
  const [snap, setSnap] = useState(null);

  useEffect(() => {
    let alive = true;
    readProfileCache()
      .then((s) => {
        if (alive && s?.userId) setSnap(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session?.userId]);

  if (!session?.userId) return null;

  const shareName = sharesName(snap);

  async function toggle() {
    const next = !shareName;
    setSnap((s) => ({ ...(s || {}), shareName: next }));
    try {
      await patchProfileCache({ shareName: next });
    } catch {
      /* private mode — the in-memory choice still holds this session */
    }
  }

  return (
    <div className="rowList">
      <button
        type="button"
        className="row flat journeyShare"
        role="switch"
        aria-checked={shareName}
        onClick={toggle}
      >
        <span className="rowText">
          Name on your finds
          <span className="fine">
            {shareName
              ? `Guests see “first found by ${session.displayName || 'you'}” on facts you settle.`
              : 'Your finds read as “a fellow guest”. Flip it back any time.'}
          </span>
        </span>
        <span className={`journeySwitch ${shareName ? 'on' : ''}`} aria-hidden="true">
          <i />
        </span>
      </button>
    </div>
  );
}
