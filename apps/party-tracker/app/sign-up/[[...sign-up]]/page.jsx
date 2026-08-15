import { SignUp } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import { clerkAppearance } from '@/lib/auth/clerkAppearance';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  if (!clerkBrowserConfigured()) redirect('/');
  return (
    <main className="clerkAuthPage">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        appearance={clerkAppearance}
      />
    </main>
  );
}
