// app/(protected)/inspections/[id]/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  getDatabase,
  ref,
  onValue,
  DataSnapshot,
  update,
} from 'firebase/database';
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
  CheckCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type FacilityType = 'Human' | 'Veterinary' | 'Public' | 'Private';
type Coords = { latitude: number | string; longitude: number | string };
type BoxStatus = 'Not yet in store' | 'In Store' | 'Released';

type ReleaseForm = {
  releaseDate: string;
  clientName: string;
  telephone: string;
  releasedBy: string;
  comment: string;
  boxesReleased: string;
};

type Inspection = {
  id?: string;
  meta?: {
    docNo?: string;
    date?: string; // ISO
    serialNumber?: string;
    source?: 'web' | 'mobile' | string;
    drugshopName?: string;
    facilityName?: string;
    drugshopContactPhones?: string;
    boxesImpounded?: string;
    impoundedBy?: string;
    location?: { coordinates?: Coords; formattedAddress?: string } | null;
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
    boxStatus?: BoxStatus;
  };
  releaseRecord?: ReleaseForm;
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

/* Phone normalization (UG) */
const ugReCanonical = /^\+2567\d{8}$/;
function normalizeUgPhone(p: string) {
  const s = p.replace(/\s+/g, '');
  if (ugReCanonical.test(s)) return s;
  if (/^2567\d{8}$/.test(s)) return `+${s}`;
  if (/^07\d{8}$/.test(s)) return `+256${s.slice(1)}`;
  return s;
}

/* ------------------------------------------------------------------ */
/* SMS helpers (always via secure backend /api/sms)                    */
/* ------------------------------------------------------------------ */
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

function splitCsv(s?: string) {
  return (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
function uniqueCsv(arr: string[]) {
  return Array.from(new Set(arr)).join(',');
}
function collectOwnerPhones(item: Inspection, extra?: string) {
  const base = splitCsv(item?.meta?.drugshopContactPhones);
  const plus = extra ? [extra] : [];
  const normalized = [...base, ...plus].map(normalizeUgPhone).filter(Boolean);
  return uniqueCsv(normalized);
}

/* Message builders */
function buildInStoreMessage(item: Inspection) {
  const m = item.meta || {};
  const imp = item.impoundment || {};
  const shop = m.facilityName || m.drugshopName || 'Facility';
  const boxes = imp.totalBoxes || m.boxesImpounded || '0';
  const when = fmtDate(imp.impoundmentDate || (m.date as string) || null);
  const ref = m.serialNumber || item.id || '';
  return `Dear ${shop}, your impounded drugs (${boxes} box(es)) are now IN STORE as of ${when}. Ref: ${ref}.`;
}

function buildReleaseMessage(item: Inspection, form: ReleaseForm) {
  const m = item.meta || {};
  const shop = m.facilityName || m.drugshopName || 'Facility';
  const ref = m.serialNumber || item.id || '';
  const note = form.comment ? ` Note: ${form.comment}.` : '';
  return `Dear ${shop}, your impounded drugs (${form.boxesReleased} box(es)) were RELEASED on ${fmtDate(form.releaseDate)}. Ref: ${ref}.${note}`;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
const BOX_STATUS_OPTIONS: BoxStatus[] = ['Not yet in store', 'In Store', 'Released'];

export default function InspectionDetailPage() {
  const params = useParams();
  const rawId = params?.['id'];
  const id = Array.isArray(rawId) ? rawId[0] : (rawId as string | undefined);

  const router = useRouter();
  const db = primaryDb ?? getDatabase(primaryApp);

  const [item, setItem] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Status editing
  const currentStatus: BoxStatus = useMemo(
    () => (item?.impoundment?.boxStatus as BoxStatus) || 'Not yet in store',
    [item?.impoundment?.boxStatus]
  );
  const [statusDraft, setStatusDraft] = useState<BoxStatus>('Not yet in store');
  const [savingStatus, setSavingStatus] = useState(false);

  // Release modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ReleaseForm>({
    releaseDate: '',
    clientName: '',
    telephone: '',
    releasedBy: '',
    comment: '',
    boxesReleased: '',
  });
  const [consent, setConsent] = useState(false);
  const [releasing, setReleasing] = useState(false);

  // Sync
  useEffect(() => {
    if (!id) return;
    const r = ref(db, `ndachecklists/submissions/${id}`);
    const unsub = onValue(
      r,
      (snap: DataSnapshot) => {
        const v = (snap.val() as Inspection | null) || null;
        if (v) v.id = id;
        setItem(v);
        setStatusDraft((v?.impoundment?.boxStatus as BoxStatus) || 'Not yet in store');
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

  // Save status & notify when moved to "In Store"
  async function saveBoxStatus() {
    if (!id || !item) return;

    // Can't change anything once Released
    if (currentStatus === 'Released') {
      alert('Status is Released and cannot be changed.');
      setStatusDraft('Released');
      return;
    }

    // Force using the Release modal for Released
    if (statusDraft === 'Released') {
      alert('Use the Release button to complete release workflow and notify the client.');
      setStatusDraft(currentStatus);
      return;
    }

    setSavingStatus(true);
    try {
      // 1) Update status
      await update(ref(db, `ndachecklists/submissions/${id}/impoundment`), {
        boxStatus: statusDraft,
      });

      // 2) Notify owner if status became "In Store"
      if (statusDraft === 'In Store') {
        const toCsv = collectOwnerPhones(item);
        if (toCsv) {
          const msg = buildInStoreMessage({
            ...(item as Inspection),
            impoundment: { ...(item.impoundment || {}), boxStatus: 'In Store' },
          });
          try {
            await sendSms(toCsv, msg);
            alert('Status saved. Owner notified (In Store).');
          } catch (e: any) {
            console.warn('SMS In Store error:', e?.message || e);
            alert(`Status saved, but SMS failed: ${e?.message || 'Unknown error'}`);
          }
        }
      }
    } finally {
      setSavingStatus(false);
    }
  }

  // Validate release form
  function validateRelease() {
    const errs: string[] = [];
    if (!form.releaseDate) errs.push('Release Date is required');
    if (!form.clientName.trim()) errs.push('Client Name is required');
    if (!form.telephone.trim()) errs.push('Telephone is required');
    if (!form.releasedBy.trim()) errs.push('Released By is required');
    if (!form.boxesReleased.trim() || !/^\d+$/.test(form.boxesReleased)) errs.push('Boxes Released must be a number');
    if (!consent) errs.push('Consent is required');
    return errs;
  }

  // Release workflow: SMS → update DB to Released (irreversible)
  async function handleReleaseSubmit() {
    const errors = validateRelease();
    if (errors.length) {
      alert('Fix the following:\n• ' + errors.join('\n• '));
      return;
    }
    if (!id || !item) return;

    setReleasing(true);
    try {
      // Recipients = stored facility phones + (optional) phone entered in modal
      const toCsv = collectOwnerPhones(item, form.telephone);
      if (!toCsv) throw new Error('No facility contact phone available.');

      const msg = buildReleaseMessage(item, form);

      // 1) SMS must succeed first
      await sendSms(toCsv, msg);

      // 2) Update: set to Released (irreversible) + save release record
      await update(ref(db, `ndachecklists/submissions/${id}`), {
        'impoundment/boxStatus': 'Released',
        releaseRecord: form,
      });

      alert('Released and SMS sent.');
      setShowModal(false);
      setConsent(false);
    } catch (e: any) {
      console.error('release error', e);
      alert(`Release failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setReleasing(false);
    }
  }

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
  const imp = item.impoundment ?? {};
  const title = m.facilityName || m.drugshopName || 'Inspection';

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
              Document: {m.docNo || item.id} • Created: {fmtDateTime(m.createdAt ?? item.createdAt ?? null)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {imp.boxStatus === 'In Store' && (
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm"
            >
              <CheckCircle className="h-4 w-4" />
              Release
            </button>
          )}

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
              <MetaRow k="Boxes" v={imp.totalBoxes || m.boxesImpounded || '0'} />
              <MetaRow k="Officer" v={imp.impoundedBy || m.impoundedBy || '—'} />
              <MetaRow k="Reason" v={imp.reason || '—'} />
              <MetaRow
                k="Impoundment Date"
                v={fmtDate(imp.impoundmentDate || (m.date as string) || null)}
              />
              <MetaRow k="Box Status" v={imp.boxStatus || 'Not yet in store'} />
            </div>

            {/* Status editor — hidden & guarded when Released */}
            {currentStatus !== 'Released' && (
              <div className="mt-4 flex items-center gap-2">
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value as BoxStatus)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {BOX_STATUS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <button
                  onClick={saveBoxStatus}
                  disabled={savingStatus}
                  className="bg-blue-700 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-70"
                >
                  {savingStatus ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}

            {/* Existing release record (if any) */}
            {item.releaseRecord && (
              <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <p className="text-sm font-semibold mb-2">Release Record</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <MetaRow k="Date" v={fmtDate(item.releaseRecord.releaseDate)} />
                  <MetaRow k="Client" v={item.releaseRecord.clientName} />
                  <MetaRow k="Telephone" v={item.releaseRecord.telephone} />
                  <MetaRow k="Released By" v={item.releaseRecord.releasedBy} />
                  <MetaRow k="Boxes Released" v={item.releaseRecord.boxesReleased} />
                  <MetaRow k="Comment" v={item.releaseRecord.comment || '—'} />
                </div>
              </div>
            )}
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

      {/* Release Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-xl shadow-lg flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="px-6 pt-5 pb-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                Release Drugs
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Complete the form to release. This action is final and cannot be reversed.
              </p>
            </div>

            {/* Body (scrollable) */}
            <div className="px-6 py-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <input
                    type="date"
                    value={form.releaseDate}
                    onChange={(e) => setForm((p) => ({ ...p, releaseDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Client Name</label>
                  <input
                    value={form.clientName}
                    onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="e.g., John Doe"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Telephone Number</label>
                  <input
                    value={form.telephone}
                    onChange={(e) => setForm((p) => ({ ...p, telephone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="+2567… or 07…"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Released By</label>
                  <input
                    value={form.releasedBy}
                    onChange={(e) => setForm((p) => ({ ...p, releasedBy: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Officer Name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Boxes Released</label>
                  <input
                    value={form.boxesReleased}
                    onChange={(e) => setForm((p) => ({ ...p, boxesReleased: e.target.value.replace(/[^\d]/g, '') }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="e.g., 2"
                    inputMode="numeric"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium">Comment</label>
                  <textarea
                    value={form.comment}
                    onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    rows={3}
                    placeholder="Optional note"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm mt-3">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I confirm and consent to release these drugs. This cannot be reversed.
              </label>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
                disabled={releasing}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReleaseSubmit}
                disabled={releasing || !consent}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-70"
              >
                {releasing ? 'Releasing…' : 'Confirm Release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
