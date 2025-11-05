// app/inspection-form/page.tsx
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
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Config — keep secrets server-side in production                     */
/* ------------------------------------------------------------------ */
const YOOLA_API_KEY = "xgpYr222zWMD4w5VIzUaZc5KYO5L1w8N38qBj1qPflwguq9PdJ545NTCSLTS7H00"

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

// Compliance checklist (we define all 20 for future; render 1–10 now)
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

const phoneTokenRe = /^\+?\d{7,15}$/;
const normalizePhones = (raw: string) =>
  raw.split(',').map((p) => p.trim()).filter(Boolean);
const validatePhones = (raw: string) => {
  const tokens = normalizePhones(raw);
  if (tokens.length === 0) return 'Enter at least one phone number';
  for (const t of tokens) if (!phoneTokenRe.test(t)) return `Invalid phone: ${t}`;
  return null;
};

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

// Counter helpers
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

// Error helpers & guarded push
function friendlyError(err: any): string {
  const code: string | undefined =
    err?.code || err?.error?.code || err?.name || (typeof err === 'string' ? err : undefined);
  const msg: string | undefined =
    err?.message || err?.error?.message || (typeof err === 'string' ? err : undefined);

  if (code?.includes('PERMISSION_DENIED') || msg?.toLowerCase().includes('permission')) {
    return 'Permission denied. Your account may not be allowed to write to this path.';
  }
  if (!navigator.onLine) return 'You are offline. Please reconnect to the internet and try again.';
  if (msg?.toLowerCase().includes('network') || code?.toLowerCase().includes('network')) {
    return 'Network error while submitting. Please check your connection and retry.';
  }
  if (msg?.toLowerCase().includes('timeout')) return 'Submission timed out. Connection might be slow—please retry.';
  return msg || 'Unknown error occurred.';
}

async function pushWithGuard(dbRef: ReturnType<typeof ref>, payload: any) {
  if (!navigator.onLine) throw new Error('Offline');
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
        className="w-full flex items-center justify-between px-4 py-3"
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
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange('no')}
        className={`px-3 py-1.5 text-sm border-l border-slate-300 dark:border-slate-700 ${
          value === 'no' ? 'bg-rose-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
        }`}
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

  const [formData, setFormData] = useState({
    date: new Date().toISOString().slice(0, 10),
    docNo: '',
    serialNumber: '',
    drugshopName: '',
    drugshopContactPhones: '',
    boxesImpounded: '',
    impoundedBy: '',
    location: null as Coords,
    locationAddress: '',
    sendSms: true,
  });

  const [lastVisit, setLastVisit] = useState<string>('');
  const [lastLicenseDate, setLastLicenseDate] = useState<string>('');
  const [prevScores, setPrevScores] = useState('');
  const [currentPercentage, setCurrentPercentage] = useState('');

  const [inChargeName, setInChargeName] = useState('');
  const [inChargeContact, setInChargeContact] = useState('');
  const [districtRepPresent, setDistrictRepPresent] = useState(false);
  const [impoundReason, setImpoundReason] = useState<ImpoundReason | ''>('');

  // Compliance checklist answers
  const [outletAnswers, setOutletAnswers] = useState<Record<string, YesNo>>({});

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({
    details: true,
    drugshop: true,
    impound: true,
    outletA: true, // make checklist visible by default
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
      setImpoundReason(p.impoundReason || '');
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
      impoundReason,
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
    impoundReason,
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
      handleChange(
        'locationAddress',
        `Lat ${coords.latitude.toFixed(6)}, Lng ${coords.longitude.toFixed(6)}`
      );
    } catch (e: any) {
      console.error(e);
      alert('Could not determine your location. Please try again.');
    } finally {
      setIsLocating(false);
    }
  }

  /* ---------------- SMS ---------------- */
  async function sendImpoundSms(
    phonesCsv: string,
    payload: {
      serialNumber: string;
      drugshopName: string;
      boxesImpounded: string;
      dateIso: string;
      impoundedBy: string;
    }
  ) {
    const dt = new Date(payload.dateIso);
    const when = isNaN(dt.getTime())
      ? payload.dateIso
      : dt.toLocaleString('en-UG', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
    const message =
      `Dear ${payload.drugshopName || 'Facility'}, ` +
      `${payload.boxesImpounded || '0'} box(es) were impounded on ${when}. ` +
      `Serial: ${payload.serialNumber}. Officer: ${payload.impoundedBy}.`;

    if (!YOOLA_API_KEY) throw new Error('SMS key is not configured.');
    const res = await fetch('https://yoolasms.com/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phonesCsv, message, api_key: YOOLA_API_KEY }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SMS failed (${res.status}): ${text || 'Unknown error'}`);
    }
    return res.json().catch(() => ({}));
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
    if (!validateForm()) {
      const first = document.querySelector('[data-error="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
          // Only saving 1–10 answers for now (the section we render)
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
          reason: impoundReason || '',
        },
      };

      const submissionsRef = ref(db, 'ndachecklists/submissions');
      await pushWithGuard(submissionsRef, payload);

      if (formData.sendSms && boxesNum > 0 && formData.drugshopContactPhones.trim()) {
        try {
          await sendImpoundSms(formData.drugshopContactPhones.trim(), {
            serialNumber: meta.serialNumber,
            drugshopName: meta.drugshopName,
            boxesImpounded: meta.boxesImpounded,
            dateIso: meta.date,
            impoundedBy: meta.impoundedBy,
          });
          alert('Submitted and SMS sent.');
        } catch (smsErr: any) {
          console.warn('SMS error:', smsErr?.message || smsErr);
          setFormErrors((errs) => [...errs, `SMS delivery failed: ${friendlyError(smsErr)}`]);
          alert('Submitted successfully. SMS delivery failed—please retry later.');
        }
      } else {
        alert('Inspection submitted.');
      }

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
      alert(
        `Submission failed.\n\nReason: ${reason}\n\nTip: Ensure you are online and signed in, then try again.`
      );
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
      date: new Date().toISOString().slice(0, 10),
      docNo,
      serialNumber: serialNo,
      drugshopName: '',
      drugshopContactPhones: '',
      boxesImpounded: '',
      impoundedBy: '',
      location: null,
      locationAddress: '',
      sendSms: true,
    });
    setErrors({});
    setFormErrors([]);
    setLastVisit('');
    setLastLicenseDate('');
    setPrevScores('');
    setCurrentPercentage('');
    setInChargeName('');
    setInChargeContact('');
    setDistrictRepPresent(false);
    setImpoundReason('');
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

  return (
    <main className="mx-auto w-full max-w-6xl px-3 sm:px-4 lg:px-6 py-6 sm:py-8">
      {/* Top bar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20 grid place-items-center">
            <ClipboardList className="h-5 w-5 text-blue-800 dark:text-blue-200" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-blue-800 dark:text-blue-200">
              NDA Inspection
            </h1>
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
                        {formData.location.latitude.toFixed(6)},{' '}
                        {formData.location.longitude.toFixed(6)}
                      </span>
                    </div>
                  )}
                </div>
                {!!formData.locationAddress && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formData.locationAddress}
                  </p>
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
                hint="If SMS is enabled and boxes > 0, phones must be valid."
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
                  onChange={(e) =>
                    handleChange('boxesImpounded', e.target.value.replace(/[^\d]/g, ''))
                  }
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
                <label className="text-sm font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-4 w-4" /> Reason
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {IMPOUND_REASONS.map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => setImpoundReason(r)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                        impoundReason === r
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{r}</span>
                      {impoundReason === r ? (
                        <span className="text-blue-700 dark:text-blue-300">Selected</span>
                      ) : null}
                    </button>
                  ))}
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
                  <span>Send SMS to Facility Contact(s) on submit</span>
                </label>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  SMS sent only if <strong>Boxes Impounded &gt; 0</strong> and contact phone(s) are
                  provided.
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
                    onChange={(v) =>
                      setOutletAnswers((s) => (s[it.key] === v ? s : { ...s, [it.key]: v }))
                    }
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
              <KV k="Impound Reason" v={impoundReason || '—'} />
            </dl>
          </Accordion>
        </div>

        {/* Right rail */}
        <aside className="space-y-4 lg:space-y-6">
          {/* Tips */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
            <header className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-blue-700 dark:text-blue-300" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Submission Tips
              </h3>
            </header>
            <ul className="text-xs sm:text-sm space-y-2 text-slate-600 dark:text-slate-400">
              <li>• Capture GPS at the inspection site.</li>
              <li>
                • Prefer <span className="font-mono">+256</span> format for phone numbers.
              </li>
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
