// app/released-drugs/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { database } from '@/firebase';
import {
  ref,
  onValue,
  query as rtdbQuery,
  orderByChild,
  startAt,
} from 'firebase/database';
import { Search, ShieldCheck, Loader2, PackageCheck } from 'lucide-react';

type Inspection = {
  id: string;
  serialNumber?: string;
  drugshopName?: string;
  location?: any;
  boxesImpounded?: string | number;
  impoundedBy?: string;
  date?: string;                // ISO
  createdAt?: string | number;  // ISO or ms
  releasedAt?: number;          // ms
  releasedBy?: string;
  releaseNote?: string;
};

function toMs(x?: string | number) {
  if (!x) return 0;
  if (typeof x === 'number') return x;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : 0;
}
function fmtDT(ms?: number) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function ReleasedDrugsPageInner() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Inspection[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // releasedAt > 0
    const q = rtdbQuery(
      ref(database, 'inspections'),
      orderByChild('releasedAt'),
      startAt(1 as any)
    );
    const unsub = onValue(
      q,
      (snap) => {
        const val = (snap.val() ?? {}) as Record<string, any>;
        const list: Inspection[] = Object.entries(val).map(([id, v]) => ({
          id,
          ...v,
        }));
        // Sort newest releases first
        list.sort((a, b) => (b.releasedAt ?? 0) - (a.releasedAt ?? 0));
        setRows(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.serialNumber || '').toLowerCase().includes(s) ||
        (r.drugshopName || '').toLowerCase().includes(s) ||
        (typeof r.location === 'string'
          ? r.location.toLowerCase().includes(s)
          : false) ||
        (r.releaseNote || '').toLowerCase().includes(s)
    );
  }, [rows, search]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Released Drugs
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Inspections that have been marked as released.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Serial, Drugshop, Location, or Note…"
            className="pl-10 pr-4 py-2.5 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white/60 dark:bg-gray-900/60 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Serial</th>
                <th className="px-4 py-3 text-left font-semibold">Drugshop</th>
                <th className="px-4 py-3 text-left font-semibold">Released At</th>
                <th className="px-4 py-3 text-left font-semibold">Released By</th>
                <th className="px-4 py-3 text-left font-semibold">Note</th>
                <th className="px-4 py-3 text-left font-semibold">Date (Created)</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="animate-pulse">
                    <td className="px-4 py-3">
                      <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-28 bg-gray-200 dark:bg-gray-800 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="h-9 w-28 bg-gray-200 dark:bg-gray-800 rounded-xl ml-auto" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-10 text-center text-gray-600 dark:text-gray-400"
                  >
                    No released records found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const createdMs = toMs(r.createdAt ?? r.date);
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        {r.serialNumber || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {r.drugshopName || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {fmtDT(r.releasedAt)}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {r.releasedBy || '—'}
                      </td>
                      <td
                        className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[280px] truncate"
                        title={r.releaseNote || ''}
                      >
                        {r.releaseNote || <span className="text-gray-500">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {createdMs ? fmtDT(createdMs) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/inspections/${r.id}`}
                          className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                          title="Open inspection"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Inspection
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && (
          <div className="flex items-center justify-between px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
            <span>Total released: {rows.length}</span>
            <span>Showing: {filtered.length}</span>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <PackageCheck className="h-4 w-4" />
        Data source: <code className="px-1">/inspections</code> (filtered where{' '}
        <code className="px-1">releasedAt &gt; 0</code>).
      </p>
    </main>
  );
}

export default function ReleasedDrugsPage() {
  return (
    <ReleasedDrugsPageInner />
  );
}
