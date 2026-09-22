'use client';

import './go-now-sequences.css';
import { useMemo } from 'react';
import { compareGoNowSequences } from '@/lib/live';
import { usePois } from '@/lib/venue/useVenue';
import { formatWalk } from '@/lib/geo';

/**
 * Side-by-side short GO NOW sequences for the Explore sheet (E8.3).
 */
export default function GoNowSequences({
  me,
  weather,
  rides,
  members,
  now,
  eligibility,
}) {
  const pois = usePois();
  const sequences = useMemo(
    () =>
      compareGoNowSequences(pois, rides, weather, me, members, now, {
        eligibility,
      }),
    [pois, rides, weather, me, members, now, eligibility],
  );

  if (!me || sequences.length < 2) return null;

  return (
    <section className="goNowSequences" aria-label="Compare short routes">
      <div className="label eyebrow">Compare routes</div>
      <div className="rowList">
        {sequences.map((seq) => (
          <div key={seq.strategy} className="row goNowSequenceCard">
            <span className="rowText">
              {seq.stops.map((s) => s.poi.n).join(' → ')}
            </span>
            <span className="rowValue goNowSequenceMeta">
              {formatWalk(seq.totalWalkM)}
            </span>
            <p className="fine goNowSequenceWhy">{seq.tradeoff}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
