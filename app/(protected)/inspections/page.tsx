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
  update,
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
  Locate,
  Info,
  ShieldAlert,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type FacilityType = 'Human' | 'Veterinary' | 'Public' | 'Private';
type BoxStatus = 'Not yet in store' | 'In Store' | 'Released' | 'DESTROYED';

type LocationMeta =
  | {
      coordinates?: { latitude?: number; longitude?: number };
      formattedAddress?: string;
    }
  | null;

type MetaBlock = {
  docNo?: string;
  serialNumber?: string;
  facilityName?: string;
  drugshopName?: string;
  drugshopContactPhones?: string;
  location?: LocationMeta;
  district?: string;
  type?: FacilityType;
  date?: string;
  createdAt?: string | number;
  createdBy?: string;
  source?: string;
};

type ImpoundmentBlock = {
  totalBoxes?: string;
  impoundedBy?: string;
  impoundmentDate?: string;
  reason?: string;
  boxStatus?: BoxStatus;
  destroyedDate?: string;
  reminder100SentAt?: string; // set once we auto-notify (>100 days in store)
} | null;

type Inspection = {
  id: string;
  meta: MetaBlock;
  impoundment?: ImpoundmentBlock;
  _stats?: Record<string, unknown>;
};

/* ------------------------------------------------------------------ */
/* Constants / helpers                                                */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 24;

const TYPE_COLORS: Record<FacilityType, string> = {
  Human: '#3B82F6',
  Veterinary: '#10B981',
  Public: '#F59E0B',
  Private: '#8B5CF6',
};

const BOX_STATUS_OPTIONS: Array<'All' | BoxStatus> = [
  'All',
  'Not yet in store',
  'In Store',
  'Released',
  'DESTROYED',
];

function fmtDate(iso?: string | number) {
  if (!iso && iso !== 0) return '—';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(String(iso));
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: '2-digit' });
}

function createdAtMs(meta?: MetaBlock) {
  const v = meta?.createdAt;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!isNaN(t)) return t;
  }
  if (meta?.date) {
    const t = Date.parse(meta.date);
    if (!isNaN(t)) return t;
  }
  return 0;
}

function compactLocationLabel(loc?: LocationMeta): string {
  if (!loc) return '';
  if (loc.formattedAddress) return loc.formattedAddress;
  const lat = loc.coordinates?.latitude;
  const lng = loc.coordinates?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)}`;
  }
  return '';
}

function toInt(n?: string): number {
  if (!n) return 0;
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : 0;
}

function mapChild(child: DataSnapshot): Inspection {
  const raw: any = child.val() || {};
  return {
    id: child.key || '',
    meta: raw.meta || {},
    impoundment: raw.impoundment || null,
    _stats: raw._stats || {},
  };
}

function daysBetween(aIso?: string | null, bIso?: string | null) {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const diffMs = Math.max(0, b - a);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
function nowIso() {
  return new Date().toISOString();
}

/* -------- Phone helpers (UG) & SMS ---------- */
const ugReCanonical = /^\+2567\d{8}$/;
function normalizeUgPhone(p: string) {
  const s = p.replace(/\s+/g, '');
  if (ugReCanonical.test(s)) return s;
  if (/^2567\d{8}$/.test(s)) return `+${s}`;
  if (/^07\d{8}$/.test(s)) return `+256${s.slice(1)}`;
  return s;
}
function splitCsv(s?: string) {
  return (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
function uniqueCsv(arr: string[]) {
  return Array.from(new Set(arr)).join(',');
}
function collectOwnerPhones(meta?: MetaBlock) {
  const base = splitCsv(meta?.drugshopContactPhones);
  const normalized = base.map(normalizeUgPhone).filter(Boolean);
  return uniqueCsv(normalized);
}
async function sendSms(toPhonesCsv: string, message: string) {
  const r = await fetch('/api/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: toPhonesCsv, message }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`SMS failed (${r.status}): ${text || 'Unknown error'}`);
  }
  return r.json().catch(() => ({}));
}
function buildReminder100Message(it: Inspection, days: number) {
  const m = it.meta || {};
  const shop = m.facilityName || m.drugshopName || 'Facility';
  const ref = m.serialNumber || it.id || '';
  const impDate = it.impoundment?.impoundmentDate || (m.date as string) || '';
  const when = fmtDate(impDate);
  const boxes = it.impoundment?.totalBoxes || m['boxesImpounded' as keyof MetaBlock] || '0';
  return (
    `Dear ${shop}, your impounded drugs (${boxes} box(es)) have been in store for ${days} days (since ${when}). ` +
    `Please arrange to claim them. Ref: ${ref}.`
  );
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
  const [statusFilter, setStatusFilter] = useState<'All' | BoxStatus>('All'); // NEW
  const [district, setDistrict] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const lastSeenOrderVal = useRef<string | number | null>(null);
  const reachedEnd = useRef(false);

  // prevent duplicate SMS sends within current session
  const remindedIds = useRef<Set<string>>(new Set());

  const baseRef = ref(db, 'ndachecklists/submissions');

  useEffect(() => {
    const q = fbQuery(baseRef, orderByChild('meta/createdAt'), limitToLast(PAGE_SIZE));
    const unsub = onValue(
      q,
      (snap: DataSnapshot) => {
        const next: Inspection[] = [];
        snap.forEach((child) => {
          next.push(mapChild(child));
        });
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
  }, [db]);

  async function onRefresh() {
    try {
      setRefreshing(true);
      reachedEnd.current = false;
      lastSeenOrderVal.current = null;

      const q = fbQuery(baseRef, orderByChild('meta/createdAt'), limitToLast(PAGE_SIZE));
      const snap = await get(q);

      const next: Inspection[] = [];
      snap.forEach((child) => {
        next.push(mapChild(child));
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

  async function loadMore() {
    if (loadingMore || reachedEnd.current || lastSeenOrderVal.current == null) return;
    try {
      setLoadingMore(true);
      const q = fbQuery(
        baseRef,
        orderByChild('meta/createdAt'),
        endAt(
          typeof lastSeenOrderVal.current === 'number'
            ? (lastSeenOrderVal.current as number) - 1
            : (lastSeenOrderVal.current as string),
        ),
        limitToLast(PAGE_SIZE),
      );
      const snap = await get(q);
      const batch: Inspection[] = [];
      snap.forEach((child) => {
        batch.push(mapChild(child));
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

  const visible = useMemo(() => {
    const key = qText.trim().toLowerCase();
    const df = dateFrom ? new Date(dateFrom).getTime() : null;
    const dt = dateTo ? new Date(dateTo).getTime() + 24 * 3600 * 1000 - 1 : null;
    const distKey = district.trim().toLowerCase();

    return items.filter((it) => {
      const m = it.meta ?? {};
      const created = createdAtMs(m);

      const name = (m.facilityName || m.drugshopName || '').toLowerCase();
      const doc = (m.docNo || '').toLowerCase();
      const serial = (m.serialNumber || '').toLowerCase();
      const dist = (m.district || '').toLowerCase();

      const textMatch =
        !key ||
        name.includes(key) ||
        doc.includes(key) ||
        serial.includes(key) ||
        dist.includes(key);

      const typeMatch = typeFilter === 'All' || m.type === typeFilter;
      const distMatch = !distKey || dist.includes(distKey);
      const dateMatch = (!df || created >= df) && (!dt || created <= dt);

      const statusOk =
        statusFilter === 'All' ||
        (it.impoundment?.boxStatus || 'Not yet in store') === statusFilter;

      return textMatch && typeMatch && distMatch && dateMatch && statusOk;
    });
  }, [items, qText, typeFilter, district, dateFrom, dateTo, statusFilter]);

  /* ---------------- Auto-remind when >100 days in store ---------------- */
  useEffect(() => {
    // iterate full dataset (not just visible) to ensure reminders still trigger
    (async () => {
      const list = items;
      for (const it of list) {
        const imp = it.impoundment;
        if (!imp) continue;
        if (imp.boxStatus !== 'In Store') continue; // only while in store
        if (imp.reminder100SentAt) continue;        // already reminded
        if (remindedIds.current.has(it.id)) continue; // session guard

        // Determine days in store: from impoundmentDate (or meta.date fallback) to now
        const start = imp.impoundmentDate || (it.meta?.date as string) || null;
        const d = daysBetween(start, nowIso());
        if (d == null) continue;
        if (d <= 100) continue;

        const toCsv = collectOwnerPhones(it.meta);
        if (!toCsv) continue;

        try {
          const msg = buildReminder100Message(it, d);
          await sendSms(toCsv, msg);
          await update(ref(db, `ndachecklists/submissions/${it.id}/impoundment`), {
            reminder100SentAt: nowIso(),
          });
          remindedIds.current.add(it.id);
          // optional visual toast could be added here
        } catch (e: any) {
          console.warn('Auto-reminder SMS failed for', it.id, e?.message || e);
        }
      }
    })();
  }, [items, db]);

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
              placeholder="Search facility, district, doc no, or serial no…"
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
          <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3">
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

            {/* NEW: Status filter */}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'All' | BoxStatus)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              >
                {BOX_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">District (contains)</label>
              <input
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="e.g. Kasese"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>

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
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((item) => (
              <li key={item.id}>
                <InspectionCard item={item} />
              </li>
            ))}
          </ul>

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
  const imp = item.impoundment ?? null;

  const title = m.facilityName || m.drugshopName || 'Unnamed Facility';
  const dateLabel = fmtDate(m.date || m.createdAt);

  const t = (m.type || 'Private') as FacilityType;
  const typeColor = TYPE_COLORS[t] || '#64748B';

  const locLabel = compactLocationLabel(m.location);
  const districtLabel = m.district || 'Unknown District';
  const serial = m.serialNumber || '';
  const boxes = toInt(imp?.totalBoxes);
  const reason = imp?.reason || '';
  const status = imp?.boxStatus || 'Not yet in store';

  // (Optional) small status chip
  const statusChip =
    status ? (
      <span
        className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold border"
        title="Box status"
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        {status}
      </span>
    ) : null;

  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-semibold"
              style={{ backgroundColor: '#DBEAFE', color: '#2563EB' }}
              title="Document Number"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              <span className="truncate">{m.docNo || item.id}</span>
            </span>

            {serial ? (
              <span
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold border border-slate-300 dark:border-slate-700"
                title="Serial Number"
              >
                SN: {serial}
              </span>
            ) : null}

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

            {statusChip}

            {boxes > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}
                title={reason ? `Impound reason: ${reason}` : 'Boxes impounded'}
              >
                <Package className="h-3.5 w-3.5" />
                {boxes} box{boxes !== 1 ? 'es' : ''}
              </span>
            ) : null}
          </div>

          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
            {title}
          </h3>
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

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-1.5 min-w-0">
          <MapPin className="h-3.5 w-3.5 text-slate-400" />
          <span className="truncate" title={locLabel || districtLabel}>
            {locLabel || districtLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-slate-400" />
          <span>{dateLabel}</span>
        </div>

        {(m.createdBy || m.source) && (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <Info className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate" title={m.createdBy || ''}>
                {m.createdBy || '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Locate className="h-3.5 w-3.5 text-slate-400" />
              <span title="Source">{m.source || '—'}</span>
            </div>
          </>
        )}
      </div>
    </article>
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
