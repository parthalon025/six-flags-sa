import AuthRouteCard from '@/components/AuthRouteCard';
import { redirect } from 'next/navigation';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  if (!clerkBrowserConfigured()) redirect('/');
  return <AuthRouteCard mode="sign-in" />;
}
