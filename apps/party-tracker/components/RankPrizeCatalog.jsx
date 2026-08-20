'use client';

import { rankPrizeCatalog } from '@party-tracker/shared/rankPrizes.js';

/**
 * Rank ladder with its prizes — what leveling grants beyond XP.
 */
export default function RankPrizeCatalog({ xp = 0 }) {
  const rows = rankPrizeCatalog();
  return (
    <div className="rankPrizeCatalog">
      <div className="label">Rank prizes</div>
      <p className="fine">
        XP never spends. Each threshold grants a Title and exclusive cosmetics on your Profile.
      </p>
      <ul className="rankPrizeList">
        {rows.map((row) => {
          const earned = xp >= row.xp;
          return (
            <li key={row.rank} className={`rankPrizeRow ${earned ? 'earned' : ''}`}>
              <div className="rankPrizeHead">
                <b>{row.title || 'Visitor'}</b>
                <span className="rankPrizeXp">{row.xp} XP</span>
              </div>
              <ul className="rankPrizeItems">
                {row.prizes.map((p) => (
                  <li key={`${row.rank}:${p.label}`}>
                    <span className="rankPrizeKind">{p.kind === 'kit' ? 'Kit' : p.kind === 'skin' ? 'Skin' : '—'}</span>
                    <span>{p.label}</span>
                    {p.blurb ? <i className="fine">{p.blurb}</i> : null}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
