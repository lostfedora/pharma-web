// app/bounded-drugs/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  getDatabase,
  ref,
  onValue,
  query,
  orderByChild,
  startAt,
  update,
  push,
} from 'firebase/database';
import primaryApp, { database as primaryDb } from '@/firebase';
import { getAuth } from 'firebase/auth';
import {
  Search,
  Check,
  ShieldCheck,
  Package,
  X,
  Loader2,
  Lock,
  AlertTriangle,
  User as UserIcon,
  Calendar,
  Phone,
  MessageSquare,
} from 'lucide-react';

/** Types **/
type Inspection = {
  id: string;
  serialNumber?: string;
  drugshopName?: string;
  clientTelephone?: string;
  location?: any;
  boxesImpounded?: string | number;
  reason?: string;
  impoundedBy?: string;
  date?: string;
  createdAt?: string | number;
  createdBy?: string;
  status?: string;
  releasedAt?: number;
  inspectionId?: string;
};

/** Utils **/
function parseNumber(n: any): number {
  if (typeof n === 'number') return Number.isFinite(n) ? n : 0;
  if (typeof n === 'string') {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }
  return 0;
}

function formatDate(isoOrMs?: string | number) {
  if (!isoOrMs) return '—';
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const YOOLA_API_KEY = 'xgpYr222zWMD4w5VIzUaZc5KYO5L1w8N38qBj1qPflwguq9PdJ545NTCSLTS7H00';
// ⚠️ Move this key to a server-side API route/environment secret in production.

const validateTel = (t: string) => /^(\+?\d{7,15})$/.test((t || '').replace(/\s+/g, ''));

/** Page **/
export default function BoundedFromInspections() {
  const db = primaryDb ?? getDatabase(primaryApp);
  const auth = getAuth(primaryApp);
  const me = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Inspection[]>([]);
  const [search, setSearch] = useState('');

  // Modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [targetRow, setTargetRow] = useState<Inspection | null>(null);

  // Release form fields (modal)
  const [relDate, setRelDate] = useState<string>(() => new Date().toISOString().slice(0, 10)); // yyyy-mm-dd
  const [clientName, setClientName] = useState('');
  const [telephone, setTelephone] = useState('');
  const [releasedBy, setReleasedBy] = useState('');
  const [comment, setComment] = useState('');
  const [boxesReleased, setBoxesReleased] = useState('');

  // focus management
  const firstFocusableRef = useRef<HTMLInputElement | null>(null);

  // subscribe to bounded items
  useEffect(() => {
    const qy = query(ref(db, 'inspections'), orderByChild('boxesImpounded'), startAt(1 as any));
    const unsub = onValue(
      qy,
      (snap) => {
        const val = snap.val() as Record<string, any> | null;
        let list: Inspection[] = [];
        if (val) list = Object.entries(val).map(([id, v]) => ({ id, ...v }));
        list = list.filter((r) => parseNumber(r.boxesImpounded) > 0);
        list.sort((a, b) => {
          const aT =
            typeof a.createdAt === 'number'
              ? a.createdAt
              : a.createdAt
                ? Date.parse(a.createdAt)
                : a.date
                  ? Date.parse(a.date)
                  : 0;
          const bT =
            typeof b.createdAt === 'number'
              ? b.createdAt
              : b.createdAt
                ? Date.parse(b.createdAt)
                : b.date
                  ? Date.parse(b.date)
                  : 0;
          return bT - aT;
        });
        setRows(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [db]);

  // modal focus + Esc
  useEffect(() => {
    if (!confirmOpen) return;
    firstFocusableRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmOpen]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!s) return true;
      return (
        (r.serialNumber || '').toLowerCase().includes(s) ||
        (r.drugshopName || '').toLowerCase().includes(s) ||
        (r.impoundedBy || '').toLowerCase().includes(s) ||
        (typeof r.location === 'string' ? r.location.toLowerCase().includes(s) : false)
      );
    });
  }, [rows, search]);

  function openReleaseModal(row: Inspection) {
    setTargetRow(row);
    setSaveError(null);

    // seed form
    setRelDate(new Date().toISOString().slice(0, 10));
    setClientName('');
    setTelephone(row.clientTelephone || '');
    setReleasedBy(me?.displayName || me?.email || '');
    setComment('');
    setBoxesReleased('');

    setConfirmOpen(true);
  }

  const availableBoxes = parseNumber(targetRow?.boxesImpounded ?? 0);
  const intendedCount = Number.isNaN(parseInt(boxesReleased, 10)) ? 0 : parseInt(boxesReleased, 10);

  const canSubmit = useMemo(() => {
    if (!targetRow) return false;
    if (!relDate) return false;
    if (!clientName.trim()) return false;
    if (!telephone.trim() || !validateTel(telephone)) return false;
    if (!releasedBy.trim()) return false;
    if (!intendedCount || intendedCount <= 0) return false;
    if (intendedCount > availableBoxes) return false;
    return true;
  }, [targetRow, relDate, clientName, telephone, releasedBy, intendedCount, availableBoxes]);

  async function sendSms(phone: string, message: string) {
    // ⚠️ In production, route through your server (/api/send-sms) so the API key stays secret.
    return fetch('https://yoolasms.com/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, api_key: YOOLA_API_KEY }),
    });
  }

  async function handleSubmitRelease() {
    if (!targetRow) return;
    const available = availableBoxes;
    const count = intendedCount;

    // basic guards (UI already prevents, but double-check)
    if (!relDate) return setSaveError('Release date is required.');
    if (!clientName.trim()) return setSaveError('Client name is required.');
    if (!telephone.trim()) return setSaveError('Telephone number is required.');
    if (!validateTel(telephone)) return setSaveError('Enter a valid phone number (e.g. +2567XXXXXXX).');
    if (!releasedBy.trim()) return setSaveError('Released by is required.');
    if (Number.isNaN(count) || count <= 0) return setSaveError('Enter a valid number of boxes to release.');
    if (count > available) return setSaveError(`You are releasing ${count}, but only ${available} are impounded.`);

    try {
      setSaveError(null);
      setSavingId(targetRow.id);

      // 1) Write release record
      const releaseRef = ref(db, `releases/${targetRow.id}`);
      const nowIso = new Date().toISOString();
      await push(releaseRef, {
        inspectionId: targetRow.id,
        date: new Date(relDate).toISOString(),
        clientName: clientName.trim(),
        telephone: telephone.replace(/\s+/g, ''),
        releasedBy: releasedBy.trim(),
        comment: comment.trim(),
        boxesReleased: count,
        createdAt: nowIso,
        createdByUid: me?.uid ?? 'anonymous',
        createdByEmail: me?.email ?? null,
        createdByName: me?.displayName ?? null,
      });

      // 2) Update inspection
      const remaining = Math.max(0, available - count);
      const isStringType = typeof targetRow.boxesImpounded === 'string';
      const nextStatus = remaining === 0 ? 'Completed' : 'Pending Review';

      await update(ref(db, `inspections/${targetRow.id}`), {
        boxesImpounded: isStringType ? String(remaining) : remaining,
        status: nextStatus,
        releasedAt: Date.now(),
        releasedBy: me?.uid ?? 'anonymous',
        releasedByEmail: me?.email ?? null,
        releasedByName: me?.displayName ?? null,
        lastReleaseNote: comment.trim() || null,
        lastReleaseCount: count,
      });

      // 3) Send SMS
      const when = new Date(relDate);
      const whenStr = isNaN(when.getTime())
        ? relDate
        : when.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

      const msg =
        `Dear ${targetRow.drugshopName || 'Drugshop'}, ` +
        `${count} box(es) have been released on ${whenStr}. ` +
        `Serial: ${targetRow.serialNumber || '—'}. ` +
        `Remaining: ${remaining}. ` +
        `Officer: ${releasedBy.trim()}.`;

      let smsOk = true;
      try {
        const smsRes = await sendSms(telephone.replace(/\s+/g, ''), msg);
        if (!smsRes.ok) smsOk = false;
      } catch {
        smsOk = false;
      }

      setConfirmOpen(false);
      alert(`Release recorded${smsOk ? ' and SMS sent' : ' (SMS failed)'}.\nStatus: ${nextStatus}`);
    } catch (e: any) {
      console.error(e);
      setSaveError(e?.message || 'Failed to submit release. Please try again.');
    } finally {
      setSavingId(null);
    }
  }

  const statusPill = (r: Inspection) => {
    const boxes = parseNumber(r.boxesImpounded);
    if (boxes > 0)
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-800/50">
          impounded
        </span>
      );
    if (r.releasedAt)
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 ring-green-200 dark:ring-green-800/50">
          released
        </span>
      );
    return '—';
  };

  return (
    <main className="mx-auto max-w-[120rem] px-3 sm:px-4 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Bounded Drugs</h1>
        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Inspections with impounded boxes.</p>
      </div>

      {/* Filters */}
      <div className="mb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Serial, Drugshop, Officer or Location…"
            className="pl-9 pr-10 py-2.5 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Clear search"
            >
              <X className="h-4 w-4 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Results container */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <header className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            {!loading ? (
              <>
                Total: <span className="font-semibold text-gray-800 dark:text-gray-100">{rows.length}</span>
                <span className="mx-2">•</span>
                Showing: <span className="font-semibold text-gray-800 dark:text-gray-100">{filtered.length}</span>
              </>
            ) : (
              'Loading…'
            )}
          </p>
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>Realtime</span>
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
          </div>
        </header>

        {/* Mobile list (cards) */}
        <ul className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800" role="list">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <li key={`m-sk-${i}`} className="p-3">
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded" />
                  <div className="h-3 w-28 bg-gray-200 dark:bg-gray-800 rounded" />
                  <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
                </div>
              </li>
            ))
          ) : filtered.length === 0 ? (
            <li className="p-8 text-center text-gray-600 dark:text-gray-400">No impounded items found.</li>
          ) : (
            filtered.map((r) => {
              const boxes = parseNumber(r.boxesImpounded);
              const isCompleted = (r.status || '').toLowerCase().includes('complete') || boxes === 0;
              return (
                <li key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{r.serialNumber || '—'}</p>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 truncate">{r.drugshopName || '—'}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatDate(r.date || r.createdAt)}</p>
                      <div className="mt-1">{statusPill(r)}</div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <Link
                        href={`/inspections/${r.id}`}
                        className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                        title="Open inspection"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Open
                      </Link>
                      <button
                        onClick={() => openReleaseModal(r)}
                        className="inline-flex items-center gap-1 rounded-xl bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 text-xs disabled:opacity-60"
                        disabled={savingId === r.id || isCompleted}
                        title="Open release form"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Release
                      </button>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {/* Table (sm and up) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Serial</th>
                <th className="px-4 py-3 text-left font-semibold">Drugshop</th>
                <th className="px-4 py-3 text-left font-semibold">Location</th>
                <th className="px-4 py-3 text-left font-semibold">Boxes</th>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-left font-semibold">Officer</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-10 bg-gray-200 dark:bg-gray-800 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-28 bg-gray-200 dark:bg-gray-800 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-gray-200 dark:bg-gray-800 rounded" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-9 w-28 bg-gray-200 dark:bg-gray-800 rounded-xl ml-auto" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-600 dark:text-gray-400">
                    No impounded items found in inspections.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const boxes = parseNumber(r.boxesImpounded);
                  const isCompleted = (r.status || '').toLowerCase().includes('complete') || boxes === 0;

                  return (
                    <tr key={r.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-[12rem] truncate">{r.serialNumber || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[18rem] truncate">{r.drugshopName || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[18rem] truncate">
                        {typeof r.location === 'string'
                          ? r.location
                          : r.location?.coordinates
                            ? 'has coordinates'
                            : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{boxes}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDate(r.date || r.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.impoundedBy || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{statusPill(r)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <Link
                            href={`/inspections/${r.id}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                            title="Open inspection"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            Inspection
                          </Link>

                          <button
                            onClick={() => openReleaseModal(r)}
                            className="inline-flex items-center gap-1 rounded-xl bg-green-600 hover:bg-green-700 text-white px-3 py-2 disabled:opacity-60"
                            title="Open release form"
                            disabled={savingId === r.id || isCompleted}
                          >
                            <Lock className="h-4 w-4" />
                            Release
                          </button>
                        </div>
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
            <span>Total: {rows.length}</span>
            <span>Showing: {filtered.length}</span>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Package className="h-4 w-4" /> Data source: <code className="px-1">/inspections</code> (filtered where <code className="px-1">boxesImpounded &gt; 0</code>).
      </p>

      {/* Release Form Modal (Scrollable Content, No Confirmation) */}
      {confirmOpen && targetRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 supports-[backdrop-filter]:backdrop-blur-sm"
            onClick={() => setConfirmOpen(false)}
          />

          {/* Dialog */}
          <div
            className="relative z-10 w-full max-w-xl sm:max-w-2xl rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/90 supports-[backdrop-filter]:backdrop-blur-xl shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-title"
          >
            {/* Saving overlay */}
            {savingId === targetRow.id && (
              <div className="absolute inset-0 rounded-2xl bg-white/60 dark:bg-black/40 backdrop-blur-sm flex items-center justify-center z-10">
                <Loader2 className="h-6 w-6 animate-spin text-gray-600 dark:text-gray-200" />
              </div>
            )}

            {/* Header */}
            <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b border-gray-200 dark:border-gray-800 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h2 id="release-title" className="text-base sm:text-lg font-semibold">Release Form</h2>
              </div>
              <button
                className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setConfirmOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="px-4 sm:px-5 py-4 max-h-[75vh] overflow-y-auto">
              {/* Summary */}
              <div className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
                <p><span className="text-gray-500">Serial:</span> <span className="font-medium break-words">{targetRow.serialNumber || '—'}</span></p>
                <p><span className="text-gray-500">Drugshop:</span> <span className="font-medium break-words">{targetRow.drugshopName || '—'}</span></p>
                <p><span className="text-gray-500">Impounded:</span> <span className="font-medium">{availableBoxes} box(es)</span></p>
                <p className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <UserIcon className="h-4 w-4" />
                  Officer: <span className="font-medium text-gray-800 dark:text-gray-200 ml-1">
                    {me?.displayName || me?.email || me?.uid || 'anonymous'}
                  </span>
                </p>
              </div>

              {/* Progress hint */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>Remaining after this release</span>
                  <span className="font-medium">{Math.max(0, availableBoxes - (intendedCount || 0))}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className="h-full bg-green-600 transition-all"
                    style={{
                      width: `${Math.min(100, (intendedCount > 0 ? (intendedCount / Math.max(availableBoxes, 1)) * 100 : 0))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Form */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Date */}
                <div>
                  <label className="text-sm font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> Date *</label>
                  <input
                    ref={firstFocusableRef}
                    type="date"
                    value={relDate}
                    onChange={(e) => setRelDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                  />
                </div>

                {/* Client name */}
                <div>
                  <label className="text-sm font-medium">Client Name *</label>
                  <input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                    placeholder="Facility representative"
                  />
                </div>

                {/* Telephone */}
                <div>
                  <label className="text-sm font-medium flex items-center gap-2"><Phone className="h-4 w-4" /> Telephone *</label>
                  <input
                    value={telephone}
                    onChange={(e) => setTelephone(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                    placeholder="+2567XXXXXXXX"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">We’ll notify this number via SMS after release.</p>
                </div>

                {/* Released by */}
                <div>
                  <label className="text-sm font-medium">Released By *</label>
                  <input
                    value={releasedBy}
                    onChange={(e) => setReleasedBy(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                    placeholder="Officer name"
                  />
                </div>

                {/* Boxes Released */}
                <div>
                  <label className="text-sm font-medium flex items-center gap-2"><Package className="h-4 w-4" /> Boxes Released *</label>
                  <input
                    value={boxesReleased}
                    onChange={(e) => setBoxesReleased(e.target.value.replace(/[^\d]/g, ''))}
                    className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                    placeholder="e.g. 2"
                    inputMode="numeric"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Available: {availableBoxes} box(es)</p>
                </div>

                {/* Comment */}
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Comment</label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                    placeholder="Receipt number, notes…"
                  />
                </div>

                {/* Error */}
                {saveError && (
                  <div className="sm:col-span-2">
                    <div className="rounded-lg border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                      {saveError}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sticky actions */}
            <div className="px-4 sm:px-5 py-3 border-t border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-900/70 backdrop-blur supports-[backdrop-filter]:backdrop-blur-md rounded-b-2xl flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                disabled={savingId === targetRow.id}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitRelease}
                disabled={!canSubmit || savingId === targetRow.id}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-2 disabled:opacity-60"
                title="Submit release"
              >
                {savingId === targetRow.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Submit Release
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
