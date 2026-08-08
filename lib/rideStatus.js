/**
 * One verdict per ride, from two sources that disagree in different ways.
 *
 * The party knows what it has walked past; the forecast knows what the sky is
 * about to do. Neither is authoritative and they fail in opposite directions —
 * a report is precise but ages badly, a forecast never ages but is only ever a
 * guess about a whole park at once.
 *
 * The rule that falls out of that: **a report always beats a forecast, until it
 * is old enough to be worth less than one.** Everything below is that sentence
 * with the edges filled in.
 *
 * Pure, like weather.js — no React, no clock of its own, no park knowledge.
 */

import { RIDE_DOWN, RIDE_OPEN, RIDE_STALE_AFTER_MS } from './core/state.js';
import { formatAge } from './geo.js';
import { OUTLOOK, outlookFor } from './weather.js';

/** What the row actually says. `tone` maps to the existing ok/warn/bad palette. */
export const STATUS = {
  down: { key: 'down', tone: 'bad', label: 'Reported down' },
  closed: { key: 'closed', tone: 'bad', label: 'Likely closed' },
  hold: { key: 'hold', tone: 'warn', label: 'Likely on hold' },
  watch: { key: 'watch', tone: 'warn', label: 'Watch the sky' },
  open: { key: 'open', tone: 'ok', label: 'Reported running' },
  running: { key: 'running', tone: '', label: '' },
};

/** OUTLOOK keys and STATUS keys line up by name for everything but `running`. */
const FROM_OUTLOOK = {
  [OUTLOOK.closed.key]: STATUS.closed,
  [OUTLOOK.hold.key]: STATUS.hold,
  [OUTLOOK.watch.key]: STATUS.watch,
  [OUTLOOK.running.key]: STATUS.running,
};

const minutesSince = (ts, now) => Math.max(0, Math.round((now - ts) / 60000));

/**
 * @param poi     a POI record
 * @param report  the party's record for it, or null — { status, byName, ts }
 * @param weather the result of classifyWeather, or null when offline
 * @param now     ms epoch
 *
 * @returns {{
 *   key, tone, label,
 *   source: 'party'|'weather'|'none',
 *   detail: string|null,   // one line of why, ready to render
 *   stale: boolean,        // the report is old enough to hedge
 *   outlook,               // the forecast's opinion, kept even when overridden
 *   report                 // the party's, likewise
 * }}
 */
export function statusFor(poi, report, weather, now = Date.now()) {
  const outlook = outlookFor(poi, weather);
  const fromWeather = FROM_OUTLOOK[outlook.key] || STATUS.running;

  const usable = report && (report.status === RIDE_DOWN || report.status === RIDE_OPEN);
  const stale = usable ? now - report.ts > RIDE_STALE_AFTER_MS : false;

  if (usable && !stale) {
    const who = report.byName || 'Someone';
    const mins = minutesSince(report.ts, now);
    const when = formatAge(now - report.ts);
    const base = report.status === RIDE_DOWN ? STATUS.down : STATUS.open;
    return {
      ...base,
      source: 'party',
      detail: `${who}, ${when}${report.note ? ` — ${report.note}` : ''}`,
      stale: false,
      outlook,
      report,
    };
  }

  // A stale report and a forecast: keep whichever is worse news. A ride somebody
  // saw shut an hour ago is not evidence it is running now, so a stale `down`
  // still counts against a clear sky — but if the weather has since turned, the
  // forecast is the fresher fact and takes the headline.
  if (usable && stale) {
    const staleIsWorse =
      (report.status === RIDE_DOWN ? STATUS.down : STATUS.open).tone === 'bad' &&
      fromWeather.tone !== 'bad';
    const who = report.byName || 'Someone';
    const when = formatAge(now - report.ts);

    if (staleIsWorse) {
      return {
        ...STATUS.down,
        label: 'Was down',
        source: 'party',
        detail: `${who}, ${when} — nobody has confirmed since`,
        stale: true,
        outlook,
        report,
      };
    }
    return {
      ...fromWeather,
      source: fromWeather.key === STATUS.running.key ? 'none' : 'weather',
      detail: outlook.why,
      stale: true,
      outlook,
      report,
    };
  }

  return {
    ...fromWeather,
    source: fromWeather.key === STATUS.running.key ? 'none' : 'weather',
    detail: outlook.why,
    stale: false,
    outlook,
    report: null,
  };
}

/**
 * The park-wide count the banner needs: how many rides are reported down, and
 * how many the sky has put in doubt. Reports and forecasts are counted
 * separately on purpose — "3 reported down" and "18 at risk" are different
 * claims and merging them into one number would overstate both.
 */
export function statusSummary(pois, rides, weather, now = Date.now()) {
  let reportedDown = 0;
  let atRisk = 0;

  for (const poi of pois || []) {
    if (poi.c !== 'coaster' && poi.c !== 'ride') continue;
    const s = statusFor(poi, rides?.[poi.id] ?? null, weather, now);
    if (s.key === STATUS.down.key) reportedDown += 1;
    else if (s.tone === 'bad' || s.tone === 'warn') atRisk += 1;
  }

  return { reportedDown, atRisk };
}
