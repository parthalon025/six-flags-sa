'use client';

import Icon from '@/components/Icon';
import { buildSideQuests } from '@/lib/sideQuests';

/**
 * Side Quests tab — missions for facts only guests on the ground can settle.
 */

export default function SideQuestsPanel({
  venueName = null,
  pois = [],
  onSelectPlace = null,
}) {
  const { durable, ambient, counts } = buildSideQuests({
    pois,
    venueName: venueName || 'this park',
  });

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

      <div className="label">
        For {venueName || 'this park'}
        {counts.durable ? ` · ${counts.durable} waiting` : ''}
      </div>

      {durable.length === 0 ? (
        <p className="fine block">
          No durable gaps on this map right now. Live Side Quests below are always available while
          you walk.
        </p>
      ) : (
        <div className="rowList">
          {durable.map((q) => (
            <div key={q.id} className="row sideQuestRow" role="listitem">
              <span className="sideQuestGlyph" aria-hidden="true">
                <Icon name={q.icon} size={20} />
              </span>
              <span className="rowText">
                <b className="sideQuestTitle">{q.title}</b>
                <span className="sideQuestBlurb">{q.blurb}</span>
                {q.targets?.length > 0 && (
                  <span className="sideQuestTargets">
                    {q.targets.slice(0, 4).map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="sideQuestChip"
                        onClick={() => {
                          const place = pois.find((p) => p.n === name);
                          if (place && onSelectPlace) onSelectPlace(place);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                    {q.targets.length > 4 ? (
                      <span className="fine">+{q.targets.length - 4} more</span>
                    ) : null}
                  </span>
                )}
              </span>
              <span className="rowValue">Soon</span>
            </div>
          ))}
        </div>
      )}

      <div className="label">While you walk</div>
      <div className="rowList">
        {ambient.map((q) => (
          <div key={q.id} className="row sideQuestRow" role="listitem">
            <span className="sideQuestGlyph" aria-hidden="true">
              <Icon name={q.icon} size={20} />
            </span>
            <span className="rowText">
              <b className="sideQuestTitle">{q.title}</b>
              <span className="sideQuestBlurb">{q.blurb}</span>
            </span>
            <span className="rowValue">Soon</span>
          </div>
        ))}
      </div>

      <p className="fine block">
        Reports will sync when Side Quests go live (peer confirm, then overlay). Nothing invents
        coordinates — you do, standing there.
      </p>
    </div>
  );
}
