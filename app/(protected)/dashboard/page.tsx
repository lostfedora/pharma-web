// app/dashboard/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import app, { database as primaryDb } from '@/firebase';
import { getAuth } from 'firebase/auth';
import {
  ref,
  onValue,
  query as rtdbQuery,
  orderByChild,
  limitToLast,
  DataSnapshot,
} from 'firebase/database';
import {
  ClipboardList,
  Pill,
  Building,
  Loader2,
  ArrowRight,
  ShieldCheck,
  PackageCheck,
  X,
} from 'lucide-react';

/* -------- Types (unchanged) -------- */
type FacilityType = 'Human' | 'Veterinary' | 'Public' | 'Private';
type Submission = {
  meta?: {
    docNo?: string;
    date?: string;
    serialNumber?: string;
    source?: 'web' | 'mobile' | string;
    drugshopName?: string;
    drugshopContactPhones?: string;
    boxesImpounded?: string;
    impoundedBy?: string;
    location?: {
      coordinates?: { latitude: number; longitude: number };
      formattedAddress?: string;
    } | null;
    status?: string;
    createdAt?: string;          // ISO
    createdBy?: string;
    district?: string;
    type?: FacilityType;
  };
  impoundment?: {
    totalBoxes?: string;
  };
  _stats?: {
    coldAnswered?: number;
    coldTotal?: number;
    outletAnswered?: number;
    outletTotal?: number;
  };
};

type RowLite = {
  id: string;
  serialNumber?: string;
  drugshopName?: string;
  createdAtMs: number;
  boxes: number;
};
type RowFull = {
  id: string;
  serialNumber?: string;
  drugshopName?: string;
  boxesImpounded?: number | string;
  status?: string;
  createdAt?: string;
  date?: string;
  releasedAt?: string;
  releaseNote?: string;
};

/* -------- Utils (unchanged) -------- */
function toNum(n: unknown) {
  if (typeof n === 'number') return Number.isFinite(n) ? n : 0;
  if (typeof n === 'string') {
    const x = Number(n.trim());
    return Number.isFinite(x) ? x : 0;
  }
  return 0;
}
function toMs(iso?: string | number | null) {
  if (iso == null) return 0;
  if (typeof iso === 'number') return Number.isFinite(iso) ? iso : 0;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : 0;
}
function fmt(ms?: number) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

/* -------- Small components (unchanged) -------- */
function KPI({
  name,
  value,
  Icon,
  href,
  accent,
  pill,
  loading,
}: {
  name: string;
  value: number;
  Icon: any;
  href: string;
  accent: string;
  pill: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 focus-within:ring-2 focus-within:ring-blue-500">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{name}</p>
          <div className="mt-1 flex items-end gap-2">
            <span className={`text-2xl font-bold ${accent}`}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /> : value}
            </span>
            {!loading && typeof value === 'number' && value >= 0 && (
              <span className={`text-xs rounded-full px-2 py-0.5 ${pill}`}>live</span>
            )}
          </div>
        </div>
        <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <Icon className="h-5 w-5 text-gray-700 dark:text-gray-300" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-4">
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md px-1 -mx-1"
          aria-label={`View ${name}`}
        >
          View
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded" /></td>
      <td className="px-4 py-3"><div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded" /></td>
      <td className="px-4 py-3"><div className="h-4 w-10 bg-gray-200 dark:bg-gray-800 rounded" /></td>
      <td className="px-4 py-3"><div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded" /></td>
      <td className="px-4 py-3 text-right"><div className="h-9 w-28 bg-gray-200 dark:bg-gray-800 rounded-xl ml-auto" /></td>
    </tr>
  );
}

/* -------- Page -------- */
function DashboardPageInner() {
  // Keep auth/db in refs so effects can use [] deps without changing size
  const authRef = useRef(getAuth(app));
  const dbRef = useRef(primaryDb);

  const [loading, setLoading] = useState(true);

  // KPIs
  const [inspectionsCount, setInspectionsCount] = useState(0);
  const [boundedCount, setBoundedCount] = useState(0);
  const [releasedCount, setReleasedCount] = useState(0);
  const [drugshopsCount, setDrugshopsCount] = useState(0);

  // Recent inspections
  const [recent, setRecent] = useState<RowLite[]>([]);

  // Modal state
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RowFull | null>(null);
  const [loadingModal, setLoadingModal] = useState(false);

  /* ---------- Recent: top 12 ordered by meta/createdAt (ISO) ---------- */
  useEffect(() => {
    const base = ref(dbRef.current, 'ndachecklists/submissions');
    const q = rtdbQuery(base, orderByChild('meta/createdAt'), limitToLast(12));
    const unsub = onValue(
      q,
      (snap: DataSnapshot) => {
        const list: RowLite[] = [];
        snap.forEach((child) => {
          const v = child.val() as Submission;
          const m = v?.meta || {};
          const createdAtMs = toMs(m.createdAt ?? m.date);
          list.push({
            id: child.key!,
            serialNumber: m.serialNumber,
            drugshopName: m.drugshopName,
            createdAtMs,
            boxes: toNum(m.boxesImpounded ?? v.impoundment?.totalBoxes),
          });
        });
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setRecent(list.slice(0, 10));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []); // ← fixed: constant size

  /* ---------- KPIs in one listener ---------- */
  useEffect(() => {
    const unsub = onValue(
      ref(dbRef.current, 'ndachecklists/submissions'),
      (snap) => {
        const total = snap.size;
        let bounded = 0;
        let released = 0;
        snap.forEach((child) => {
          const v = child.val() as Submission;
          const boxes = toNum(v?.meta?.boxesImpounded ?? v?.impoundment?.totalBoxes);
          if (boxes > 0) bounded += 1;
          // If/when you add releasedAt at root:
          const releasedMs = toMs((v as any)?.releasedAt);
          if (releasedMs > 0) released += 1;
        });
        setInspectionsCount(total);
        setBoundedCount(bounded);
        setReleasedCount(released);
      },
      () => {
        setInspectionsCount(0);
        setBoundedCount(0);
        setReleasedCount(0);
      }
    );
    return () => unsub();
  }, []); // ← fixed

  /* ---------- Drugshops registry count ---------- */
  useEffect(() => {
    const unsub = onValue(
      ref(dbRef.current, 'drugshops'),
      (snap) => {
        const val = (snap.val() ?? {}) as Record<string, unknown>;
        setDrugshopsCount(Object.keys(val).length);
      },
      () => setDrugshopsCount(0)
    );
    return () => unsub();
  }, []); // ← fixed

  const kpis = useMemo(
    () => [
      {
        name: 'Inspections',
        value: inspectionsCount,
        icon: ClipboardList,
        href: '/inspections',
        accent: 'text-blue-700 dark:text-blue-300',
        pill: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      },
      {
        name: 'Impounded (boxes > 0)',
        value: boundedCount,
        icon: Pill,
        href: '/bounded-drugs',
        accent: 'text-amber-700 dark:text-amber-300',
        pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
      },
      {
        name: 'Released',
        value: releasedCount,
        icon: PackageCheck,
        href: '/released-drugs',
        accent: 'text-emerald-700 dark:text-emerald-300',
        pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      },
      {
        name: 'Drug Shops (registry)',
        value: drugshopsCount,
        icon: Building,
        href: '/user-manager',
        accent: 'text-violet-700 dark:text-violet-300',
        pill: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
      },
    ],
    [inspectionsCount, boundedCount, releasedCount, drugshopsCount]
  );

  const openModal = useCallback((id: string) => {
    setSelectedId(id);
    setOpen(true);
  }, []);
  const closeModal = useCallback(() => {
    setOpen(false);
    setSelectedId(null);
    setSelected(null);
  }, []);

  /* ---------- Modal subscription (single record) ---------- */
  useEffect(() => {
    if (!open || !selectedId) return;
    setLoadingModal(true);
    const node = ref(dbRef.current, `ndachecklists/submissions/${selectedId}`);
    const unsub = onValue(
      node,
      (snap) => {
        const v = snap.val() as Submission | null;
        if (!v) {
          setSelected(null);
        } else {
          const m = v.meta || {};
          setSelected({
            id: selectedId,
            serialNumber: m.serialNumber,
            drugshopName: m.drugshopName,
            boxesImpounded: m.boxesImpounded ?? v.impoundment?.totalBoxes,
            status: m.status,
            createdAt: m.createdAt,
            date: m.date,
            releasedAt: (v as any)?.releasedAt,
            releaseNote: (v as any)?.releaseNote,
          });
        }
        setLoadingModal(false);
      },
      () => setLoadingModal(false)
    );
    return () => unsub();
  }, [open, selectedId]); // size is constant (2)

  /* ---------- ESC to close ---------- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeModal();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeModal]); // size is constant (2)

  return (
    <main className="mx-auto max-w-[120rem] px-3 sm:px-4 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Dashboard</h1>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            Live overview from <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">/ndachecklists/submissions</code>.
          </p>
        </div>
        <div className="mt-2 sm:mt-0 flex gap-2">
          <Link
            href="/inspections/new/"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white px-3 py-2 text-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <ClipboardList className="h-4 w-4" />
            New Inspection
          </Link>
          <Link
            href="/inspections"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            View All
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">Key performance indicators</h2>
        <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          {kpis.map((k) => (
            <KPI
              key={k.name}
              name={k.name}
              value={k.value}
              Icon={k.icon}
              href={k.href}
              accent={k.accent}
              pill={k.pill}
              loading={loading}
            />
          ))}
        </div>
      </section>

      {/* Recent */}
      <section className="mt-6 sm:mt-8 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">Recent Inspections</h2>
          <Link
            href="/inspections"
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md px-1 -mx-1"
          >
            See all
          </Link>
        </div>

        {/* Mobile list */}
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 sm:hidden" role="list">
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
          ) : recent.length === 0 ? (
            <li className="p-6 text-center text-gray-600 dark:text-gray-400">No inspections found.</li>
          ) : (
            recent.map((r) => (
              <li key={r.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {r.serialNumber || '—'}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 truncate">
                      {r.drugshopName || '—'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{r.createdAtMs ? fmt(r.createdAtMs) : '—'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-300">
                      {r.boxes} boxes
                    </span>
                    <button
                      onClick={() => openModal(r.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      View
                    </button>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>

        {/* Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Serial</th>
                <th className="px-4 py-3 text-left font-semibold">Drugshop</th>
                <th className="px-4 py-3 text-left font-semibold">Boxes</th>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={`sk-${i}`} />)
              ) : recent.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-600 dark:text-gray-400">
                    No inspections found.
                  </td>
                </tr>
              ) : (
                recent.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-[10rem] truncate">{r.serialNumber || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[16rem] truncate">{r.drugshopName || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.boxes}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.createdAtMs ? fmt(r.createdAtMs) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openModal(r.id)}
                        className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="Quick view"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer meta */}
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Data source: <code className="px-1">ndachecklists/submissions</code>. Ordered by <code className="px-1">meta/createdAt</code>.
      </p>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button className="absolute inset-0 bg-black/50" onClick={closeModal} aria-label="Close modal backdrop" />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-xl sm:max-w-2xl md:max-w-3xl rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-4 sm:p-5 mx-3 sm:mx-6"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Inspection Preview</h3>
              <button
                className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onClick={closeModal}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingModal ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            ) : !selected ? (
              <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                Couldn’t load this inspection.
              </div>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Serial</div>
                    <div className="font-medium break-words">{selected.serialNumber || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Drugshop</div>
                    <div className="font-medium break-words">{selected.drugshopName || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Boxes Impounded</div>
                    <div className="font-medium">{toNum(selected.boxesImpounded)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Created At</div>
                    <div className="font-medium">{fmt(toMs(selected.createdAt ?? selected.date))}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Status</div>
                    <div className="font-medium">{selected.status || 'submitted'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Released</div>
                    <div className="font-medium">{toMs(selected.releasedAt) ? fmt(toMs(selected.releasedAt)) : '—'}</div>
                  </div>
                  {selected.releaseNote ? (
                    <div className="sm:col-span-2">
                      <div className="text-gray-500 dark:text-gray-400">Release Note</div>
                      <div className="font-medium break-words">{selected.releaseNote}</div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <Link
                    href="/bounded-drugs"
                    className="inline-flex items-center gap-1 rounded-xl border border-amber-300 dark:border-amber-700 px-3 py-2 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  >
                    <Pill className="h-4 w-4" />
                    Bounded
                  </Link>
                  <Link
                    href="/released-drugs"
                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 dark:border-emerald-700 px-3 py-2 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                  >
                    <PackageCheck className="h-4 w-4" />
                    Released
                  </Link>
                  <Link
                    href={`/inspections/${selectedId}`}
                    className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                    title="Open full inspection"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Open Inspection
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default function DashboardPage() {
  return <DashboardPageInner />;
}
