'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import SignInCard from '@/components/SignInCard';
import TitleProgress from '@/components/TitleProgress';
import { awardQuestXp, readLocalSession, softGateBlocks } from '@/lib/auth/session';
import { contributionStashCount, stashGapSubmission } from '@/lib/auth/contributionStash';
import { readProfileCache, sharesName } from '@/lib/auth/profileCache';
import {
  ADD_PLACE_TYPES,
  CAMPING_HOOKUPS,
  HEIGHT_INCH_CHIPS,
  NEARBY_RADIUS_M,
  buildSideQuests,
  isGapQuest,
  isLiveQuest,
  isOnWalkway,
  nearestTargetDistance,
  rideReportFromLiveQuest,
  sortByProximity,
} from '@/lib/sideQuests';
import { findPlace, titleOf } from '@/lib/venue/ids';
import { withinBounds } from '@/lib/venue/store';
import { createReport, defaultQuestQueue } from '@/lib/adventure/questQueue';
import { pathScoreCell, scoreKey, titleFromXp } from '@party-tracker/shared/questScore.js';
import { rankUpRewardLine } from '@party-tracker/shared/rankPrizes.js';
import { completionLine, contributionFromGapSubmit } from '@/lib/overlay';

/**
 * Side Quests tab — missions for facts only guests on the ground can settle.
 *
 * Soft-gate (EP.3): browse the list anonymously. Gap Side Quest submit needs
 * sign-in. Live Ride reports (walk near and mark it) are name-first.
 * Closed chips are the fact; the optional note is not. XP lands on the Profile;
 * Rank-up is the reward — cards stay meaning-first.
 */

const STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Looks right' },
  { value: 'changed', label: 'Changed' },
  { value: 'issue', label: 'Problem here' },
];

/**
 * The moment after a submit. Meaning leads; the XP earned rides along.
 * Rank-up is the celebration — the Title is the reward, not a number.
 */
function RewardToast({ reward }) {
  if (reward.kind === 'rankUp') {
    return (
      <div className="xpToast rankUp" role="status" data-reward="rankUp">
        <span className="xpToastGlyph" aria-hidden="true">
          <Icon name="sparkles" size={22} />
        </span>
        <span className="rowText">
          <b>You&apos;re a {reward.title} now.</b>
          <span>The Title sits under your name — other guests see who kept this map honest.</span>
        </span>
        <span className="xpToastDelta">+{reward.deltaXp} XP</span>
      </div>
    );
  }
  if (reward.kind === 'xp') {
    return (
      <div className="xpToast" role="status" data-reward="xp">
        <span className="xpToastGlyph" aria-hidden="true">
          <Icon name="checkmark" size={18} />
        </span>
        <span className="rowText">
          <b>Logged — other guests benefit.</b>
          {reward.dailyBonus ? <span>First helpful report today, bonus included.</span> : null}
        </span>
        <span className="xpToastDelta">+{reward.deltaXp} XP</span>
      </div>
    );
  }
  const line =
    reward.kind === 'stashed'
      ? 'Saved on this phone. Sign in to upload.'
      : reward.kind === 'repeat'
        ? 'You already settled this one — it still helps, no new XP.'
        : 'Report sent. XP needs you near enough to have seen it.';
  return (
    <p className="fine block sideQuestReward" role="status" data-reward={reward.kind}>
      {line}
    </p>
  );
}

function inVenue(bounds, position) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return false;
  if (!bounds) return true;
  return withinBounds(bounds, position.lat, position.lng);
}

export default function SideQuestsPanel({
  venueName = null,
  venueId = null,
  pois = [],
  gaps = [],
  map = null,
  bounds = null,
  position = null,
  onSelectPlace = null,
  session = null,
  onSession = null,
  onRideReport = null,
  onWorldProgress = null,
  onContribution = null,
  overlay = null,
  flushTick = 0,
  /** The patch of ground this screen was opened from — `lib/spot.js`, set by
   *  tapping "Side Quest here" on the map's spot capsule, null when the visitor
   *  arrived by the tab bar. Nothing below reads it yet: the anchored banner
   *  above the quest cards is the Side Quests pass's work. Declared here so the
   *  wire from the map exists and stays one prop. */
  spot = null,
  onClearSpot = null,
}) {
  const queue = defaultQuestQueue();
  const gapNeedsAuth = softGateBlocks('adventure', session);
  const questBlocked = (quest) => (isLiveQuest(quest) ? false : gapNeedsAuth);
  const [scoredKeys, setScoredKeys] = useState([]);
  // The reward moment after a submit: XP earned, daily bonus, rank-up. The
  // quest cards themselves never advertise XP — the reward reads after the fact.
  const [reward, setReward] = useState(null);
  const [progressSnap, setProgressSnap] = useState(null);

  useEffect(() => {
    let alive = true;
    readProfileCache().then((snap) => {
      if (!alive) return;
      if (Array.isArray(snap?.scoredKeys)) setScoredKeys(snap.scoredKeys);
      if (snap?.userId) {
        setProgressSnap({
          xp: Number(snap.xp) || 0,
          lastQuestDay: snap.lastQuestDay || null,
          shareName: sharesName(snap),
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [session?.userId]);

  useEffect(() => {
    if (!reward) return undefined;
    const t = setTimeout(() => setReward(null), reward.rankUp ? 12000 : 7000);
    return () => clearTimeout(t);
  }, [reward]);

  const { durable: rawDurable, ambient, counts } = buildSideQuests({
    pois,
    gaps,
    venueName: venueName || 'this park',
    venueId: venueId || '',
    scoredKeys,
  });
  const inside = inVenue(bounds, position);
  const offPath = inside && !isOnWalkway(map, position);
  const withLocationHints = rawDurable.map((q) => {
    if (q.rankLast && inside) return { ...q, nearby: true };
    if (q.type === 'path' && offPath) return { ...q, nearby: true };
    return q;
  });
  const durable = position ? sortByProximity(withLocationHints, pois, position) : withLocationHints;

  const [openQuestId, setOpenQuestId] = useState(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState(STATUS_OPTIONS[0].value);
  const [heightIn, setHeightIn] = useState(null);
  const [atLine, setAtLine] = useState(false);
  const [atWalkway, setAtWalkway] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [hookup, setHookup] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [pending, setPending] = useState(0);
  const [lastSubmittedId, setLastSubmittedId] = useState(null);
  const [stashed, setStashed] = useState(0);

  useEffect(() => {
    setStashed(contributionStashCount());
  }, [session?.userId, lastSubmittedId]);

  useEffect(() => {
    let alive = true;
    queue.pendingCount().then((n) => {
      if (alive) setPending(n);
    });
    return () => {
      alive = false;
    };
    // flushTick: bumped by app/page.js after a background sync removes
    // reports from this same queue — re-reads the count so "N pending"
    // reflects what actually reached the server.
  }, [queue, lastSubmittedId, flushTick]);

  function resetForm() {
    setNote('');
    setStatus(STATUS_OPTIONS[0].value);
    setHeightIn(null);
    setAtLine(false);
    setAtWalkway(false);
    setPlaceName('');
    setHookup(null);
    setSelectedTarget(null);
  }

  function toggleQuest(quest) {
    if (openQuestId === quest.id) {
      setOpenQuestId(null);
      return;
    }
    setOpenQuestId(quest.id);
    resetForm();
    const nearTarget = (quest.targets || []).find((t) => {
      const d = nearestTargetDistance({ targets: [t] }, pois, position);
      return d != null && d <= NEARBY_RADIUS_M;
    });
    setSelectedTarget(nearTarget || (quest.targets?.length === 1 ? quest.targets[0] : null));
  }

  function factReady(quest) {
    if (isLiveQuest(quest)) return Boolean(status);
    if (quest.type === 'height') return Number.isFinite(heightIn) && selectedTarget;
    if (quest.type === 'queue') return atLine && (selectedTarget || !quest.targets?.length);
    if (quest.type === 'path') return atWalkway;
    if (ADD_PLACE_TYPES.includes(quest.type)) return Boolean(placeName.trim());
    if (quest.type === 'camping') return Boolean(hookup);
    return false;
  }

  function walkedNearFor(quest) {
    if (quest.type === 'camping' || ADD_PLACE_TYPES.includes(quest.type)) return inside;
    if (quest.type === 'path') {
      if (!inside || isOnWalkway(map, position)) return false;
      if (selectedTarget) {
        const d = nearestTargetDistance({ targets: [selectedTarget] }, pois, position);
        return d != null && d <= NEARBY_RADIUS_M;
      }
      return true;
    }
    if (isLiveQuest(quest)) {
      const d = nearestTargetDistance(
        { targets: quest.targets?.length ? quest.targets : pois.filter((p) => p.c === 'coaster' || p.c === 'ride').map((p) => p.i) },
        pois,
        position,
      );
      return d != null && d <= NEARBY_RADIUS_M;
    }
    if (selectedTarget) {
      const d = nearestTargetDistance({ targets: [selectedTarget] }, pois, position);
      return d != null && d <= NEARBY_RADIUS_M;
    }
    return Boolean(quest.nearby);
  }

  function payloadFor(quest) {
    if (isLiveQuest(quest)) return { note: note.trim(), status };
    if (quest.type === 'height') return { heightIn, target: selectedTarget, note: note.trim() || undefined };
    if (quest.type === 'queue') return { atLine: true, target: selectedTarget, note: note.trim() || undefined };
    if (quest.type === 'path') return { atWalkway: true, target: selectedTarget, note: note.trim() || undefined };
    if (ADD_PLACE_TYPES.includes(quest.type)) {
      return { name: placeName.trim(), category: quest.type, note: note.trim() || undefined };
    }
    if (quest.type === 'camping') return { hookup, note: note.trim() || undefined };
    return { note: note.trim() };
  }

  async function submit(quest) {
    if (!factReady(quest)) return;
    const kind = quest.type || quest.id;
    const target = selectedTarget || (ADD_PLACE_TYPES.includes(quest.type) || quest.type === 'camping' ? null : quest.targets?.[0] || null);
    const scoreTarget = quest.type === 'path' && !target
      ? pathScoreCell(position?.lat, position?.lng)
      : target;
    const key = scoreKey(venueId, quest.type, scoreTarget);

    if (!isLiveQuest(quest) && gapNeedsAuth) {
      const ok = stashGapSubmission({
        questId: quest.id,
        venueId,
        placeId: target,
        kind,
        payload: payloadFor(quest),
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        scoreKey: key,
        walkedNear: walkedNearFor(quest),
        action: 'first',
      });
      if (ok) {
        setStashed(contributionStashCount());
        setReward({ kind: 'stashed' });
      }
      setOpenQuestId(null);
      setLastSubmittedId(`stash-${Date.now()}`);
      return;
    }

    const report = createReport({
      questId: quest.id,
      venueId,
      placeId: target,
      kind,
      payload: payloadFor(quest),
      lat: position?.lat ?? null,
      lng: position?.lng ?? null,
    });
    await queue.enqueue(report);
    if (!isLiveQuest(quest) && onContribution) {
      // First-to-find credit rides on the Contribution unless the Profile
      // opted out on Me — then the find reads as "a fellow guest". The Title
      // badge is first-find only: re-answering a fact this Profile already
      // settled keeps the name (provenance) but is not a find.
      const named = progressSnap ? progressSnap.shareName : true;
      const firstFind = !(key && scoredKeys.includes(key));
      const contrib = contributionFromGapSubmit({
        id: report.id,
        type: quest.type,
        placeId: target,
        venueId,
        authorId: session?.userId || null,
        authorName: named ? session?.displayName || 'Someone' : 'a fellow guest',
        authorTitle:
          named && firstFind
            ? titleFromXp(Number(progressSnap?.xp ?? session?.xp) || 0)
            : null,
        payload: report.payload,
        lat: report.lat,
        lng: report.lng,
        now: report.createdAt,
      });
      if (contrib) onContribution(contrib);
    }
    const live = rideReportFromLiveQuest(quest, { status, pois, position });
    if (live && onRideReport) onRideReport(live.rideId, live.status);
    const action = isLiveQuest(quest) ? 'live' : 'first';
    const scoredKey = isLiveQuest(quest)
      ? scoreKey(venueId, kind, live?.rideId || target)
      : key;
    const scored = await awardQuestXp({
      action,
      key: scoredKey,
      walkedNear: walkedNearFor(quest),
      now: Date.now(),
    });
    setScoredKeys(scored.profile.scoredKeys || []);
    if (scored.deltaXp > 0) {
      setProgressSnap((prev) => ({
        xp: scored.profile.xp,
        lastQuestDay: scored.profile.lastQuestDay,
        shareName: prev ? prev.shareName : true,
      }));
    }
    if (scored.rankUp) {
      const title = rankUpRewardLine(scored.profile.rank);
      if (title) setReward({ kind: 'rankUp', rankUp: true, title, deltaXp: scored.deltaXp });
    } else if (scored.deltaXp > 0) {
      setReward({ kind: 'xp', deltaXp: scored.deltaXp, dailyBonus: scored.dailyBonus });
    } else if (scored.reason === 'repeat') {
      setReward({ kind: 'repeat' });
    } else if (scored.reason === 'not_near') {
      setReward({ kind: 'notNear' });
    }
    const nextSession = readLocalSession();
    if (nextSession) onSession?.(nextSession);
    onWorldProgress?.({ quest, report, rankUp: scored.rankUp ? scored.profile.rank : null });
    setOpenQuestId(null);
    setLastSubmittedId(report.id);
  }

  function renderForm(quest) {
    if (isLiveQuest(quest)) {
      return (
        <div className="chips">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`chip ${status === opt.value ? 'on' : ''}`}
              aria-pressed={status === opt.value}
              onClick={() => setStatus(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    }
    if (quest.type === 'height') {
      return (
        <div className="chips wrap">
          {HEIGHT_INCH_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              className={`chip ${heightIn === n ? 'on' : ''}`}
              aria-pressed={heightIn === n}
              onClick={() => setHeightIn(n)}
            >
              {n}&quot;
            </button>
          ))}
          <button
            type="button"
            className={`chip ${heightIn === 0 ? 'on' : ''}`}
            aria-pressed={heightIn === 0}
            onClick={() => setHeightIn(0)}
          >
            No min
          </button>
        </div>
      );
    }
    if (quest.type === 'queue') {
      return (
        <div className="chips">
          <button
            type="button"
            className={`chip ${atLine ? 'on' : ''}`}
            aria-pressed={atLine}
            onClick={() => setAtLine(true)}
          >
            I&apos;m at the line
          </button>
        </div>
      );
    }
    if (quest.type === 'path') {
      return (
        <div className="chips">
          <button
            type="button"
            className={`chip ${atWalkway ? 'on' : ''}`}
            aria-pressed={atWalkway}
            onClick={() => setAtWalkway(true)}
          >
            I&apos;m on a walkway
          </button>
        </div>
      );
    }
    if (ADD_PLACE_TYPES.includes(quest.type)) {
      return (
        <input
          className="field"
          maxLength={48}
          placeholder="Name on the sign"
          aria-label="Place name"
          value={placeName}
          onChange={(e) => setPlaceName(e.target.value)}
        />
      );
    }
    if (quest.type === 'camping') {
      return (
        <div className="chips wrap">
          {CAMPING_HOOKUPS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`chip ${hookup === opt.value ? 'on' : ''}`}
              aria-pressed={hookup === opt.value}
              onClick={() => setHookup(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    }
    return null;
  }

  const renderQuest = (q) => {
    const open = openQuestId === q.id;
    const blocked = questBlocked(q);
    let action;
    if (position) {
      action = (
        <button
          type="button"
          className="sideQuestReportBtn"
          aria-expanded={open}
          onClick={() => toggleQuest(q)}
        >
          {open ? 'Cancel' : 'Report'}
        </button>
      );
    } else {
      action = <span className="rowValue">Soon</span>;
    }
    const progress =
      isGapQuest(q) && q.progress?.total > 1
        ? ` · ${q.progress.done}/${q.progress.total}`
        : '';
    return (
      <div key={q.id} className="row sideQuestRow" role="listitem">
        <span className="sideQuestGlyph" aria-hidden="true">
          <Icon name={q.icon} size={20} />
        </span>
        <span className="rowText">
          <b className="sideQuestTitle">
            {q.title}
            {progress ? <span className="sideQuestProgress">{progress}</span> : null}
            {q.nearby && <span className="sideQuestNear"> · nearby</span>}
          </b>
          <span className="sideQuestBlurb">{q.blurb}</span>
          {q.targets?.length > 0 && (
            <span className="sideQuestTargets">
              {q.targets.slice(0, 4).map((target) => {
                const place = findPlace(pois, target);
                const label = titleOf(place) || target;
                const selected = selectedTarget === target && open;
                return (
                <button
                  key={target}
                  type="button"
                  className={`sideQuestChip ${selected ? 'on' : ''}`}
                  aria-pressed={open ? selected : undefined}
                  onClick={() => {
                    if (open) {
                      setSelectedTarget(target);
                      return;
                    }
                    if (place && onSelectPlace) onSelectPlace(place);
                  }}
                >
                  {label}
                </button>
                );
              })}
              {q.targets.length > 4 ? (
                <span className="fine">+{q.targets.length - 4} more</span>
              ) : null}
            </span>
          )}
          {open && !blocked && (
            <div className="sideQuestForm">
              {renderForm(q)}
              <textarea
                className="field sideQuestNote"
                rows={2}
                maxLength={280}
                placeholder="What did you see? (optional)"
                aria-label="Note for this report"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="btn small primary sideQuestSubmit"
                disabled={!factReady(q)}
                onClick={() => submit(q)}
              >
                <Icon name="checkmark" size={16} /> Submit
              </button>
            </div>
          )}
        </span>
        <span className="rowValue">{action}</span>
      </div>
    );
  };

  const myCompletions = (overlay?.completions || []).filter((c) =>
    session?.userId ? c.authorId === session.userId : true,
  );

  return (
    <div className="sideQuests">
      <div className="dayMoment">
        <Icon name="flag.fill" size={22} />
        <div>
          <b>Help other guests. Earn trust.</b>
          <span>
            Open data builds the base map. Side Quests fill what only someone on the ground can
            confirm — then others benefit.
          </span>
        </div>
      </div>

      {gapNeedsAuth ? (
        <>
          <SignInCard session={session} onSession={onSession} />
          {stashed > 0 ? (
            <p className="fine block">
              {stashed} answer{stashed === 1 ? '' : 's'} saved on this phone — sign in to upload.
            </p>
          ) : null}
        </>
      ) : (
        <TitleProgress
          xp={progressSnap ? progressSnap.xp : Number(session?.xp) || 0}
          lastQuestDay={progressSnap ? progressSnap.lastQuestDay : undefined}
        />
      )}
      {reward ? <RewardToast reward={reward} /> : null}

      <div className="label">
        For {venueName || 'this park'}
        {counts.durable ? ` · ${counts.durable} waiting` : ''}
        {pending > 0 ? ` · ${pending} pending` : ''}
      </div>

      {!position && (
        <p className="fine block">
          Turn on location to report from where you&apos;re standing. Cards below are still
          worth reading while you decide.
        </p>
      )}

      {durable.length === 0 ? (
        <p className="fine block">
          No durable gaps on this map right now. Live Side Quests below are always available while
          you walk.
        </p>
      ) : (
        <div className="rowList">{durable.map(renderQuest)}</div>
      )}

      <div className="label">While you walk</div>
      <div className="rowList">{ambient.map(renderQuest)}</div>

      {myCompletions.length > 0 && (
        <>
          <div className="label">Your completions</div>
          <div className="rowList" data-overlay-mine>
            {myCompletions
              .slice()
              .reverse()
              .slice(0, 8)
              .map((c) => (
                <div key={c.id} className="row" data-overlay-completion={c.id}>
                  <span className="rowText">{completionLine(c)}</span>
                </div>
              ))}
          </div>
        </>
      )}

      <p className="fine block">
        {gapNeedsAuth
          ? 'Sign in to submit a gap Side Quest. Live ride reports are name-first. Looking around the list never needs an account.'
          : 'Walk near, see it, mark it. Gap quests need a Profile to keep. Reports queue on this phone.'}
      </p>
    </div>
  );
}
