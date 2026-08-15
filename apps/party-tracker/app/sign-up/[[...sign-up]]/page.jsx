import AuthRouteCard from '@/components/AuthRouteCard';
import { redirect } from 'next/navigation';
import { clerkBrowserConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  if (!clerkBrowserConfigured()) redirect('/');
  return <AuthRouteCard mode="sign-up" />;
}
