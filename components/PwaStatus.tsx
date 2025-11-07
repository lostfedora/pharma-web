'use client';
import { useEffect, useState } from 'react';

export default function PwaStatus() {
  const [status, setStatus] = useState('checking…');

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setStatus('SW not supported');
      return;
    }
    navigator.serviceWorker.getRegistration().then((reg) => {
      setStatus(reg ? `SW registered: ${reg.scope}` : 'No SW registration (dev mode or build missing)');
    });
  }, []);

  return <p className="text-xs opacity-70 mt-6 text-center">PWA: {status}</p>;
}
