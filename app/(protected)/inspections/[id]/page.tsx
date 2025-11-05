// app/(protected)/inspections/[id]/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getDatabase, ref, onValue, DataSnapshot } from 'firebase/database';
import primaryApp, { database as primaryDb } from '@/firebase';
import {
  ArrowLeft,
  ClipboardList,
  MapPin,
  Calendar,
  Package,
  User2,
  Phone,
  Info,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types (minimal; keep legacy keys)                                   */
/* ------------------------------------------------------------------ */
type FacilityType = 'Human' | 'Veterinary' | 'Public' | 'Private';

type Coords = {
  latitude: number | string;
  longitude: number | string;
};

type Inspection = {
  id?: string;
  meta?: {
    docNo?: string;
    date?: string; // ISO
    serialNumber?: string;
    source?: 'web' | 'mobile' | string;
    drugshopName?: string; // legacy
    facilityName?: string; // preferred
    drugshopContactPhones?: string;
    boxesImpounded?: string;
    impoundedBy?: string;
    location?: {
      coordinates?: Coords;
      formattedAddress?: string;
    } | null;
    status?: string;
    createdAt?: string | number; // ISO or ms
    createdBy?: string;
    district?: string;
    type?: FacilityType;
  };
  impoundment?: {
    totalBoxes?: string;
    impoundedBy?: string;
    impoundmentDate?: string; // ISO
    reason?: string;
  };
  createdAt?: number; // legacy numeric
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: '2-digit' });
}

function fmtDateTime(isoOrNum?: string | number | null) {
  if (isoOrNum == null) return '—';
  const d = typeof isoOrNum === 'number' ? new Date(isoOrNum) : new Date(isoOrNum);
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

function safeCoordToFixed(v?: number | string, digits = 6) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  return n.toFixed(digits);
}

/* ------------------------------------------------------------------ */
/* UI atoms                                                            */
/* ------------------------------------------------------------------ */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
      <header className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-200">
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span className="font-medium text-slate-800 dark:text-slate-200">
        {v || '—'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function InspectionDetailPage() {
  // Robust param extraction (Next 15 may return string | string[])
  const params = useParams();
  const rawId = params?.['id'];
  const id = Array.isArray(rawId) ? rawId[0] : (rawId as string | undefined);

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
        const v = (snap.val() as Inspection | null) || null;
        if (v) v.id = id;
        setItem(v);
        setLoadErr(null);
        setLoading(false);
      },
      (err) => {
        console.error('read error', err);
        setLoadErr('Failed to load inspection.');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [db, id]);

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

  if (!id || loadErr || !item) {
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
  const title = m.facilityName || m.drugshopName || 'Inspection';
  const createdAtLabel = fmtDateTime(m.createdAt ?? item.createdAt ?? null);

  const lat = safeCoordToFixed(m.location?.coordinates?.latitude);
  const lng = safeCoordToFixed(m.location?.coordinates?.longitude);
  const hasCoords = lat !== null && lng !== null;

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
              <MetaRow k="Date" v={fmtDate(m.date || null)} />
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
                <span className="truncate">{m.facilityName || m.drugshopName || '—'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <Phone className="h-4 w-4 text-slate-400" />
                <span className="truncate">{m.drugshopContactPhones || '—'}</span>
              </div>
            </div>

            {(hasCoords || m.location?.formattedAddress) && (
              <div className="mt-3 flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <MapPin className="h-4 w-4 text-slate-400" />
                {hasCoords ? (
                  <span>
                    {lat}, {lng}
                  </span>
                ) : null}
                {m.location?.formattedAddress ? (
                  <>
                    {hasCoords ? <span className="text-slate-400">•</span> : null}
                    <span className="truncate">{m.location.formattedAddress}</span>
                  </>
                ) : null}
              </div>
            )}
          </Section>

          {/* Impoundment */}
          <Section title="Impoundment" icon={<Package className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MetaRow k="Boxes" v={item.impoundment?.totalBoxes || m.boxesImpounded || '0'} />
              <MetaRow k="Officer" v={item.impoundment?.impoundedBy || m.impoundedBy || '—'} />
              <MetaRow k="Reason" v={item.impoundment?.reason || '—'} />
              <MetaRow
                k="Impoundment Date"
                v={fmtDate(item.impoundment?.impoundmentDate || (m.date as string) || null)}
              />
            </div>
          </Section>
        </div>

        {/* Aside */}
        <aside className="space-y-4 lg:space-y-6">
          <Section title="Dates" icon={<Calendar className="h-4 w-4 text-blue-700 dark:text-blue-300" />}>
            <div className="space-y-2">
              <MetaRow k="Inspection Date" v={fmtDate(m.date || null)} />
              <MetaRow k="Created" v={fmtDateTime(m.createdAt ?? item.createdAt ?? null)} />
            </div>
          </Section>
        </aside>
      </div>
    </main>
  );
}
