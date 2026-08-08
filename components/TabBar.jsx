'use client';

import Icon from '@/components/Icon';

/**
 * The bottom tab bar — the app's top-level navigation, and the one piece of
 * chrome that never moves.
 *
 * It lives at the foot of the sheet rather than as a separate strip under it,
 * because the sheet is already anchored to the bottom edge: two stacked bottom
 * chromes would eat the map twice over. Sitting inside the sheet it still reads
 * as a fixed tab bar — it stays put at every stop the sheet takes, and it goes
 * away with the sheet when a walk takes the screen over, which is exactly when
 * a tab bar would be in the way.
 *
 * Four destinations at most, which is where Apple's own guidance lands: past
 * that the labels stop fitting and the targets drop under the 44pt floor.
 * Each tab keeps its own navigation stack, so coming back to one comes back to
 * where you left it, and tapping the tab you are already on pops that stack to
 * its root.
 */
export default function TabBar({ tabs, active, onSelect }) {
  return (
    <nav className="tabBar" role="tablist" aria-label="Sections">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            className={`tabItem ${on ? 'on' : ''}`}
            aria-selected={on}
            aria-label={t.badge ? `${t.label}, ${t.badgeLabel || t.badge}` : t.label}
            onClick={() => onSelect(t.id)}
          >
            <span className="tabGlyph">
              {t.initials ? (
                <span className="tabAvatar">{t.initials}</span>
              ) : (
                <Icon name={t.icon} size={26} />
              )}
              {t.badge != null && (
                <span className={`tabBadge ${t.alert ? 'alert' : ''}`} aria-hidden="true">
                  {t.badge}
                </span>
              )}
            </span>
            <span className="tabLabel">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
