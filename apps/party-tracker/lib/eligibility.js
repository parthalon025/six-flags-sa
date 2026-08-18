import { identityOf } from './venue/ids.js';
import { isRideable } from '@party-tracker/shared/ontology.js';

/* Eligibility as one fold over this phone's people × the venue's places.
 *
 * Callers pass Party or solo facts via `view` — they do not pick the
 * Subgroup set. Map, list and glance ask `at(id)` — the most restrictive
 * Member in the set. Place detail asks `explain(id)` — each person, with
 * reasons, most restrictive first. Height-slider preview is a temporary
 * override on one Member inside the same set.
 *
 * Relative `.js` imports so the unit suite can load this in plain Node. */

const SILENT = Object.freeze({ kind: null, blocks: false });

const RANK = Object.freeze({
  not: 0,
  companion: 1,
  advisory: 2,
  eligible: 3,
});

const normDim = (v) => {
  if (v === 'none') return 'none';
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normHeight = (h) => {
  if (!h) return null;
  return {
    min: normDim(h.min),
    alone: normDim(h.alone),
    max: normDim(h.max),
    advisory: normDim(h.advisory),
  };
};

const inchesOf = (person) => {
  if (person?.height == null || person.height === '') return null;
  const n = Number(person.height);
  return Number.isFinite(n) ? n : null;
};

/** Unset With adult means accompanied — one encoding for Party and solo. */
export function accompanied(withAdult) {
  return withAdult !== false;
}

function normalizePerson(raw, index) {
  const height = inchesOf(raw);
  return {
    id: raw?.id != null ? String(raw.id) : String(index),
    name: raw?.name || 'Rider',
    height,
    withAdult: accompanied(raw?.withAdult),
  };
}

/**
 * Pick this phone's Eligibility people from Party or solo facts.
 * Tagged phone → matching Subgroup tags only (including device-less).
 * Untagged phone → whole Party. Solo with no height → empty (silent).
 */
export function peopleFor(facts) {
  if (!facts || typeof facts !== 'object') return [];

  let list = [];
  if (facts.party) {
    const members = Array.isArray(facts.party.members) ? facts.party.members : [];
    const selfId = facts.party.selfId;
    const me = members.find((m) => m?.id === selfId);
    const tag = me?.groupId || null;
    const set = tag ? members.filter((m) => m?.groupId === tag) : members;
    list = set.map((m, i) => normalizePerson(m, i));
  } else if (facts.solo) {
    const solo = facts.solo;
    if (solo.height == null || solo.height === '') return [];
    const n = Number(solo.height);
    if (!Number.isFinite(n)) return [];
    list = [
      normalizePerson(
        {
          id: 'self',
          name: solo.name || 'You',
          height: n,
          withAdult: solo.withAdult,
        },
        0,
      ),
    ];
  }

  const preview = facts.preview;
  if (preview && preview.memberId != null) {
    const id = String(preview.memberId);
    list = list.map((p) => {
      if (p.id !== id) return p;
      const height =
        preview.height == null || preview.height === ''
          ? null
          : Number.isFinite(Number(preview.height))
            ? Number(preview.height)
            : p.height;
      return { ...p, height };
    });
  }

  return list;
}

/**
 * One person against one already-normalised height rule.
 * Unset / non-finite height is eligible — not height-constrained.
 * With adult uses `accompanied` (unset = true).
 */
function judge(h, person) {
  const inches = inchesOf(person);
  if (inches == null) {
    return { kind: 'eligible', reasons: ['No height set — not height-constrained.'] };
  }

  const withAdult = accompanied(person?.withAdult);
  const { min, alone, max, advisory } = h;

  if (max != null && max !== 'none' && inches > max) {
    return {
      kind: 'not',
      reasons: [`Riders must be ${max}" or under to ride — this rider is over the max.`],
    };
  }
  if (min != null && min !== 'none' && inches < min) {
    return {
      kind: 'not',
      reasons: [`Riders must be at least ${min}" tall to ride — this rider is under the min.`],
    };
  }
  if (alone != null && alone !== 'none' && inches < alone) {
    if (withAdult) {
      return {
        kind: 'companion',
        reasons: [`Under ${alone}" rides with an adult — this rider qualifies with one along.`],
      };
    }
    return {
      kind: 'not',
      reasons: [`Under ${alone}" needs an adult riding along, and none is assumed here.`],
    };
  }
  if (advisory != null && advisory !== 'none' && inches > advisory) {
    return {
      kind: 'advisory',
      reasons: [`Built for riders under ${advisory}" — check with staff before riding.`],
    };
  }

  const reasons = [];
  if (min != null && min !== 'none' && min > 0) reasons.push(`Meets the ${min}" minimum to ride.`);
  else reasons.push('No minimum height to ride.');
  if (alone != null && alone !== 'none' && inches >= alone) {
    reasons.push(`Tall enough to ride alone at ${alone}".`);
  }
  return { kind: 'eligible', reasons };
}

/**
 * @param {Array<{ id?: string, name?: string, height?: number|null, withAdult?: boolean }>} people
 * @param {Array<object>} places
 * @returns {{ at: (id: string) => { kind: string|null, blocks: boolean }, explain: (id: string) => Array<{ id: string, name: string, kind: string, reasons: string[] }> }}
 */
export function fold(people, places) {
  const list = Array.isArray(people) ? people : [];
  const spots = Array.isArray(places) ? places : [];
  const cells = new Map();
  const rows = new Map();

  for (const place of spots) {
    const id = identityOf(place);
    if (!id) continue;
    const h = normHeight(place.h);
    if (!h && isRideable(place) && list.length > 0) {
      cells.set(id, { kind: 'unknown', blocks: false });
      rows.set(
        id,
        list.map((p, index) => ({
          id: p?.id != null ? String(p.id) : String(index),
          name: p?.name || 'Rider',
          kind: 'unknown',
          reasons: ['No height info yet.'],
        })),
      );
      continue;
    }
    if (!h || list.length === 0) {
      cells.set(id, SILENT);
      rows.set(id, []);
      continue;
    }

    const judged = list.map((person, index) => {
      const { kind, reasons } = judge(h, person);
      return {
        id: person?.id != null ? String(person.id) : String(index),
        name: person?.name || 'Rider',
        kind,
        reasons,
        index,
      };
    });
    judged.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.index - b.index);
    const winner = judged[0];
    cells.set(id, { kind: winner.kind, blocks: winner.kind === 'not' });
    rows.set(id, judged.map(({ index: _index, ...row }) => row));
  }

  return {
    at(id) {
      return cells.get(id) || SILENT;
    },
    explain(id) {
      return rows.get(id) || [];
    },
  };
}

/**
 * Eligibility from Party or solo facts. Callers do not filter Subgroup.
 * @param {{ party?: { selfId: string, members: object[] }, solo?: { height?: number|null, withAdult?: boolean, name?: string }, preview?: { memberId: string, height?: number|null } }} facts
 * @param {Array<object>} places
 */
export function fromFacts(facts, places) {
  return fold(peopleFor(facts), places);
}

/** @deprecated use fromFacts — kept as alias for clarity in older call sites */
export const view = fromFacts;
