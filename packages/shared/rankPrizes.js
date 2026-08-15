/**
 * Exclusive Profile prizes at Rank thresholds (ADR: XP → Title ladder).
 *
 * **Ex prize**: a cosmetic or Kit granted when XP crosses a Rank — not bought,
 * not spent. Titles live in questScore.RANK_REWARDS; this catalog lists the
 * extra Skin / Kit unlocks bundled with each Rank.
 */

import { RANK_LADDER, rankReward } from './questScore.js';

/** @typedef {'skin'|'kit'|'note'} ExPrizeKind */

/** @typedef {{ kind: ExPrizeKind, id?: string, label: string, blurb?: string }} ExPrize */

/** @typedef {{ rank: string, xp: number, title: string | null, prizes: ExPrize[] }} RankPrizeRow */

/** Full ladder for UI and tests — one row per Rank above Visitor. */
export const RANK_EX_PRIZE_CATALOG = Object.freeze([
  {
    rank: 'scout',
    xp: 50,
    title: 'Scout',
    prizes: Object.freeze([
      {
        kind: 'kit',
        id: 'porter-cuff',
        label: 'Porter cuff Kit',
        blurb: 'Your Party sees a strand cuff on your puck while you are on a Side Quest.',
      },
    ]),
  },
  {
    rank: 'ranger',
    xp: 250,
    title: 'Ranger',
    prizes: Object.freeze([
      {
        kind: 'skin',
        id: 'postcard',
        label: 'Postcard Skin',
        blurb: 'Souvenir-map paint — warm paper and illustrated midways.',
      },
    ]),
  },
  {
    rank: 'cartographer',
    xp: 1000,
    title: 'Cartographer',
    prizes: Object.freeze([
      {
        kind: 'skin',
        id: 'drafting',
        label: 'Drafting Skin',
        blurb: 'Blueprint schematic lines on drafting blue.',
      },
      {
        kind: 'kit',
        id: 'quest-sensor',
        label: 'Quest sensor Kit',
        blurb: 'Private HUD arrow toward your next Side Quest Place.',
      },
    ]),
  },
  {
    rank: 'steward',
    xp: 3000,
    title: 'Steward',
    prizes: Object.freeze([
      {
        kind: 'skin',
        id: 'marquee',
        label: 'Marquee Skin',
        blurb: 'Neon midway paint for after the park lights come on.',
      },
      {
        kind: 'skin',
        id: 'pixel-tycoon',
        label: 'Pixel tycoon Skin',
        blurb: 'Blocky RCT homage — square caps and grass tiles.',
      },
      {
        kind: 'note',
        label: 'Wayfarer preview',
        blurb: 'Cartographer rank later unlocks full-ontology Create — not this Field Research loop.',
      },
    ]),
  },
]);

const BY_RANK = Object.fromEntries(RANK_EX_PRIZE_CATALOG.map((row) => [row.rank, row]));

/**
 * Exclusive prizes granted when the Profile first reaches `rank`.
 * @param {string} rank
 * @returns {ExPrize[]}
 */
export function exPrizesForRank(rank) {
  return BY_RANK[rank]?.prizes || [];
}

/**
 * Full catalog rows with Visitor row for settings UI.
 * @returns {RankPrizeRow[]}
 */
export function rankPrizeCatalog() {
  const visitor = rankReward('visitor');
  const rows = [
    {
      rank: 'visitor',
      xp: 0,
      title: visitor.title,
      prizes: Object.freeze([
        {
          kind: 'note',
          label: 'Signed-in Profile',
          blurb: 'Browse free; sign in to keep XP, Managed Guests, and gap Side Quests.',
        },
      ]),
    },
  ];
  for (const row of RANK_LADDER) {
    if (row.rank === 'visitor') continue;
    const bundle = BY_RANK[row.rank];
    if (!bundle) continue;
    rows.push({
      rank: bundle.rank,
      xp: row.xp,
      title: bundle.title,
      prizes: bundle.prizes,
    });
  }
  return rows;
}

/**
 * Human line for a rank-up toast.
 * @param {string} rank
 */
export function rankUpRewardLine(rank) {
  const title = rankReward(rank).title;
  const prizes = exPrizesForRank(rank).filter((p) => p.kind !== 'note');
  if (!title && prizes.length === 0) return null;
  const parts = [];
  if (title) parts.push(title);
  for (const p of prizes) parts.push(p.label);
  return parts.join(' · ');
}

/**
 * Next Rank row after `rank`, or null at Steward.
 * @param {string} rank
 */
export function nextRankPrizeRow(rank) {
  const order = RANK_LADDER.map((r) => r.rank);
  const i = order.indexOf(rank);
  if (i < 0 || i >= order.length - 1) return null;
  const nextRank = order[i + 1];
  const ladder = RANK_LADDER.find((r) => r.rank === nextRank);
  const bundle = BY_RANK[nextRank];
  if (!ladder || !bundle) return null;
  return { rank: nextRank, xp: ladder.xp, title: bundle.title, prizes: bundle.prizes };
}
