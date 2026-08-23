import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { clerkUserIsGodmode, godmodeProfileGrant } from '@/lib/godmode';
import { rankFromXp, titleFromXp } from '@party-tracker/shared/questScore.js';
import { json, unauthorized } from '@/app/api/_lib/http';
import { applyGodmodeToClerkProfile, upsertProfileForClerkUser } from '@/lib/auth/profiles';

export const dynamic = 'force-dynamic';

async function loadClerkUser(clerkUserId, fallback) {
  try {
    const client = typeof clerkClient === 'function' ? await clerkClient() : clerkClient;
    return await client.users.getUser(clerkUserId);
  } catch {
    return fallback;
  }
}

/** Mint or refresh the Park Bound Profile row for the signed-in Clerk user. */
export async function POST() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return unauthorized();

  const user = await currentUser();
  if (!user) return unauthorized();

  const clerkUser = await loadClerkUser(clerkUserId, user);
  const godmode = clerkUserIsGodmode(clerkUser);

  const displayName =
    clerkUser.fullName ||
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.username ||
    'Guest';
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ||
    user.primaryEmailAddress?.emailAddress ||
    `${clerkUserId}@clerk.local`;

  let profile = await upsertProfileForClerkUser({
    clerkUserId,
    email,
    displayName: String(displayName).slice(0, 40),
  });

  if (godmode) {
    profile = (await applyGodmodeToClerkProfile(clerkUserId)) || {
      ...profile,
      ...godmodeProfileGrant(profile),
    };
  }

  const xp = Number(profile.xp) || 0;
  return json({
    ok: true,
    godmode,
    profile: {
      ...profile,
      rank: profile.rank || rankFromXp(xp),
      title: profile.title ?? titleFromXp(xp),
    },
  });
}
