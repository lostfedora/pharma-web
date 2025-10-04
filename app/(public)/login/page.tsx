import { Suspense } from 'react';
import LoginClient from './LoginClient';

export const dynamic = 'force-dynamic'; // or: export const revalidate = 0;

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" /></div>}>
      <LoginClient />
    </Suspense>
  );
}
