// app/(protected)/inspections/new/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, push, ref, runTransaction } from 'firebase/database';
import primaryApp, { database as primaryDb } from '@/firebase';
import {
  Calendar as CalendarIcon,
  ClipboardList,
  Briefcase,
  Users,
  Package,
  MapPin,
  Crosshair,
  Send,
  RefreshCcw,
  Loader2,
  SunMedium,
  Moon,
  Laptop2,
  Info,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Static data                                                         */
/* ------------------------------------------------------------------ */
type ImpoundReason =
  | 'Unsuitable premises'
  | 'Unqualified personnel'
  | 'Illegal possession of drugs'
  | 'Unlicensed';

const IMPOUND_REASONS: ImpoundReason[] = [
  'Unsuitable premises',
  'Unqualified personnel',
  'Illegal possession of drugs',
  'Unlicensed',
];

// Compliance checklist (20 defined; render 1–10 now)
type YesNo = '' | 'yes' | 'no';
const DRUGOUTLET_ITEMS: { key: string; label: string }[] = [
  { key: '01', label: 'Valid Operating license for current year available?' },
  { key: '02', label: 'Displayed current license & certificate of suitability?' },
  { key: '03', label: 'Attendant qualified & registered?' },
  { key: '04', label: 'Valid annual practicing licenses displayed?' },
  { key: '05', label: 'Evidence of prescription records?' },
  { key: '06', label: 'Permanent building with well-painted walls?' },
  { key: '07', label: 'Proper ceiling (plywood/concrete) present?' },
  { key: '08', label: 'Cemented/tiled floor easy to clean?' },
  { key: '09', label: 'Premises clean & organized?' },
  { key: '10', label: 'Authorized SOPs present (Pharmacies)?' },
  { key: '11', label: 'Shelves not overstocked/congested?' },
  { key: '12', label: 'Light-sensitive products protected from light?' },
  { key: '13', label: 'Designated area for expired/damaged drugs?' },
  { key: '14', label: 'Records for expired/damaged drugs?' },
  { key: '15', label: 'No improper handling/misuse of drugs?' },
  { key: '16', label: 'Temperature & humidity device present?' },
  { key: '17', label: 'Daily temperature records maintained?' },
  { key: '18', label: 'Up-to-date purchase & sales records?' },
  { key: '19', label: 'Functional hand-washing unit available?' },
  { key: '20', label: 'Clear signpost matching NDA license?' },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
type Coords = { latitude: number; longitude: number } | null;
type ThemeMode = 'light' | 'dark' | 'system';

function todayLocalYYYYMMDD() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/* -------- Phone + SMS helpers (UG) -------- */
const ugReCanonical = /^\+2567\d{8}$/;

function splitCsv(s?: string) {
  return (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
function uniqueCsv(arr: string[]) {
  return Array.from(new Set(arr)).join(',');
}

function normalizeUgPhone(p: string) {
  const s = p.replace(/\s+/g, '');
  if (ugReCanonical.test(s)) return s; // +2567XXXXXXXX
  if (/^2567\d{8}$/.test(s)) return `+${s}`; // 2567XXXXXXXX -> +2567XXXXXXXX
  if (/^07\d{8}$/.test(s)) return `+256${s.slice(1)}`; // 07XXXXXXXX -> +2567XXXXXXXX
  return s; // leave as-is; upstream may reject invalids
}

/** Soft validation used for inline field errors only (doesn't over-block submit) */
function validatePhones(raw: string) {
  const tokens = splitCsv(raw);
  if (tokens.length === 0) return 'Enter at least one phone number';
  for (const t of tokens) {
    const norm = normalizeUgPhone(t);
    if (!/^\+?2567\d{8}$|^07\d{8}$/.test(norm)) {
      return `Invalid phone: ${t}`;
    }
  }
  return null;
}

/** Build the impound message (now includes reasons when available) */
function buildImpoundMessage(payload: {
  serialNumber: string;
  drugshopName: string;
  boxesImpounded: string;
  dateIso: string;
  impoundedBy: string;
  reasons?: ImpoundReason[];
}) {
  const dt = new Date(payload.dateIso);
  const when = Number.isNaN(dt.getTime())
    ? payload.dateIso
    : dt.toLocaleString('en-UG', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

  const reasonsText =
    payload.reasons && payload.reasons.length
      ? ` Reasons: ${payload.reasons.join('; ')}.`
      : '';

  return (
    `Dear ${payload.drugshopName || 'Facility'}, ` +
    `${payload.boxesImpounded || '0'} box(es) were impounded on ${when}. ` +
    `Serial: ${payload.serialNumber}. Officer: ${payload.impoundedBy}.` +
    reasonsText
  );
}

/** Same contract as detail page helper (POST /api/sms) */
async function sendSms(toPhonesCsv: string, message: string) {
  const normalized = splitCsv(toPhonesCsv).map(normalizeUgPhone);
  const recipients = uniqueCsv(normalized);
  const r = await fetch('/api/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: recipients, message }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`SMS failed (${r.status}): ${text || 'Unknown error'}`);
  }
  return r.json().catch(() => ({}));
}

/* -------- Theme -------- */
function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'system') {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', !!prefersDark);
  } else {
    root.classList.toggle('dark', mode === 'dark');
  }
}
function useTheme() {
  const [mode, setMode] = useState<ThemeMode>('system');
  useEffect(() => {
    const stored = (localStorage.getItem('theme-mode') as ThemeMode) || 'system';
    setMode(stored);
    applyTheme(stored);
    const mm = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => {
      const current = (localStorage.getItem('theme-mode') as ThemeMode) || 'system';
      if (current === 'system') applyTheme('system');
    };
    mm?.addEventListener?.('change', onChange);
    return () => mm?.removeEventListener?.('change', onChange);
  }, []);
  const update = (val: ThemeMode) => {
    localStorage.setItem('theme-mode', val);
    setMode(val);
    applyTheme(val);
  };
  return { mode, setMode: update };
}

/* -------- Counters -------- */
const formatDoc = (n: number) => `DOC${String(n).padStart(7, '0')}`;
const formatSerial = (n: number) => `SN${String(n).padStart(6, '0')}`;
async function reserveNumbers(db: ReturnType<typeof getDatabase>) {
  const countersRef = ref(db, 'ndachecklists/counters');
  const { committed, snapshot } = await runTransaction(countersRef, (curr: any) => {
    const doc = (curr?.doc ?? 0) + 1;
    const serial = (curr?.serial ?? 0) + 1;
    return { doc, serial };
  });
  if (!committed) throw new Error('Could not reserve numbers');
  const { doc, serial } = snapshot.val() as { doc: number; serial: number };
  return { docNo: formatDoc(doc), serialNo: formatSerial(serial) };
}

/* -------- Error helpers & guarded push -------- */
function friendlyError(err: any): string {
  const code: string | undefined =
    err?.code || err?.error?.code || err?.name || (typeof err === 'string' ? err : undefined);
  const msg: string | undefined =
    err?.message || err?.error?.message || (typeof err === 'string' ? err : undefined);

  if (code?.includes('PERMISSION_DENIED') || msg?.toLowerCase().includes('permission')) {
    return 'Permission denied. Your account may not be allowed to write to this path.';
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return 'You are offline. Please reconnect and try again.';
  if (msg?.toLowerCase().includes('timeout')) return 'Timed out. Connection might be slow—please retry.';
  if (msg?.toLowerCase().includes('network') || code?.toLowerCase().includes('network')) {
    return 'Network error while sending request.';
  }
  return msg || 'Unknown error occurred.';
}

async function pushWithGuard(dbRef: ReturnType<typeof ref>, payload: any) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Offline');
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout: push took too long')), 20000)
  );
  return await Promise.race([push(dbRef, payload), timeout]);
}

/* ------------------------------------------------------------------ */
/* Small UI Atoms                                                      */
/* ------------------------------------------------------------------ */
const Accordion = React.memo(function Accordion({
  id,
  title,
  icon,
  badge,
  children,
  open,
  toggleOpen,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  toggleOpen: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => toggleOpen(id)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm sm:text-base font-semibold text-blue-800 dark:text-blue-200">{title}</h2>
        </div>
        <div className="flex items-center gap-3">
          {badge}
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>
      {open && <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>}
    </section>
  );
});

const Field = React.memo(function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const hasError = !!error;
  return (
    <div data-error={hasError || undefined}>
      <label className="text-sm font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-1">
        <span>{label}</span>
      </label>
      <div className={hasError ? 'rounded-xl ring-2 ring-rose-400/70' : 'rounded-xl'}>{children}</div>
      {hint ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : <p className="h-0 text-xs" />}
      {hasError ? <p className="mt-1 text-xs text-rose-600">{error}</p> : <p className="h-0 text-xs" />}
    </div>
  );
});

const KV = React.memo(function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className="truncate">{v}</dd>
    </div>
  );
});

const ThemeButton = React.memo(function ThemeButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm',
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
      ].join(' ')}
      aria-pressed={active}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
});

const YesNoToggle = React.memo(function YesNoToggle({
  value,
  onChange,
}: {
  value: YesNo;
  onChange: (v: YesNo) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Yes or No"
      className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => onChange('yes')}
        className={`px-3 py-1.5 text-sm ${
          value === 'yes' ? 'bg-emerald-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
        }`}
        aria-pressed={value === 'yes'}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange('no')}
        className={`px-3 py-1.5 text-sm border-l border-slate-300 dark:border-slate-700 ${
          value === 'no' ? 'bg-rose-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
        }`}
        aria-pressed={value === 'no'}
      >
        No
      </button>
    </div>
  );
});

const Row = React.memo(function Row({
  idx,
  label,
  children,
}: {
  idx: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
        <span className="text-blue-700 dark:text-blue-300 font-bold mr-1">{idx}</span>
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function InspectionFormPage() {
  const db = primaryDb ?? getDatabase(primaryApp);
  const auth = getAuth(primaryApp);
  const router = useRouter();
  const { mode, setMode } = useTheme();

  const [authChecking, setAuthChecking] = useState(true);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [lastSmsResult, setLastSmsResult] = useState<any | null>(null);

  const [formData, setFormData] = useState({
    date: todayLocalYYYYMMDD(), // auto-filled to today; user can adjust
    docNo: '',
    serialNumber: '',
    drugshopName: '',
    drugshopContactPhones: '',
    sendSms: true,
    boxesImpounded: '',
    impoundedBy: '',
    location: null as Coords,
    locationAddress: '',
  });

  const [lastVisit, setLastVisit] = useState<string>('');
  const [lastLicenseDate, setLastLicenseDate] = useState<string>('');
  const [prevScores, setPrevScores] = useState('');
  const [currentPercentage, setCurrentPercentage] = useState('');

  const [inChargeName, setInChargeName] = useState('');
  const [inChargeContact, setInChargeContact] = useState('');
  const [districtRepPresent, setDistrictRepPresent] = useState(false);

  const [impoundReasons, setImpoundReasons] = useState<ImpoundReason[]>([]);
  const [outletAnswers, setOutletAnswers] = useState<Record<string, YesNo>>({});

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({
    details: true,
    drugshop: true,
    impound: true,
    outletA: true,
    visitSig: true,
    review: true,
  });

  const handleChange = useCallback(
    <T extends keyof typeof formData>(key: T, value: (typeof formData)[T]) => {
      setFormData((p) => (Object.is(p[key], value) ? p : { ...p, [key]: value }));
      if (errors[key as string]) setErrors((e) => ({ ...e, [key]: '' }));
    },
    [errors]
  );
  const toggleOpen = useCallback((id: string) => {
    setOpen((s) => ({ ...s, [id]: !s[id] }));
  }, []);

  // Auth guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user || !user.uid) {
        router.replace('/login');
        return;
      }
      setAuthChecking(false);
    });
    return unsub;
  }, [auth, router]);

  // Autosave restore
  useEffect(() => {
    const raw = localStorage.getItem('inspection-autosave');
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      setFormData((v) => ({ ...v, ...(p.formData || {}) }));
      setLastVisit(p.lastVisit || '');
      setLastLicenseDate(p.lastLicenseDate || '');
      setPrevScores(p.prevScores || '');
      setCurrentPercentage(p.currentPercentage || '');
      setInChargeName(p.inChargeName || '');
      setInChargeContact(p.inChargeContact || '');
      setDistrictRepPresent(!!p.districtRepPresent);
      setImpoundReasons(p.impoundReasons || []);
      setOutletAnswers(p.outletAnswers || {});
    } catch {}
  }, []);

  // Autosave persist
  useEffect(() => {
    const payload = {
      formData,
      lastVisit,
      lastLicenseDate,
      prevScores,
      currentPercentage,
      inChargeName,
      inChargeContact,
      districtRepPresent,
      impoundReasons,
      outletAnswers,
    };
    localStorage.setItem('inspection-autosave', JSON.stringify(payload));
  }, [
    formData,
    lastVisit,
    lastLicenseDate,
    prevScores,
    currentPercentage,
    inChargeName,
    inChargeContact,
    districtRepPresent,
    impoundReasons,
    outletAnswers,
  ]);

  // Reserve numbers initially
  useEffect(() => {
    (async () => {
      if (!formData.docNo || !formData.serialNumber) {
        try {
          const { docNo, serialNo } = await reserveNumbers(db);
          setFormData((p) => ({ ...p, docNo, serialNumber: serialNo }));
        } catch (e) {
          console.error('Number reservation failed', e);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global safety net
  useEffect(() => {
    function onUnhandledRejection(e: PromiseRejectionEvent) {
      console.error('Unhandled rejection:', e.reason);
      setFormErrors((errs) => [...errs, `Unexpected error: ${friendlyError(e.reason)}`]);
      alert(`Unexpected error: ${friendlyError(e.reason)}`);
    }
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection);
  }, []);

  const boxesNum = useMemo(
    () => (formData.boxesImpounded ? parseInt(formData.boxesImpounded, 10) || 0 : 0),
    [formData.boxesImpounded]
  );

  /* ---------------- Location ---------------- */
  async function captureLocation() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by this browser.');
      return;
    }
    setIsLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });
      const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      handleChange('location', coords);
      handleChange('locationAddress', `Lat ${coords.latitude.toFixed(6)}, Lng ${coords.longitude.toFixed(6)}`);
    } catch (e: any) {
      console.error(e);
      alert('Could not determine your location. Please try again.');
    } finally {
      setIsLocating(false);
    }
  }

  /* ---------------- Validation & Submit ---------------- */
  function validateForm() {
    const next: Record<string, string> = {};
    const summary: string[] = [];
    let ok = true;

    if (!formData.drugshopName?.trim()) {
      next.drugshopName = 'This field is required';
      summary.push('facilityName: required');
      ok = false;
    }

    if (formData.boxesImpounded && !/^\d+$/.test(formData.boxesImpounded.trim())) {
      next.boxesImpounded = 'Enter a valid number';
      summary.push('boxesImpounded: must be a number');
      ok = false;
    }

    if (formData.sendSms && boxesNum > 0) {
      const err = validatePhones(formData.drugshopContactPhones || '');
      if (err) {
        next.drugshopContactPhones = err;
        summary.push(`Phones: ${err}`);
        ok = false;
      }
    }

    setErrors(next);
    setFormErrors(summary);
    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLastSmsResult(null);

    if (!validateForm()) {
      const first = document.querySelector('[data-error="true"]');
      (first as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setIsSubmitting(true);
    try {
      const meta = {
        docNo: formData.docNo,
        date: new Date(formData.date).toISOString(),
        serialNumber: (formData.serialNumber || '').trim(),
        source: 'web',
        drugshopName: (formData.drugshopName || '').trim(),
        drugshopContactPhones: (formData.drugshopContactPhones || '').trim(),
        boxesImpounded: (formData.boxesImpounded || '').trim(),
        impoundedBy: (formData.impoundedBy || '').trim(),
        location: formData.location
          ? {
              coordinates: {
                latitude: formData.location.latitude,
                longitude: formData.location.longitude,
              },
              formattedAddress: (formData.locationAddress || '').trim(),
            }
          : null,
        status: 'submitted',
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.email || 'anonymous',
      };

      const payload = {
        meta,
        outlet: {
          answers: Object.fromEntries(
            DRUGOUTLET_ITEMS.slice(0, 10).map((q) => [q.key, outletAnswers[q.key] || ''])
          ),
        },
        visit: {
          lastVisit: lastVisit ? new Date(lastVisit).toISOString() : null,
          lastLicenseDate: lastLicenseDate ? new Date(lastLicenseDate).toISOString() : null,
          prevScores,
          currentPercentage,
          inChargeName,
          inChargeContact,
          isDistrictRepPresent: districtRepPresent,
        },
        impoundment: {
          totalBoxes: (formData.boxesImpounded || '').trim(),
          impoundedBy: (formData.impoundedBy || '').trim(),
          impoundmentDate: new Date(formData.date).toISOString(),
          reasons: impoundReasons,
        },
      };

      const submissionsRef = ref(db, 'ndachecklists/submissions');
      await pushWithGuard(submissionsRef, payload);

      // -------- SMS Notification (includes reasons) --------
      if (formData.sendSms && boxesNum > 0 && formData.drugshopContactPhones.trim()) {
        try {
          const msg = buildImpoundMessage({
            serialNumber: meta.serialNumber,
            drugshopName: meta.drugshopName,
            boxesImpounded: meta.boxesImpounded,
            dateIso: meta.date,
            impoundedBy: meta.impoundedBy,
            reasons: impoundReasons, // <-- include reasons
          });
          const smsRes = await sendSms(formData.drugshopContactPhones.trim(), msg);
          setLastSmsResult(smsRes);
        } catch (smsErr: any) {
          console.warn('SMS error:', smsErr?.message || smsErr);
          setFormErrors((errs) => [...errs, `SMS delivery failed: ${friendlyError(smsErr)}`]);
        }
      }

      alert('Inspection submitted.');
      localStorage.removeItem('inspection-autosave');
      await hardReset();
    } catch (err: any) {
      console.error('Submission failed:', err);
      const reason = friendlyError(err);
      setFormErrors([
        'Submission failed.',
        `Reason: ${reason}`,
        'Tip: Ensure you are online and signed in. If the problem continues, contact the admin to check Firebase rules.',
      ]);
      alert(`Submission failed.\n\nReason: ${reason}\n\nTip: Ensure you are online and signed in, then try again.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function hardReset() {
    let docNo = formData.docNo;
    let serialNo = formData.serialNumber;
    try {
      const r = await reserveNumbers(db);
      docNo = r.docNo;
      serialNo = r.serialNo;
    } catch (e) {
      console.warn('Could not reserve new numbers on reset.', e);
    }

    setFormData({
      date: todayLocalYYYYMMDD(),
      docNo,
      serialNumber: serialNo,
      drugshopName: '',
      drugshopContactPhones: '',
      sendSms: true,
      boxesImpounded: '',
      impoundedBy: '',
      location: null,
      locationAddress: '',
    });
    setErrors({});
    setFormErrors([]);
    setLastSmsResult(null);
    setLastVisit('');
    setLastLicenseDate('');
    setPrevScores('');
    setCurrentPercentage('');
    setInChargeName('');
    setInChargeContact('');
    setDistrictRepPresent(false);
    setImpoundReasons([]);
    setOutletAnswers({});
  }

  if (authChecking) {
    return (
      <main className="min-h-[60vh] grid place-items-center px-4">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Checking session…</span>
        </div>
      </main>
    );
  }

  /* ---------------- UI ---------------- */
  return (
    <main className="mx-auto w-full max-w-6xl px-3 sm:px-4 lg:px-6 py-6 sm:py-8">
      {/* Top bar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20 grid place-items-center">
            <ClipboardList className="h-5 w-5 text-blue-800 dark:text-blue-200" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-blue-800 dark:text-blue-200">NDA Inspection</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Complete the remaining sections, then submit.
            </p>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
          <ThemeButton active={mode === 'light'} onClick={() => setMode('light')} label="Light" icon={<SunMedium className="h-4 w-4" />} />
          <ThemeButton active={mode === 'system'} onClick={() => setMode('system')} label="System" icon={<Laptop2 className="h-4 w-4" />} />
          <ThemeButton active={mode === 'dark'} onClick={() => setMode('dark')} label="Dark" icon={<Moon className="h-4 w-4" />} />
        </div>
      </div>

      {/* Error summary banner */}
      {formErrors.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <p className="font-semibold">Please fix the following:</p>
              <ul className="list-disc ms-5">
                {formErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Success banner (SMS) */}
      {lastSmsResult?.ok && lastSmsResult?.data?.status === 'success' && (
        <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-200">
          <div className="flex items-start gap-2">
            <MessageSquare className="h-4 w-4 mt-0.5" />
            <div>
              <p className="font-semibold">SMS sent successfully.</p>
              <p className="text-xs mt-1">
                Recipients: <b>{lastSmsResult.data.recipients}</b> · Credits used: <b>{lastSmsResult.data.credits_used}</b>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Left / main */}
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          {/* Inspection Details */}
          <Accordion
            id="details"
            title="Inspection Details"
            icon={<CalendarIcon className="h-4 w-4 text-blue-700 dark:text-blue-300" />}
            open={open.details}
            toggleOpen={toggleOpen}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Inspection Date" error={errors.date}>
                <input
                  type="date"
                  value={formData.date}
                  max={todayLocalYYYYMMDD()}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                />
              </Field>

              <Field label="Inspection Location" error={errors.location}>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={captureLocation}
                    disabled={isLocating}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-800 text-white px-3 py-2 text-sm disabled:opacity-60"
                    aria-busy={isLocating}
                  >
                    {isLocating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Capturing…
                      </>
                    ) : (
                      <>
                        <Crosshair className="h-4 w-4" /> Capture Location
                      </>
                    )}
                  </button>
                  {formData.location && (
                    <div className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-blue-700 dark:text-blue-300" />
                      <span>
                        {formData.location.latitude.toFixed(6)}, {formData.location.longitude.toFixed(6)}
                      </span>
                    </div>
                  )}
                </div>
                {!!formData.locationAddress && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formData.locationAddress}</p>
                )}
              </Field>
            </div>
          </Accordion>

          {/* Facility */}
          <Accordion
            id="drugshop"
            title="Drug Facility Information"
            icon={<Briefcase className="h-4 w-4 text-blue-700 dark:text-blue-300" />}
            open={open.drugshop}
            toggleOpen={toggleOpen}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Facility Name *" error={errors.drugshopName}>
                <input
                  value={formData.drugshopName}
                  onChange={(e) => handleChange('drugshopName', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="Facility name"
                />
              </Field>

              <Field
                label="Facility Contact Phone(s) (comma-separated)"
                hint="If SMS is enabled and boxes > 0, phones must be valid (e.g., +2567…, 2567…, 07…)."
                error={errors.drugshopContactPhones}
              >
                <input
                  value={formData.drugshopContactPhones}
                  onChange={(e) => handleChange('drugshopContactPhones', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="+2567..., 07..., 2567..."
                />
              </Field>
            </div>
          </Accordion>

          {/* Impound */}
          <Accordion
            id="impound"
            title="Impound Information"
            icon={<Package className="h-4 w-4 text-blue-700 dark:text-blue-300" />}
            open={open.impound}
            toggleOpen={toggleOpen}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Boxes Impounded" error={errors.boxesImpounded}>
                <input
                  value={formData.boxesImpounded}
                  onChange={(e) => handleChange('boxesImpounded', e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="e.g., 2"
                  inputMode="numeric"
                />
              </Field>

              <Field label="Impounded By" error={errors.impoundedBy}>
                <input
                  value={formData.impoundedBy}
                  onChange={(e) => handleChange('impoundedBy', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="Officer name"
                />
              </Field>

              <div className="col-span-1 sm:col-span-2">
                <label className="flex items-center gap-2 mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <ShieldCheck className="h-4 w-4" /> Reasons (select all that apply)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {IMPOUND_REASONS.map((r) => {
                    const active = impoundReasons.includes(r);
                    return (
                      <button
                        type="button"
                        key={r}
                        onClick={() =>
                          setImpoundReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
                        }
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                          active
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                        aria-pressed={active}
                        aria-label={`Reason: ${r}`}
                      >
                        <span>{r}</span>
                        {active ? <span className="text-blue-700 dark:text-blue-300">Selected</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="flex items-start sm:items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={formData.sendSms}
                    onChange={(e) => handleChange('sendSms', e.target.checked)}
                    className="h-4 w-4 mt-0.5"
                  />
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="h-4 w-4" /> Send SMS to Facility Contact(s) on submit
                  </span>
                </label>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  SMS is sent only if <strong>Boxes Impounded &gt; 0</strong> and valid contact numbers are provided.
                </p>
              </div>
            </div>
          </Accordion>

          {/* Compliance Checklist (Items 1–10) */}
          <Accordion
            id="outletA"
            title="Drug Outlet — Compliance Checklist (Items 1–10)"
            icon={<ClipboardList className="h-4 w-4 text-blue-700 dark:text-blue-300" />}
            open={open.outletA}
            toggleOpen={toggleOpen}
          >
            <div className="space-y-3">
              {DRUGOUTLET_ITEMS.slice(0, 10).map((it) => (
                <Row key={it.key} idx={it.key} label={it.label}>
                  <YesNoToggle
                    value={outletAnswers[it.key] || ''}
                    onChange={(v) => setOutletAnswers((s) => (s[it.key] === v ? s : { ...s, [it.key]: v }))}
                  />
                </Row>
              ))}
            </div>
          </Accordion>

          {/* Visit & Signatures */}
          <Accordion
            id="visitSig"
            title="Visit & License History + Signatures"
            icon={<Users className="h-4 w-4 text-blue-700 dark:text-blue-300" />}
            open={open.visitSig}
            toggleOpen={toggleOpen}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Date of Last Visit">
                <input
                  type="date"
                  value={lastVisit}
                  onChange={(e) => setLastVisit(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Last License Issue Date">
                <input
                  type="date"
                  value={lastLicenseDate}
                  onChange={(e) => setLastLicenseDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Previous Visit Scores">
                <input
                  value={prevScores}
                  onChange={(e) => setPrevScores(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Optional"
                />
              </Field>
              <Field label="Current Percentage Score">
                <input
                  value={currentPercentage}
                  onChange={(e) => setCurrentPercentage(e.target.value.replace(/[^\d.]/g, ''))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Optional (e.g., 78)"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <Field label="In-charge / Attendant Name">
                <input
                  value={inChargeName}
                  onChange={(e) => setInChargeName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Optional"
                />
              </Field>
              <Field label="In-charge Contact">
                <input
                  value={inChargeContact}
                  onChange={(e) => setInChargeContact(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  placeholder="07xx xxx xxx"
                />
              </Field>
            </div>

            <div className="mt-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={districtRepPresent}
                  onChange={(e) => setDistrictRepPresent(e.target.checked)}
                  className="h-4 w-4"
                />
                District Representative was present during inspection
              </label>
            </div>
          </Accordion>

          {/* Review quick summary */}
          <Accordion
            id="review"
            title="Quick Summary"
            icon={<Info className="h-4 w-4 text-blue-700 dark:text-blue-300" />}
            open={open.review}
            toggleOpen={toggleOpen}
          >
            <dl className="text-xs sm:text-sm grid grid-cols-1 gap-2 text-slate-700 dark:text-slate-300">
              <KV k="Date" v={formData.date || '—'} />
              <KV k="Facility" v={formData.drugshopName || '—'} />
              <KV k="Boxes" v={String(boxesNum || 0)} />
              <KV k="Officer" v={formData.impoundedBy || '—'} />
              <KV k="Phones" v={formData.drugshopContactPhones || '—'} />
              <KV k="Notify (SMS)" v={formData.sendSms ? 'Yes' : 'No'} />
            </dl>
          </Accordion>
        </div>

        {/* Right rail */}
        <aside className="space-y-4 lg:space-y-6">
          {/* Tips */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
            <header className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-blue-700 dark:text-blue-300" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Submission Tips</h3>
            </header>
            <ul className="text-xs sm:text-sm space-y-2 text-slate-600 dark:text-slate-400">
              <li>• Capture GPS at the inspection site.</li>
              <li>• Prefer <span className="font-mono">+256</span> format for phone numbers.</li>
              <li>• Double-check serial number and officer names.</li>
            </ul>
          </section>

          {/* Actions */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('inspection-autosave');
                  hardReset();
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-blue-800 dark:text-blue-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <RefreshCcw className="h-4 w-4" />
                Reset
              </button>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-800 text-white px-5 py-2.5 disabled:opacity-70"
              aria-busy={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                </>
              ) : (
                <>
                  Submit Report <Send className="h-4 w-4" />
                </>
              )}
            </button>
          </section>
        </aside>
      </form>
    </main>
  );
}
