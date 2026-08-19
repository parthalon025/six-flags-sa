'use client';

import Icon from '@/components/Icon';
import { XP_AWARDS, rankProgress, utcDay } from '@party-tracker/shared/questScore.js';

/**
 * The Profile's walk to the next Title — the game-feel bar for XP.
 *
 * Lives on Profile surfaces (Side Quests header, the Me journey card), never
 * on the quest cards themselves: cards stay meaning-first, the reward reads
 * here. Titles are sub-names (Scout → Steward), not levels, and XP is never
 * spent. The full Title ladder lives on Me (ProfileJourney).
 */
export default function TitleProgress({ xp = 0, lastQuestDay }) {
  const p = rankProgress(xp);
  const dailyReady = lastQuestDay !== undefined && lastQuestDay !== utcDay();
  return (
    <div className="titleProgress" data-xp={p.xp}>
      <div className="titleProgressHead">
        <b className="titleProgressLabel">{p.title || 'Visitor'}</b>
        <span className="titleProgressXp">{p.xp} XP</span>
      </div>
      <div
        className="titleProgressBar"
        role="progressbar"
        aria-valuemin={p.floor}
        aria-valuemax={p.next ? p.next.at : p.xp}
        aria-valuenow={p.xp}
        aria-label={p.next ? `Progress to ${p.next.label}` : 'Top of the Title ladder'}
      >
        <i className="titleProgressFill" style={{ width: `${Math.round(p.fraction * 100)}%` }} />
      </div>
      <div className="titleProgressFoot">
        {p.next ? (
          <span className="titleProgressNext">
            {p.next.toGo} XP to <b>{p.next.label}</b>
          </span>
        ) : (
          <span className="titleProgressNext">Top of the ladder — thank you.</span>
        )}
        {dailyReady ? (
          <span className="titleProgressDaily">
            <Icon name="sparkles" size={13} /> First report today +{XP_AWARDS.firstHelpfulDay}
          </span>
        ) : null}
      </div>
    </div>
  );
}
