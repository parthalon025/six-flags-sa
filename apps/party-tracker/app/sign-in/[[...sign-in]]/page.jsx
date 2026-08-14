import { SignIn } from '@clerk/nextjs';
import { clerkAppearance } from '@/lib/auth/clerkAppearance';

export default function SignInPage() {
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
