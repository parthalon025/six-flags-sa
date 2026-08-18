'use client';

import Icon from '@/components/Icon';
import {
  RANK_LADDER,
  XP_AWARDS,
  rankProgress,
  rankReward,
  utcDay,
} from '@party-tracker/shared/questScore.js';

/**
 * The Profile's walk up the Title ladder — the game-feel surface for XP.
 *
 * Lives on Profile surfaces (Side Quests header, sign-in card), never on the
 * quest cards themselves: cards stay meaning-first, the reward reads here.
 * Titles are sub-names (Scout → Steward), not levels, and XP is never spent.
 */
export default function TitleProgress({ xp = 0, lastQuestDay, compact = false }) {
  const p = rankProgress(xp);
  const dailyReady = lastQuestDay !== undefined && lastQuestDay !== utcDay();
  return (
    <div
      className={`titleProgress ${compact ? 'compact' : ''}`}
      data-xp={p.xp}
      data-rank={p.rank}
    >
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
      {compact ? null : (
        <ol className="titleLadder" aria-label="Title ladder">
          {RANK_LADDER.map((row) => {
            const reward = rankReward(row.rank);
            const earned = p.xp >= row.xp;
            const current = p.rank === row.rank;
            return (
              <li
                key={row.rank}
                className={`titleLadderStep ${earned ? 'earned' : ''} ${current ? 'current' : ''}`}
              >
                <i className="titleLadderDot" aria-hidden="true" />
                <span className="titleLadderName">{reward.label}</span>
                {earned ? null : <span className="titleLadderAt">{row.xp}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
