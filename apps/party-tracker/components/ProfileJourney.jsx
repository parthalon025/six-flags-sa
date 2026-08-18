'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import TitleProgress from '@/components/TitleProgress';
import { patchProfileCache, readProfileCache, sharesName } from '@/lib/auth/profileCache';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';
import { RANK_LADDER, rankProgress, rankReward } from '@party-tracker/shared/questScore.js';

/**
 * The Me tab's journey card — the contemplation view of the XP → Title loop.
 *
 * Hero (Title, bar, walk to next) always visible; the Title ladder, field
 * stats, and the finder-credit preference expand below it. Reads the offline
 * Profile cache; a throttled server refresh updates only the server-owned
 * stats (impactHelped, reputation) so the XP bar never rolls backwards.
 */

/** What each Title means for the guest — warm, and only about what exists. */
const JOURNEY_COPY = {
  visitor: 'Your Profile keeps every XP.',
  scout: 'The Title under your name.',
  ranger: 'A Title other guests notice.',
  cartographer: 'The mapmaker’s Title.',
  steward: 'Top of the ladder — thank you.',
};

/** Server-owned stats re-fetch, at most once a minute across mounts. */
let lastStatsSyncAt = 0;

export default function ProfileJourney({ session = null }) {
  const [snap, setSnap] = useState(null);
  const [open, setOpen] = useState(false);

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
  const settled = Array.isArray(snap?.scoredKeys) ? snap.scoredKeys.length : 0;
  const helped = Number(snap?.impactHelped) || 0;
  const reputation = Number(snap?.reputation) || 0;
  const shareName = sharesName(snap);
  const progress = rankProgress(xp);

  async function toggleShareName() {
    const next = !shareName;
    setSnap((s) => ({ ...(s || {}), shareName: next }));
    try {
      await patchProfileCache({ shareName: next });
    } catch {
      /* private mode — the in-memory choice still holds this session */
    }
  }

  return (
    <div className="profileJourney">
      <div className="label">Your journey</div>
      <TitleProgress xp={xp} lastQuestDay={snap ? snap.lastQuestDay || null : undefined} />
      <button
        type="button"
        className="row journeyToggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rowText">The Title ladder and your field stats</span>
        <span className="rowValue">
          <Icon name={open ? 'chevron.up' : 'chevron.right'} size={14} />
        </span>
      </button>
      {open ? (
        <div className="journeyDetail">
          <div className="journeyStats" data-journey-stats>
            <span className="journeyStat">
              <b>{helped}</b> guest{helped === 1 ? '' : 's'} helped
            </span>
            <span className="journeyStat">
              <b>{settled}</b> fact{settled === 1 ? '' : 's'} settled
            </span>
            {reputation > 0 ? (
              <span className="journeyStat">
                <b>{reputation}</b> reputation
              </span>
            ) : null}
          </div>
          <ol className="journeyLadder" aria-label="Title ladder">
            {RANK_LADDER.map((row) => {
              const reward = rankReward(row.rank);
              const earned = xp >= row.xp;
              const current = progress.rank === row.rank;
              return (
                <li
                  key={row.rank}
                  className={`journeyStep ${earned ? 'earned' : ''} ${current ? 'current' : ''}`}
                >
                  <i className="titleLadderDot" aria-hidden="true" />
                  <span className="journeyStepText">
                    <b>{reward.label}</b>
                    <span>{JOURNEY_COPY[row.rank]}</span>
                  </span>
                  <span className="journeyStepAt">{earned ? '✓' : `${row.xp} XP`}</span>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="row journeyShare"
            role="switch"
            aria-checked={shareName}
            onClick={toggleShareName}
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
      ) : null}
    </div>
  );
}
