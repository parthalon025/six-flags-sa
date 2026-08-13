'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import SignInCard from '@/components/SignInCard';
import { awardQuestXp, readLocalSession, softGateBlocks } from '@/lib/auth/session';
import { readProfileCache } from '@/lib/auth/profileCache';
import {
  ADD_PLACE_TYPES,
  CAMPING_HOOKUPS,
  HEIGHT_INCH_CHIPS,
  NEARBY_RADIUS_M,
  buildSideQuests,
  isGapQuest,
  isLiveQuest,
  nearestTargetDistance,
  rideReportFromLiveQuest,
  sortByProximity,
} from '@/lib/sideQuests';
import { findPlace, titleOf } from '@/lib/venue/ids';
import { withinBounds } from '@/lib/venue/store';
import { createReport, defaultQuestQueue } from '@/lib/adventure/questQueue';
import { rankReward, scoreKey } from '@party-tracker/shared/questScore.js';

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
  bounds = null,
  position = null,
  onSelectPlace = null,
  session = null,
  onSession = null,
  onRideReport = null,
}) {
  const queue = defaultQuestQueue();
  const gapNeedsAuth = softGateBlocks('adventure', session);
  const questBlocked = (quest) => (isLiveQuest(quest) ? false : gapNeedsAuth);
  const [scoredKeys, setScoredKeys] = useState([]);
  const [rewardLine, setRewardLine] = useState(null);

  useEffect(() => {
    let alive = true;
    readProfileCache().then((snap) => {
      if (alive && Array.isArray(snap?.scoredKeys)) setScoredKeys(snap.scoredKeys);
    });
    return () => {
      alive = false;
    };
  }, [session?.userId]);

  const { durable: rawDurable, ambient, counts } = buildSideQuests({
    pois,
    gaps,
    venueName: venueName || 'this park',
    venueId: venueId || '',
    scoredKeys,
  });
  const inside = inVenue(bounds, position);
  const withCampingNear = rawDurable.map((q) =>
    q.rankLast && inside ? { ...q, nearby: true } : q,
  );
  const durable = position ? sortByProximity(withCampingNear, pois, position) : withCampingNear;

  const [openQuestId, setOpenQuestId] = useState(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState(STATUS_OPTIONS[0].value);
  const [heightIn, setHeightIn] = useState(null);
  const [atLine, setAtLine] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [hookup, setHookup] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [pending, setPending] = useState(0);
  const [lastSubmittedId, setLastSubmittedId] = useState(null);

  useEffect(() => {
    let alive = true;
    queue.pendingCount().then((n) => {
      if (alive) setPending(n);
    });
    return () => {
      alive = false;
    };
  }, [queue, lastSubmittedId]);

  function resetForm() {
    setNote('');
    setStatus(STATUS_OPTIONS[0].value);
    setHeightIn(null);
    setAtLine(false);
    setPlaceName('');
    setHookup(null);
    setSelectedTarget(null);
  }

  function toggleQuest(quest) {
    if (questBlocked(quest)) return;
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
    if (ADD_PLACE_TYPES.includes(quest.type)) return Boolean(placeName.trim());
    if (quest.type === 'camping') return Boolean(hookup);
    return false;
  }

  function walkedNearFor(quest) {
    if (quest.type === 'camping' || ADD_PLACE_TYPES.includes(quest.type)) return inside;
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
    if (ADD_PLACE_TYPES.includes(quest.type)) {
      return { name: placeName.trim(), category: quest.type, note: note.trim() || undefined };
    }
    if (quest.type === 'camping') return { hookup, note: note.trim() || undefined };
    return { note: note.trim() };
  }

  async function submit(quest) {
    if (questBlocked(quest)) return;
    if (!factReady(quest)) return;
    const kind = quest.type || quest.id;
    const target = selectedTarget || (ADD_PLACE_TYPES.includes(quest.type) || quest.type === 'camping' ? null : quest.targets?.[0] || null);
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
    const live = rideReportFromLiveQuest(quest, { status, pois, position });
    if (live && onRideReport) onRideReport(live.rideId, live.status);
    const action = isLiveQuest(quest) ? 'live' : 'first';
    const key = scoreKey(venueId, isLiveQuest(quest) ? kind : quest.type, live?.rideId || target);
    const scored = await awardQuestXp({
      action,
      key,
      walkedNear: walkedNearFor(quest),
      now: Date.now(),
    });
    setScoredKeys(scored.profile.scoredKeys || []);
    if (scored.rankUp) {
      const label = rankReward(scored.profile.rank).label;
      setRewardLine(`You're a ${label} now.`);
    }
    const nextSession = readLocalSession();
    if (nextSession) onSession?.(nextSession);
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
    if (blocked) {
      action = <span className="rowValue">Sign in</span>;
    } else if (position) {
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
                    if (open) setSelectedTarget(target);
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

      {gapNeedsAuth ? <SignInCard session={session} onSession={onSession} /> : null}
      {rewardLine ? <p className="fine block sideQuestReward">{rewardLine}</p> : null}

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

      <p className="fine block">
        {gapNeedsAuth
          ? 'Sign in to submit a gap Side Quest. Live ride reports are name-first. Looking around the list never needs an account.'
          : 'Walk near, see it, mark it. Gap quests need a Profile to keep. Reports queue on this phone.'}
      </p>
    </div>
  );
}
