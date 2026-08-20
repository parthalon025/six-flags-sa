'use client';

import ProfileJourney from '@/components/ProfileJourney';
import RankPrizeCatalog from '@/components/RankPrizeCatalog';
import SignInCard from '@/components/SignInCard';

/**
 * Me — the tab's root.
 *
 * What a person came to this tab for is their own standing: the Title, the
 * walk to the next one, and what it has been worth to other guests. That was
 * previously three blocks inside Settings → You, which put the answer to
 * "how am I doing" behind a screen named after the phone's preferences.
 *
 * So Me is a root in its own right, and the two things underneath it are
 * pushed screens on the app's own nav stack (`VIEW_TITLES`, `navHead`, `pop`
 * in app/page.js): Collection, and Settings. Neither draws its own back
 * button — the sheet's navigation bar already has one, and it slides.
 */
export default function MePanel({
  session = null,
  onSession = null,
  profileXp = 0,
  /** worldProgress.meters.contributions — the domain's own count of facts
   *  filed, which is what "Contributions" means in CONTEXT.md. */
  contributions = 0,
  onOpenCloset = null,
  onOpenSettings = null,
}) {
  return (
    <div className="mePanel">
      {/* Signed out there is no journey to draw, so the card that fixes that
          leads the screen. Signed in it does not repeat here — Settings → You
          is where the Profile and its Sign out live, and two Sign out buttons
          one push apart is a screen asking a question nobody asked. */}
      {session?.userId ? null : <SignInCard session={session} onSession={onSession} />}

      <ProfileJourney session={session} contributions={contributions} />

      <div className="label">Everything else</div>
      <div className="rowList">
        <button type="button" className="row" onClick={() => onOpenCloset?.()}>
          <span className="rowText">
            Collection
            <span className="fine">Skins, Kits, Marks</span>
          </span>
        </button>
        <button type="button" className="row" onClick={() => onOpenSettings?.()}>
          <span className="rowText">
            Settings
            <span className="fine">You, Map, Phone, More</span>
          </span>
        </button>
      </div>

      {/* The full ladder of what each rung grants. It stays on the root rather
          than behind a chevron because it is the answer to "why would I keep
          doing this", and a Steward reading a one-rung screen would see a dead
          end — the catalogue is five rungs deep whatever this Profile's XP. */}
      <RankPrizeCatalog xp={profileXp} />
    </div>
  );
}
