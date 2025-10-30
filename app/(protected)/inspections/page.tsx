// app/(protected)/inspections/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getDatabase,
  ref,
  query as fbQuery,
  orderByChild,
  limitToLast,
  endAt,
  get,
  onValue,
  DataSnapshot,
} from 'firebase/database';
import primaryApp, { database as primaryDb } from '@/firebase';
import {
  ClipboardList,
  Search,
  MapPin,
  Calendar,
  Eye,
  Package,
  Loader2,
  Plus,
  Filter,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type FacilityType = 'Human' | 'Veterinary' | 'Public' | 'Private';

type Inspection = {
  id: string;
  meta: {
    docNo?: string;
    facilityName?: string; // web may not set this
    drugshopName?: string; // web uses this
    location?: string;
    district?: string;
    type?: FacilityType;
    date?: string; // ISO
    createdAt?: string | number;
  };
  _stats?: {
    coldAnswered?: number;
    coldTotal?: number;
    outletAnswered?: number;
    outletTotal?: number;
  };
};

/* ------------------------------------------------------------------ */
/* Constants / helpers                                                */
/* ------------------------------------------------------------------ */
const PAGE_SIZE = 24;

const TYPE_COLORS: Record<FacilityType, string> = {
  Human: '#3B82F6', // blue-600
  Veterinary: '#10B981', // emerald-500
  Public: '#F59E0B', // amber-500
  Private: '#8B5CF6', // violet-500
};

function calcPct(ans?: number, total?: number) {
  if (!total || total <= 0 || !ans) return 0;
  return Math.max(0, Math.min(100, Math.round((ans / total) * 100)));
}

function getProgressColor(p: number) {
  if (p >= 80) return 'text-emerald-600';
  if (p >= 50) return 'text-amber-600';
  return 'text-rose-600';
}
function getBarColor(p: number) {
  if (p >= 80) return 'bg-emerald-500';
  if (p >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function fmtDate(iso?: string | number) {
  if (!iso && iso !== 0) return '—';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(String(iso));
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: '2-digit' });
}

function createdAtMs(meta?: Inspection['meta']) {
  const v = meta?.createdAt;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  // Fallback: try meta.date
  if (meta?.date) {
    const t = Date.parse(meta.date);
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function InspectionsPage() {
  const db = primaryDb ?? getDatabase(primaryApp);
  const router = useRouter();

  const [items, setItems] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [qText, setQText] = useState('');
  const [typeFilter, setTypeFilter] = useState<FacilityType | 'All'>('All');
  const [district, setDistrict] = useState('');
  const [dateFrom, setDateFrom] = useState<string>(''); // yyyy-mm-dd
  const [dateTo, setDateTo] = useState<string>(''); // yyyy-mm-dd
  const [showFilters, setShowFilters] = useState(false);

  // for paging we keep the last seen value of meta/createdAt (string or number)
  const lastSeenOrderVal = useRef<string | number | null>(null);
  const reachedEnd = useRef(false);

  const baseRef = ref(db, 'ndachecklists/submissions');

  // map a snapshot child into our Inspection shape (ensuring id)
  function mapChild(child: DataSnapshot): Inspection {
    const raw: any = child.val() || {};
    const meta = raw.meta || {};
    return {
      id: child.key || '',
      meta,
      _stats: raw._stats || {},
    };
  }

  // initial subscribe (live top PAGE_SIZE) ordered by meta/createdAt
  useEffect(() => {
    const q = fbQuery(baseRef, orderByChild('meta/createdAt'), limitToLast(PAGE_SIZE));
    const unsub = onValue(
      q,
      (snap: DataSnapshot) => {
        const next: Inspection[] = [];
        snap.forEach((child) => {
          next.push(mapChild(child)); // return void to satisfy RTDB forEach type
          // return false; // (optional) explicitly continue
        });
        // sort descending by createdAtMs
        next.sort((a, b) => createdAtMs(b.meta) - createdAtMs(a.meta));
        setItems(next);

        const last = next[next.length - 1];
        lastSeenOrderVal.current = last ? (last.meta?.createdAt ?? null) : null;
        reachedEnd.current = next.length < PAGE_SIZE;
        setLoading(false);
      },
      (err) => {
        console.error('onValue error', err);
        setLoading(false);
      },
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refresh (pull fresh last PAGE_SIZE once)
  async function onRefresh() {
    try {
      setRefreshing(true);
      reachedEnd.current = false;
      lastSeenOrderVal.current = null;

      const q = fbQuery(baseRef, orderByChild('meta/createdAt'), limitToLast(PAGE_SIZE));
      const snap = await get(q);

      const next: Inspection[] = [];
      snap.forEach((child) => {
        next.push(mapChild(child)); // return void
        // return false;
      });
      next.sort((a, b) => createdAtMs(b.meta) - createdAtMs(a.meta));

      setItems(next);
      const last = next[next.length - 1];
      lastSeenOrderVal.current = last ? (last.meta?.createdAt ?? null) : null;
      reachedEnd.current = next.length < PAGE_SIZE;
    } catch (e) {
      console.error('refresh error', e);
      alert('Could not refresh. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }

  // infinite load (older)
  async function loadMore() {
    if (loadingMore || reachedEnd.current || lastSeenOrderVal.current == null) return;
    try {
      setLoadingMore(true);
      const q = fbQuery(
        baseRef,
        orderByChild('meta/createdAt'),
        endAt(
          typeof lastSeenOrderVal.current === 'number'
            ? (lastSeenOrderVal.current as number) - 1 // go strictly older for numeric timestamps
            : (lastSeenOrderVal.current as string),
        ),
        limitToLast(PAGE_SIZE),
      );
      const snap = await get(q);
      const batch: Inspection[] = [];
      snap.forEach((child) => {
        batch.push(mapChild(child)); // return void
        // return false;
      });
      batch.sort((a, b) => createdAtMs(b.meta) - createdAtMs(a.meta));

      if (batch.length === 0) {
        reachedEnd.current = true;
      } else {
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const merged = [...prev];
          batch.forEach((it) => {
            if (!seen.has(it.id)) merged.push(it);
          });
          // keep global list sorted
          merged.sort((a, b) => createdAtMs(b.meta) - createdAtMs(a.meta));
          return merged;
        });
        const last = batch[batch.length - 1];
        lastSeenOrderVal.current = last ? (last.meta?.createdAt ?? lastSeenOrderVal.current) : lastSeenOrderVal.current;
        if (batch.length < PAGE_SIZE) reachedEnd.current = true;
      }
    } catch (e) {
      console.error('loadMore error', e);
      alert('Failed to load more records.');
    } finally {
      setLoadingMore(false);
    }
  }

  // filtering (client-side)
  const visible = useMemo(() => {
    const key = qText.trim().toLowerCase();
    const df = dateFrom ? new Date(dateFrom).getTime() : null;
    const dt = dateTo ? new Date(dateTo).getTime() + 24 * 3600 * 1000 - 1 : null; // inclusive end of day
    const distKey = district.trim().toLowerCase();

    return items.filter((it) => {
      const m = it.meta ?? {};
      const created = createdAtMs(m);

      const name = (m.facilityName || m.drugshopName || '').toLowerCase();
      const doc = (m.docNo || '').toLowerCase();
      const dist = (m.district || '').toLowerCase();

      const textMatch = !key || name.includes(key) || doc.includes(key) || dist.includes(key);
      const typeMatch = typeFilter === 'All' || m.type === typeFilter;
      const distMatch = !distKey || dist.includes(distKey);
      const dateMatch = (!df || created >= df) && (!dt || created <= dt);

      return textMatch && typeMatch && distMatch && dateMatch;
    });
  }, [items, qText, typeFilter, district, dateFrom, dateTo]);

  /* ------------------------------------------------------------------ */
  /* UI                                                                 */
  /* ------------------------------------------------------------------ */

  return (
    <main className="mx-auto w-full max-w-7xl px-3 sm:px-4 lg:px-6 py-6 sm:py-8">
      {/* Top bar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20 grid place-items-center">
            <ClipboardList className="h-5 w-5 text-blue-800 dark:text-blue-200" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-blue-800 dark:text-blue-200">Inspections</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              {items.length} total inspection{items.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
            Refresh
          </button>

          <Link
            href="/inspections/new"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-800 text-white px-3 py-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            New Inspection
          </Link>
        </div>
      </div>

      {/* Search + Filters */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-3 sm:p-4 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              placeholder="Search facility, district, or document number…"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <Filter className="h-4 w-4" /> Filters
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Type */}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Facility Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as FacilityType | 'All')}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              >
                <option>All</option>
                <option>Human</option>
                <option>Veterinary</option>
                <option>Public</option>
                <option>Private</option>
              </select>
            </div>

            {/* District */}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">District (contains)</label>
              <input
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="e.g. Kasese"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>

            {/* From */}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>

            {/* To */}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}
      </section>

      {/* Results header */}
      {!loading && (
        <div className="mb-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 px-3 py-2 text-sm text-slate-700 dark:text-slate-300">
          Showing {visible.length} inspection{visible.length !== 1 ? 's' : ''}{qText ? ` for “${qText}”` : ''}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="min-h-[40vh] grid place-items-center">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading inspections…</span>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState hasQuery={!!qText} onCreate={() => router.push('/inspections/new')} />
      ) : (
        <>
          {/* Grid of cards */}
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((item) => (
              <li key={item.id}>
                <InspectionCard item={item} />
              </li>
            ))}
          </ul>

          {/* Load more */}
          <div className="flex items-center justify-center my-6">
            {reachedEnd.current ? (
              <div className="inline-flex items-center gap-2 text-emerald-600 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>All inspections loaded</span>
              </div>
            ) : (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Load more
              </button>
            )}
          </div>
        </>
      )}

      {/* Floating Create button (mobile emphasis) */}
      <Link
        href="/inspections/new"
        className="fixed right-4 bottom-4 inline-flex items-center justify-center rounded-full h-12 w-12 bg-blue-800 text-white shadow-lg lg:hidden"
        aria-label="Create Inspection"
      >
        <Plus className="h-5 w-5" />
      </Link>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Components                                                         */
/* ------------------------------------------------------------------ */

function InspectionCard({ item }: { item: Inspection }) {
  const m = item.meta ?? {};
  const title = m.facilityName || m.drugshopName || 'Unnamed Facility';
  const dateLabel = fmtDate(m.date || m.createdAt);

  const coldPct = calcPct(item._stats?.coldAnswered, item._stats?.coldTotal);
  const outletPct = calcPct(item._stats?.outletAnswered, item._stats?.outletTotal);

  const t = (m.type || 'Private') as FacilityType; // default visual
  const typeColor = TYPE_COLORS[t] || '#64748B';

  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-semibold"
              style={{ backgroundColor: '#DBEAFE', color: '#2563EB' }}
              title="Document Number"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              <span className="truncate">{m.docNo || item.id}</span>
            </span>

            <span
              className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold border"
              style={{
                color: typeColor,
                backgroundColor: `${typeColor}20`,
                borderColor: `${typeColor}55`,
              }}
              title="Facility Type"
            >
              {m.type || '—'}
            </span>
          </div>

          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">{title}</h3>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={`/inspections/${encodeURIComponent(item.id)}`}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200"
            title="View"
          >
            <Eye className="h-4 w-4" />
          </Link>
          <Link
            href={`/impound?ref=${encodeURIComponent(item.id)}`}
            className="inline-flex items-center justify-center rounded-xl bg-rose-600 text-white px-2.5 py-1.5 text-xs"
            title="Impound"
          >
            <Package className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Meta */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-1.5 min-w-0">
          <MapPin className="h-3.5 w-3.5 text-slate-400" />
          <span className="truncate" title={m.district || ''}>
            {m.district || 'Unknown District'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-slate-400" />
          <span>{dateLabel}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="mt-4 space-y-3">
        <ProgressRow label="Cold Chain" pct={coldPct} />
        <ProgressRow label="Drug Outlet" pct={outletPct} />
      </div>
    </article>
  );
}

function ProgressRow({ label, pct }: { label: string; pct: number }) {
  const txt = getProgressColor(pct);
  const bar = getBarColor(pct);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <span className={`text-xs font-bold ${txt}`}>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
        <div className={`h-1.5 rounded ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EmptyState({ hasQuery, onCreate }: { hasQuery: boolean; onCreate: () => void }) {
  return (
    <section className="min-h-[40vh] grid place-items-center">
      <div className="max-w-md text-center space-y-3">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm mx-auto">
          {hasQuery ? <AlertCircle className="h-6 w-6 text-amber-600" /> : <ClipboardList className="h-6 w-6 text-slate-400" />}
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-slate-200">
          {hasQuery ? 'No matching inspections' : 'No inspections yet'}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {hasQuery ? 'Try adjusting your search or filter options.' : 'Start by creating your first inspection checklist.'}
        </p>

        {!hasQuery && (
          <button onClick={onCreate} className="inline-flex items-center gap-2 rounded-xl bg-blue-800 text-white px-4 py-2 text-sm">
            <Plus className="h-4 w-4" />
            Create Inspection
          </button>
        )}
      </div>
    </section>
  );
}
