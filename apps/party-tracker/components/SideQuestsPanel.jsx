'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import SignInCard from '@/components/SignInCard';
import { softGateBlocks } from '@/lib/auth/session';
import { buildSideQuests, sortByProximity } from '@/lib/sideQuests';
import { findPlace, titleOf } from '@/lib/venue/ids';
import { createReport, defaultQuestQueue } from '@/lib/adventure/questQueue';

/**
 * Side Quests tab — missions for facts only guests on the ground can settle.
 *
 * Soft-gate (EP.3): browse the list anonymously; submit needs sign-in.
 * A tap opens a small note + status form; Submit queues the report on this
 * phone (lib/adventure/questQueue.js). When `position` is known, quests near
 * it float to the top and the form can attach where the guest is standing.
 */

const STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Looks right' },
  { value: 'changed', label: 'Changed' },
  { value: 'issue', label: 'Problem here' },
];

export default function SideQuestsPanel({
  venueName = null,
  venueId = null,
  pois = [],
  position = null,
  onSelectPlace = null,
  session = null,
  onSession = null,
}) {
  const queue = defaultQuestQueue();
  const needsAuth = softGateBlocks('adventure', session);
  const { durable: rawDurable, ambient, counts } = buildSideQuests({
    pois,
    venueName: venueName || 'this park',
  });
  const durable = position ? sortByProximity(rawDurable, pois, position) : rawDurable;

  const [openQuestId, setOpenQuestId] = useState(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState(STATUS_OPTIONS[0].value);
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

  function toggleQuest(quest) {
    if (needsAuth) return;
    if (openQuestId === quest.id) {
      setOpenQuestId(null);
      return;
    }
    setOpenQuestId(quest.id);
    setNote('');
    setStatus(STATUS_OPTIONS[0].value);
  }

  async function submit(quest) {
    if (needsAuth) return;
    const report = createReport({
      questId: quest.id,
      venueId,
      kind: quest.type || quest.id,
      payload: { note: note.trim(), status },
      lat: position?.lat ?? null,
      lng: position?.lng ?? null,
    });
    await queue.enqueue(report);
    setOpenQuestId(null);
    setLastSubmittedId(report.id);
  }

  const renderQuest = (q) => {
    const open = openQuestId === q.id;
    let action;
    if (needsAuth) {
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
    return (
      <div key={q.id} className="row sideQuestRow" role="listitem">
        <span className="sideQuestGlyph" aria-hidden="true">
          <Icon name={q.icon} size={20} />
        </span>
        <span className="rowText">
          <b className="sideQuestTitle">
            {q.title}
            {q.nearby && <span className="sideQuestNear"> · nearby</span>}
          </b>
          <span className="sideQuestBlurb">{q.blurb}</span>
          {q.targets?.length > 0 && (
            <span className="sideQuestTargets">
              {q.targets.slice(0, 4).map((target) => {
                const place = findPlace(pois, target);
                const label = titleOf(place) || target;
                return (
                <button
                  key={target}
                  type="button"
                  className="sideQuestChip"
                  onClick={() => {
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
          {open && !needsAuth && (
            <div className="sideQuestForm">
              <textarea
                className="field sideQuestNote"
                rows={2}
                maxLength={280}
                placeholder="What did you see? (optional)"
                aria-label="Note for this report"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
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
              <button
                type="button"
                className="btn small primary sideQuestSubmit"
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

      {needsAuth ? <SignInCard session={session} onSession={onSession} /> : null}

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
        {needsAuth
          ? 'Sign in to submit a Side Quest. Looking around the list never needs an account.'
          : 'Reports queue on this phone and sync when Side Quests go live (peer confirm, then overlay). Nothing invents coordinates — you do, standing there.'}
      </p>
    </div>
  );
}
