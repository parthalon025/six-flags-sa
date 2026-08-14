import { auth, currentUser } from '@clerk/nextjs/server';
import { rankFromXp, titleFromXp } from '@party-tracker/shared/questScore.js';
import { json, unauthorized } from '@/app/api/_lib/http';
import { upsertProfileForClerkUser } from '@/lib/auth/profiles';

export const dynamic = 'force-dynamic';

/** Mint or refresh the Park Bound Profile row for the signed-in Clerk user. */
export async function POST() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return unauthorized();

  const user = await currentUser();
  if (!user) return unauthorized();

  const displayName =
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.username ||
    'Guest';
  const email = user.primaryEmailAddress?.emailAddress || `${clerkUserId}@clerk.local`;

  const profile = await upsertProfileForClerkUser({
    clerkUserId,
    email,
    displayName: String(displayName).slice(0, 40),
  });

  const xp = Number(profile.xp) || 0;
  return json({
    ok: true,
    profile: {
      ...profile,
      rank: profile.rank || rankFromXp(xp),
      title: profile.title ?? titleFromXp(xp),
    },
  });
}
