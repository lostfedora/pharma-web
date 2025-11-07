// app/(protected)/layout.tsx
'use client';

import React from 'react';
import AuthGate from '@/components/AuthGate';
import Navbar from '@/components/Navbar';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-950">
        {children}
      </main>
    </AuthGate>
  );
}
