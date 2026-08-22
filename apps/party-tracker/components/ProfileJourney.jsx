'use client';

import { useEffect, useState } from 'react';
import TitleProgress from '@/components/TitleProgress';
import { patchProfileCache, readProfileCache } from '@/lib/auth/profileCache';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';
import {
  RANK_LADDER,
  XP_AWARDS,
  rankProgress,
  rankReward,
} from '@party-tracker/shared/questScore.js';

/**
 * The Me tab's journey — the contemplation view of the XP → Title loop.
 *
 * This is the root of Me now, not a card buried three blocks inside Settings,
 * so it is flat: the Title and the walk to the next one, what that has been
 * worth to other guests, then the whole ladder. Nothing here is behind a
 * "show me the rest" toggle any more — the toggle existed because this was a
 * guest inside somebody else's screen.
 *
 * Reads the offline Profile cache; a throttled server refresh updates only the
 * server-owned stats (impactHelped, reputation) so the XP bar never rolls
 * backwards. Mounted once, on Me — the fetch below is module-throttled and
 * would double-fire if a second surface rendered this component.
 */

/** What each Title means for the guest — warm, and only about what exists. */
const JOURNEY_COPY = {
  visitor: 'Your Profile keeps every XP.',
  scout: 'The Title under your name.',
  ranger: 'A Title other guests notice.',
  cartographer: 'The mapmaker’s Title.',
  steward: 'Top of the ladder — thank you.',
};

/* What XP is actually paid for, so the next rung reads as a walk of a known
   length rather than a number that arrives from nowhere. Straight off
   XP_AWARDS — the same constants awardQuestXp scores against. */
const AWARD_LINES = [
  ['First answer to a gap', XP_AWARDS.first],
  ['Confirm or deny', XP_AWARDS.confirm],
  ['Live Ride report', XP_AWARDS.live],
  ['First helpful report of the day', XP_AWARDS.firstHelpfulDay],
];

/** Server-owned stats re-fetch, at most once a minute across mounts. */
let lastStatsSyncAt = 0;

export default function ProfileJourney({ session = null, contributions = 0 }) {
  const [snap, setSnap] = useState(null);
  const [openRank, setOpenRank] = useState(null);

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

  useEffect(() => {
    if (!session?.userId) return undefined;
    // Clerk-off builds have no /api/profile/sync identity — skip quietly so a
    // dead 401 never lands in the console.
    if (!clerkBrowserConfigured()) return undefined;
    if (Date.now() - lastStatsSyncAt < 60000) return undefined;
    lastStatsSyncAt = Date.now();
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/profile/sync', { method: 'POST' });
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.profile) return;
        // Patch only the server-owned fields, atomically — a finder-credit
        // toggle mid-flight must never be reverted by this write.
        const next = await patchProfileCache({
          impactHelped: Number(data.profile.impactHelped) || 0,
          reputation: Number(data.profile.reputation) || 0,
        });
        if (alive && next) setSnap(next);
      } catch {
        /* offline or Clerk-off — the cache is the day's truth */
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.userId]);

  if (!session?.userId) return null;

  const xp = Number(snap?.xp ?? session.xp) || 0;
  const helped = Number(snap?.impactHelped) || 0;
  const reputation = Number(snap?.reputation) || 0;
  const progress = rankProgress(xp);
  /* The one rung this screen draws — the next Title, matched back to the ladder
     by the XP it sits at. `progress.next` is null for a Steward, and so is this. */
  const nextRung = progress.next ? RANK_LADDER.find((r) => r.xp === progress.next.at) || null : null;
  const nextReward = nextRung ? rankReward(nextRung.rank) : null;
  const rungOpen = Boolean(nextRung) && openRank === nextRung.rank;

  return (
    <div className="profileJourney">
      <div className="label eyebrow">Your journey</div>
      <TitleProgress
        xp={xp}
        lastQuestDay={snap ? snap.lastQuestDay || null : undefined}
        blurb={JOURNEY_COPY[progress.rank]}
        hero
      />

      {/* Three numbers, and only three. `helped` is what the server says this
          Profile has done for strangers; Contributions is the domain's own
          count of facts filed (worldProgress.meters.contributions), not the
          length of scoredKeys, which is a scoring ledger and drifts from it.
          Reputation hides at zero — a bare "0 reputation" reads as a demerit
          on a screen whose whole job is to be encouraging. */}
      <div className="meStats" data-journey-stats>
        <span className="meStat">
          <b>{helped}</b>
          <span>guest{helped === 1 ? '' : 's'} helped</span>
        </span>
        <span className="meStat">
          <b>{Number(contributions) || 0}</b>
          <span>Contributions</span>
        </span>
        {reputation > 0 ? (
          <span className="meStat">
            <b>{reputation}</b>
            <span>reputation</span>
          </span>
        ) : null}
      </div>

      {/* One rung, and only one: the design's NEXT TITLE. The five-rung list
          this replaced spent most of its height on rungs with no answer to
          "how much further" — the earned ones are a record, the far ones a
          horizon — while the rung actually being walked toward was the fourth
          thing on the screen. Nothing is lost by showing one: RankPrizeCatalog
          on this same screen carries the whole ladder and what each rung
          grants, which is where a Steward looking for the far end goes.

          `next` is null at the top of the ladder, and a Steward has no next
          title to draw, so the block drops out rather than rendering an
          empty card. */}
      {nextRung ? (
        <>
          <div className="label eyebrow">Next Title</div>
          <ol className="rowList journeyLadder" aria-label="Next Title">
            <li className="journeyStep next">
              <button
                type="button"
                className="row journeyStepRow"
                aria-expanded={rungOpen}
                onClick={() => setOpenRank(rungOpen ? null : nextRung.rank)}
              >
                <i className="titleLadderDot" aria-hidden="true" />
                <span className="rowText journeyStepText">
                  <b>{nextReward.label}</b>
                  <span>{JOURNEY_COPY[nextRung.rank]}</span>
                </span>
                <span className="rowValue journeyStepAt">{nextRung.xp} XP</span>
              </button>
              {rungOpen ? (
                <div className="journeyStepDetail">
                  <div className="journeyStepUnlock">
                    <b>{nextReward.unlock}</b>
                    <span>{progress.next.toGo} XP to go</span>
                  </div>
                  <p className="fine">
                    At {nextRung.xp} XP the Title {nextReward.label} sits under your name for the
                    Party. The full list of what each rung grants is below.
                  </p>
                  <div className="journeyAwards">
                    {AWARD_LINES.map(([label, amount]) => (
                      <span key={label} className="journeyAward">
                        {label} <b>{amount} XP</b>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </li>
          </ol>
        </>
      ) : null}
    </div>
  );
}
