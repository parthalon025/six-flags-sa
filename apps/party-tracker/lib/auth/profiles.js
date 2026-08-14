/**
 * Postgres Profile rows keyed by Clerk user id (ADR-0010).
 * Without DATABASE_URL, returns an in-memory-shaped profile for dev.
 */

import { randomUUID } from 'node:crypto';
import { getPool, usingPostgres } from '@/lib/db/postgres';

const memory = new Map();

/**
 * @param {{ clerkUserId: string, email: string, displayName: string }} input
 */
export async function upsertProfileForClerkUser(input) {
  const clerkUserId = String(input.clerkUserId || '').slice(0, 128);
  const email = String(input.email || '').trim().toLowerCase().slice(0, 320);
  const displayName = String(input.displayName || 'Guest').slice(0, 40);
  if (!clerkUserId) throw new Error('clerkUserId required');

  if (!usingPostgres()) {
    const existing = memory.get(clerkUserId);
    if (existing) {
      const next = { ...existing, displayName, email, updatedAt: new Date().toISOString() };
      memory.set(clerkUserId, next);
      return next;
    }
    const row = {
      userId: `usr_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      clerkUserId,
      email,
      displayName,
      rank: 'visitor',
      title: null,
      xp: 0,
      reputation: 0,
      impactHelped: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memory.set(clerkUserId, row);
    return row;
  }

  const pool = await getPool();
  const existing = await pool.query(
    'SELECT u.id AS user_id, u.email, p.display_name, p.rank, p.xp, p.reputation, p.impact_helped FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.clerk_id = $1 LIMIT 1',
    [clerkUserId],
  );

  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    await pool.query(
      'UPDATE users SET email = $2, updated_at = now() WHERE id = $1',
      [row.user_id, email],
    );
    await pool.query(
      'UPDATE profiles SET display_name = $2, updated_at = now() WHERE user_id = $1',
      [row.user_id, displayName],
    );
    return mapRow(row, clerkUserId, displayName, email);
  }

  const userId = `usr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await pool.query(
    'INSERT INTO users (id, clerk_id, email, email_verified_at) VALUES ($1, $2, $3, now())',
    [userId, clerkUserId, email],
  );
  await pool.query(
    `INSERT INTO profiles (user_id, display_name, rank, xp, reputation, impact_helped)
     VALUES ($1, $2, 'visitor', 0, 0, 0)`,
    [userId, displayName],
  );

  return {
    userId,
    clerkUserId,
    email,
    displayName,
    rank: 'visitor',
    title: null,
    xp: 0,
    reputation: 0,
    impactHelped: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapRow(row, clerkUserId, displayName, email) {
  return {
    userId: row.user_id,
    clerkUserId,
    email: email || row.email,
    displayName: displayName || row.display_name,
    rank: row.rank || 'visitor',
    title: null,
    xp: Number(row.xp) || 0,
    reputation: Number(row.reputation) || 0,
    impactHelped: Number(row.impact_helped) || 0,
  };
}
