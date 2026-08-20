'use client';

import Icon from '@/components/Icon';
import { WORDS } from '@/lib/brand';
import { formatDistance } from '@/lib/geo';

/**
 * The card that answers a tap on a Place.
 *
 * A pin is the smallest thing on this screen and the hardest to read: it is a
 * coloured dot with a name under it, and the two questions a person has about
 * it — how far, and is it worth walking to — are both answered somewhere else.
 * This is that somewhere else, put where the pin is rather than in the sheet:
 * the name, the range, whether it is running, and the walk.
 *
 * Sibling to {@link SpotCapsule}, and deliberately the same shape of thing —
 * it rides `--sheetFoot` so it moves with the sheet drag, it takes the same
 * lens and the same z-index, and the FAB column steps aside for it through the
 * same `.app[data-spot]` rule. The two are mutually exclusive by construction:
 * a selected Place clears the spot in page.js, because a Place answers the
 * question the spot capsule was asking and answers it better.
 *
 * A pill rather than the spot capsule's card because there is less to say: one
 * line, read at a glance, over a map you are still looking at. The body pushes
 * the Place view for the rest of it.
 */
export default function SelectionCapsule({
  poi,
  dot,
  status = null,
  metres = null,
  onOpen = null,
  onNavigate = null,
  onClose = null,
}) {
  if (!poi) return null;

  /* The same status classes the list row and the Place head build, from the
     same `liveFor` result — the repo's set is a superset of the twin's three,
     and a capsule that invented a fourth colour for the same fact would be a
     third opinion about one ride. */
  const live = status?.label
    ? [
        'liveBadge',
        'statusPill',
        status.live === 'goNow' || status.key === 'goNow' ? 'goNow' : '',
        status.live === 'busy' || status.key === 'busy' ? 'busy' : '',
        status.live === 'later' || status.key === 'later' || status.key === 'watch' ? 'later' : '',
        status.live === 'open' || status.key === 'open' ? 'open' : '',
        status.live === 'paused' ||
        status.key === 'down' ||
        status.key === 'hold' ||
        status.key === 'paused'
          ? 'paused'
          : '',
        status.live === 'weather' || status.key === 'closed' ? 'weather' : '',
        status.source === 'weather' ? 'guess' : '',
        status.stale ? 'stale' : '',
      ]
        .filter(Boolean)
        .join(' ')
    : null;

  return (
    <div className="selCapsule" role="group" aria-label={poi.n}>
      <button type="button" className="selBody" onClick={() => onOpen?.(poi)}>
        <span className="selDot" style={{ background: dot }} aria-hidden="true" />
        <b className="selName">{poi.n}</b>
        {/* Dropped rather than filled with an em dash when there is no fix:
            the range is the one thing here the app cannot guess at. */}
        {metres != null && <em className="selDist">{formatDistance(metres)}</em>}
        {live && (
          <span className={live} title={status.detail || undefined}>
            <i aria-hidden="true">{status.source === 'party' ? '●' : '☁'}</i>
            {status.label}
          </span>
        )}
      </button>
      <button
        type="button"
        className="btn small primary selWalk"
        onClick={() => onNavigate?.(poi)}
        /* "Walk" is short enough to fit the pill and too short to say what it
           does to a screen reader, so the full word for it comes from the same
           place every other navigate control takes it. */
        aria-label={WORDS.navigation}
      >
        Walk
      </button>
      <button type="button" className="selClose" onClick={() => onClose?.()} aria-label="Close">
        <Icon name="xmark.circle.fill" size={20} />
      </button>
    </div>
  );
}
