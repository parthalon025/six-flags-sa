import { SignIn } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import { clerkAppearance } from '@/lib/auth/clerkAppearance';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  if (!clerkBrowserConfigured()) redirect('/');
  return (
    <main className="clerkAuthPage">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        appearance={clerkAppearance}
      />
    </main>
  );
}
