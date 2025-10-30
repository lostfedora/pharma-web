// app/(protected)/inspections/[id]/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getDatabase, ref, onValue, DataSnapshot } from 'firebase/database';
import primaryApp, { database as primaryDb } from '@/firebase';
import {
  ArrowLeft,
  ClipboardList,
  MapPin,
  Calendar,
  Percent,
  Package,
  User2,
  Phone,
  Info,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
type YesNo = '' | 'yes' | 'no';
type FacilityType = 'Human' | 'Veterinary' | 'Public' | 'Private';
type Coords = { latitude: number; longitude: number };

type AnswerShape =
  | YesNo
  | string
  | number
  | boolean
  | { label?: string; value?: string | YesNo; answer?: string | YesNo };

type AnswersMap = Record<string, AnswerShape>;

type Inspection = {
  id?: string;
  meta?: {
    docNo?: string;
    date?: string; // ISO
    serialNumber?: string;
    source?: 'web' | 'mobile' | string;
    drugshopName?: string;
    drugshopContactPhones?: string;
    boxesImpounded?: string;
    impoundedBy?: string;
    location?: {
      coordinates?: Coords;
      formattedAddress?: string;
    } | null;
    status?: string;
    createdAt?: string; // ISO
    createdBy?: string;
    district?: string;
    facilityName?: string; // legacy
    type?: FacilityType;
  };
  cold?: {
    answers?: AnswersMap;
    qualification?: string;
    recommendations?: string;
    facilityRepName?: string;
    facilityRepContact?: string;
  };
  outlet?: {
    answers?: AnswersMap;
    lastVisit?: string | null; // ISO
    lastLicenseDate?: string | null; // ISO
    prevScores?: string;
    currentPercentage?: string;
    inChargeName?: string;
    inChargeContact?: string;
    isDistrictRepPresent?: boolean;
  };
  impoundment?: {
    totalBoxes?: string;
    impoundedBy?: string;
    impoundmentDate?: string; // ISO
    reason?: string;
  };
  _stats?: {
    coldAnswered?: number;
    coldTotal?: number;
    outletAnswered?: number;
    outletTotal?: number;
  };
  createdAt?: number; // legacy numeric
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
// Normalize different answer shapes to a plain string WITHOUT upper-casing
function extractAnswer(raw: AnswerShape): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.answer === 'string') return obj.answer;
    return '';
  }
  return '';
}

function extractLabel(k: string, raw: AnswerShape, labels?: Record<string, string>): string {
  if (raw && typeof raw === 'object' && 'label' in (raw as any)) {
    const l = (raw as any).label;
    if (typeof l === 'string' && l.trim()) return l;
  }
  if (labels?.[k]) return labels[k]!;
  return k;
}

function calcPct(ans?: number, total?: number) {
  if (!total || total <= 0 || !ans) return 0;
  return Math.max(0, Math.min(100, Math.round((ans / total) * 100)));
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: '2-digit' });
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-UG', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function badgeClasses(ans: string): string {
  const v = String(ans).toLowerCase();
  if (v === 'yes')
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-900/40';
  if (v === 'no')
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-200 dark:border-rose-900/40';
  return 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-800';
}

/* ------------------------------------------------------------------ */
/* UI atoms                                                           */
/* ------------------------------------------------------------------ */
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
      <div className="h-full bg-blue-700 dark:bg-blue-400" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
      <header className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-200">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span className="font-medium text-slate-800 dark:text-slate-200">{v || '—'}</span>
    </div>
  );
}

function AnswersGrid({
  answers,
  labels,
}: {
  answers?: AnswersMap;
  labels?: Record<string, string>;
}) {
  if (!answers || Object.keys(answers).length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No answers recorded.</p>;
  }

  const entries = Object.entries(answers);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {entries.map(([k, raw]) => {
        const label = extractLabel(k, raw, labels);
        const val = extractAnswer(raw); // <-- already a string; DO NOT upper-case
        const cls = badgeClasses(val);

        return (
          <div key={k} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 p-2">
            <p className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{label}</p>
            <span
              className={[
                'inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-semibold',
                cls,
              ].join(' ')}
            >
              {val || '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const db = primaryDb ?? getDatabase(primaryApp);

  const [item, setItem] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const r = ref(db, `ndachecklists/submissions/${id}`);
    const unsub = onValue(
      r,
      (snap: DataSnapshot) => {
        const v = snap.val() as Inspection | null;
        if (!v) {
          setItem(null);
        } else {
          v.id = id;
          setItem(v);
        }
        setLoading(false);
        setLoadErr(null);
      },
      (err) => {
        console.error('read error', err);
        setLoadErr('Failed to load inspection.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [db, id]);

  const coldPct = useMemo(
    () => calcPct(item?._stats?.coldAnswered, item?._stats?.coldTotal),
    [item]
  );
  const outletPct = useMemo(
    () => calcPct(item?._stats?.outletAnswered, item?._stats?.outletTotal),
    [item]
  );

  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center px-4">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading inspection…</span>
        </div>
      </main>
    );
  }

  if (loadErr || !item) {
    return (
      <main className="mx-auto w-full max-w-4xl px-3 sm:px-4 lg:px-6 py-6 sm:py-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <p className="font-semibold">Inspection not found</p>
              <p className="mt-1">{loadErr || 'The requested inspection does not exist.'}</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const m = item.meta ?? {};
  const title = m.drugshopName || m.facilityName || 'Inspection';
  const createdAtLabel =
    m.createdAt ? fmtDateTime(m.createdAt) : item.createdAt ? fmtDateTime(new Date(item.createdAt).toISOString()) : '—';

  return (
    <main className="mx-auto w-full max-w-6xl px-3 sm:px-4 lg:px-6 py-6 sm:py-8">
      {/* Top bar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="h-11 w-11 rounded-2xl border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20 grid place-items-center">
            <ClipboardList className="h-5 w-5 text-blue-800 dark:text-blue-200" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-blue-800 dark:text-blue-200">
              {title}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Document: {m.docNo || item.id} • Created: {createdAtLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/inspections"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            All Inspections
          </Link>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          {/* Meta */}
          <Section title="Inspection Meta" icon={<Info className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MetaRow k="Date" v={fmtDate(m.date)} />
              <MetaRow k="Source" v={m.source || '—'} />
              <MetaRow k="Serial" v={m.serialNumber || '—'} />
              <MetaRow k="Officer" v={m.impoundedBy || '—'} />
              <MetaRow k="Status" v={m.status || '—'} />
              <MetaRow k="Created By" v={m.createdBy || '—'} />
              <MetaRow k="District" v={m.district || '—'} />
              <MetaRow k="Facility Type" v={m.type || '—'} />
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <User2 className="h-4 w-4 text-slate-400" />
                <span className="truncate">{m.drugshopName || m.facilityName || '—'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <Phone className="h-4 w-4 text-slate-400" />
                <span className="truncate">{m.drugshopContactPhones || '—'}</span>
              </div>
            </div>

            {m.location?.coordinates ? (
              <div className="mt-3 flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <MapPin className="h-4 w-4 text-slate-400" />
                <span>
                  {m.location.coordinates.latitude.toFixed(6)}, {m.location.coordinates.longitude.toFixed(6)}
                </span>
                <span className="text-slate-400">•</span>
                <span className="truncate">{m.location.formattedAddress || '—'}</span>
              </div>
            ) : null}
          </Section>

          {/* Cold Chain */}
          <Section title="Cold Chain — Answers" icon={<Percent className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span>Progress</span>
                <span className="font-semibold">{coldPct}%</span>
              </div>
              <ProgressBar pct={coldPct} />
            </div>

            <AnswersGrid answers={item.cold?.answers} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <MetaRow k="Qualification" v={item.cold?.qualification || '—'} />
              <MetaRow k="Facility Rep" v={item.cold?.facilityRepName || '—'} />
              <MetaRow k="Rep Contact" v={item.cold?.facilityRepContact || '—'} />
              <MetaRow k="Recommendations" v={item.cold?.recommendations || '—'} />
            </div>
          </Section>

          {/* Drug Outlet */}
          <Section title="Drug Outlet — Answers" icon={<Percent className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span>Progress</span>
                <span className="font-semibold">{outletPct}%</span>
              </div>
              <ProgressBar pct={outletPct} />
            </div>

            <AnswersGrid answers={item.outlet?.answers} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <MetaRow k="Last Visit" v={fmtDate(item.outlet?.lastVisit || null)} />
              <MetaRow k="Last License Date" v={fmtDate(item.outlet?.lastLicenseDate || null)} />
              <MetaRow k="Prev Scores" v={item.outlet?.prevScores || '—'} />
              <MetaRow k="Current %" v={item.outlet?.currentPercentage || '—'} />
              <MetaRow k="In-charge" v={item.outlet?.inChargeName || '—'} />
              <MetaRow k="In-charge Contact" v={item.outlet?.inChargeContact || '—'} />
              <MetaRow
                k="District Rep Present"
                v={item.outlet?.isDistrictRepPresent ? 'Yes' : 'No'}
              />
            </div>
          </Section>

          {/* Impoundment */}
          <Section title="Impoundment" icon={<Package className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MetaRow k="Boxes" v={item.impoundment?.totalBoxes || m.boxesImpounded || '0'} />
              <MetaRow k="Officer" v={item.impoundment?.impoundedBy || m.impoundedBy || '—'} />
              <MetaRow k="Reason" v={item.impoundment?.reason || '—'} />
              <MetaRow k="Impoundment Date" v={fmtDate(item.impoundment?.impoundmentDate || m.date || null)} />
            </div>
          </Section>
        </div>

        {/* Aside */}
        <aside className="space-y-4 lg:space-y-6">
          <Section title="Quick Stats" icon={<Info className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>Cold Chain</span>
                  <span className="font-semibold">{coldPct}%</span>
                </div>
                <ProgressBar pct={coldPct} />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>Drug Outlet</span>
                  <span className="font-semibold">{outletPct}%</span>
                </div>
                <ProgressBar pct={outletPct} />
              </div>
            </div>
          </Section>

          <Section title="Dates" icon={<Calendar className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="space-y-2">
              <MetaRow k="Inspection Date" v={fmtDate(m.date)} />
              <MetaRow k="Created" v={createdAtLabel} />
            </div>
          </Section>
        </aside>
      </div>
    </main>
  );
}
