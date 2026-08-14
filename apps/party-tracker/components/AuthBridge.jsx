'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import { writeLocalSession, awardQuestXp } from '@/lib/auth/session';
import { writeProfileCache, readProfileCache } from '@/lib/auth/profileCache';
import { flushContributionStash } from '@/lib/auth/contributionStash';
import { createReport, defaultQuestQueue } from '@/lib/adventure/questQueue';
import { rankFromXp, titleFromXp } from '@party-tracker/shared/questScore.js';

/**
 * Mirrors Clerk session into the offline Profile cache the app already uses.
 * Minting the Postgres row happens in POST /api/profile/sync (ADR-0010).
 */
export default function AuthBridge(props) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return null;
  return <AuthBridgeLive {...props} />;
}

function AuthBridgeLive({ onSession, onBindUserId = null }) {
  const { isSignedIn, userId: clerkUserId } = useAuth();
  const { user, isLoaded } = useUser();
  const lastSync = useRef(null);

  useEffect(() => {
    if (!isLoaded) return undefined;
    if (!isSignedIn || !clerkUserId || !user) {
      lastSync.current = null;
      onSession?.(null);
      return undefined;
    }
    if (lastSync.current === clerkUserId) return undefined;

    let cancelled = false;

    (async () => {
      const displayName =
        user.fullName ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        user.username ||
        'Guest';
      const email = user.primaryEmailAddress?.emailAddress || null;

      let parkUserId = null;
      let xp = 0;
      let rank = 'visitor';
      let title = null;

      try {
        const res = await fetch('/api/profile/sync', { method: 'POST' });
        if (res.ok) {
          const body = await res.json();
          parkUserId = body?.profile?.userId || null;
          xp = Number(body?.profile?.xp) || 0;
          rank = body?.profile?.rank || rankFromXp(xp);
          title = body?.profile?.title ?? titleFromXp(xp);
        }
      } catch {
        /* offline — fall back to cache */
      }

      if (!parkUserId) {
        try {
          const cached = await readProfileCache();
          if (cached?.userId) {
            parkUserId = cached.userId;
            xp = Number(cached.xp) || 0;
            rank = cached.rank || rankFromXp(xp);
            title = cached.title ?? titleFromXp(xp);
          }
        } catch {
          /* private mode */
        }
      }

      if (!parkUserId) {
        parkUserId = `usr_clerk_${String(clerkUserId).slice(-24)}`;
      }

      const session = {
        userId: parkUserId,
        clerkUserId,
        email,
        displayName: String(displayName).slice(0, 40),
        rank,
        title,
        xp,
      };

      writeLocalSession(session);
      try {
        const cached = await readProfileCache();
        await writeProfileCache({
          ...(cached || {}),
          userId: parkUserId,
          clerkUserId,
          displayName: session.displayName,
          email,
          rank,
          title,
          xp,
          reputation: Number(cached?.reputation) || 0,
          impactHelped: Number(cached?.impactHelped) || 0,
          scoredKeys: Array.isArray(cached?.scoredKeys) ? cached.scoredKeys : [],
          awardedByKey: cached?.awardedByKey && typeof cached.awardedByKey === 'object' ? cached.awardedByKey : {},
          lastQuestDay: cached?.lastQuestDay || null,
          guests: Array.isArray(cached?.guests) ? cached.guests : [],
        });
      } catch {
        /* IndexedDB unavailable */
      }

      if (!cancelled) {
        lastSync.current = clerkUserId;
        onSession?.(session);
        onBindUserId?.(parkUserId);
        try {
          const queue = defaultQuestQueue();
          await flushContributionStash({
            createReport,
            enqueue: (report) => queue.enqueue(report),
            awardQuestXp,
          });
        } catch {
          /* offline flush */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, clerkUserId, user, onSession, onBindUserId]);

  return null;
}
