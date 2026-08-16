import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/** Clerk is mandatory (ADR-0010). Middleware is a no-op only in keyless unit-test boxes. */
const clerkReady = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export default clerkReady ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
};
