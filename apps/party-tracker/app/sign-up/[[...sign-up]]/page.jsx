import { SignUp } from '@clerk/nextjs';
import { clerkAppearance } from '@/lib/auth/clerkAppearance';

export default function SignUpPage() {
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
