// app/inspection-form/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, push, ref } from 'firebase/database';
import primaryApp, { database as primaryDb } from '@/firebase';
import {
  Calendar as CalendarIcon,
  ClipboardList,
  Hash,
  Briefcase,
  Users,
  Package,
  User as UserIcon,
  MapPin,
  Crosshair,
  Send,
  RefreshCcw,
  Loader2,
  SunMedium,
  Moon,
  Laptop2,
  Info,
} from 'lucide-react';

/** ---- Config ---- **/
const YOOLA_API_KEY = 'xgpYr222zWMD4w5VIzUaZc5KYO5L1w8N38qBj1qPflwguq9PdJ545NTCSLTS7H00'; // ⚠️ move to server env in production

/** ---- Types/Utils ---- **/
type Coords = { latitude: number; longitude: number } | null;

const phoneTokenRe = /^\+?\d{7,15}$/;

function normalizePhones(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function validatePhones(raw: string): string | null {
  const tokens = normalizePhones(raw);
  if (tokens.length === 0) return 'Enter at least one phone number';
  for (const t of tokens) if (!phoneTokenRe.test(t)) return `Invalid phone: ${t}`;
  return null;
}

/** ---- Theme helpers (no deps) ---- **/
type ThemeMode = 'light' | 'dark' | 'system';

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

/** ---- Component ---- **/
export default function InspectionFormPage() {
  const db = primaryDb ?? getDatabase(primaryApp);
  const auth = getAuth(primaryApp);
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().slice(0, 10), // yyyy-mm-dd
    serialNumber: '',
    drugshopName: '',
    drugshopContactPhones: '',
    boxesImpounded: '',
    impoundedBy: '',
    location: null as Coords,
    locationAddress: '',
    sendSms: true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mode, setMode } = useTheme();

  // auth guard
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

  function handleChange<T extends keyof typeof formData>(key: T, value: (typeof formData)[T]) {
    setFormData((p) => ({ ...p, [key]: value }));
    if (errors[key as string]) setErrors((e) => ({ ...e, [key]: '' }));
  }

  const boxesNum = useMemo(
    () => (formData.boxesImpounded ? parseInt(formData.boxesImpounded, 10) || 0 : 0),
    [formData.boxesImpounded]
  );

  function validateForm() {
    const next: Record<string, string> = {};
    let ok = true;

    const req: (keyof typeof formData)[] = [
      'serialNumber',
      'drugshopName',
      'boxesImpounded',
      'impoundedBy',
      'location',
    ];

    req.forEach((k) => {
      // @ts-ignore
      if (!formData[k]) {
        next[k as string] = 'This field is required';
        ok = false;
      }
    });

    if (formData.boxesImpounded && !/^\d+$/.test(formData.boxesImpounded.trim())) {
      next.boxesImpounded = 'Enter a valid number';
      ok = false;
    }

    if (formData.sendSms && boxesNum > 0) {
      const err = validatePhones(formData.drugshopContactPhones || '');
      if (err) {
        next.drugshopContactPhones = err;
        ok = false;
      }
    }

    setErrors(next);
    return ok;
  }

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
      const coords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      handleChange('location', coords);

      // Placeholder address (use your server to reverse-geocode in production)
      handleChange('locationAddress', `Lat ${coords.latitude.toFixed(6)}, Lng ${coords.longitude.toFixed(6)}`);
    } catch (e: any) {
      console.error(e);
      alert('Could not determine your location. Please try again.');
    } finally {
      setIsLocating(false);
    }
  }

  async function sendImpoundSms(phonesCsv: string, payload: {
    serialNumber: string;
    drugshopName: string;
    boxesImpounded: string;
    dateIso: string;
    impoundedBy: string;
  }) {
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
      `Dear ${payload.drugshopName || 'Drugshop'}, ` +
      `${payload.boxesImpounded} box(es) were impounded on ${when}. ` +
      `Serial: ${payload.serialNumber}. Officer: ${payload.impoundedBy}.`;

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const data = {
        date: new Date(formData.date).toISOString(),
        serialNumber: formData.serialNumber.trim(),
        drugshopName: formData.drugshopName.trim(),
        drugshopContactPhones: formData.drugshopContactPhones.trim(),
        boxesImpounded: formData.boxesImpounded.trim(),
        impoundedBy: formData.impoundedBy.trim(),
        location: formData.location
          ? {
              coordinates: {
                latitude: formData.location.latitude,
                longitude: formData.location.longitude,
              },
              formattedAddress: formData.locationAddress.trim(),
            }
          : null,
        status: 'submitted',
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.email || 'anonymous',
        smsAttempted: false,
        smsSuccess: false,
      };

      const inspectionsRef = ref(db, 'inspections');
      const newRef = await push(inspectionsRef, data);
      const newId = newRef.key;

      if (formData.sendSms && boxesNum > 0 && formData.drugshopContactPhones.trim()) {
        try {
          await sendImpoundSms(formData.drugshopContactPhones.trim(), {
            serialNumber: data.serialNumber,
            drugshopName: data.drugshopName,
            boxesImpounded: data.boxesImpounded,
            dateIso: data.date,
            impoundedBy: data.impoundedBy,
          });
          alert('Submitted and SMS sent.');
        } catch (err: any) {
          console.warn('SMS error:', err?.message);
          alert('Submitted. SMS delivery failed—please retry later.');
        }
      } else {
        alert('Inspection submitted.');
      }

      // Reset
      setFormData({
        date: new Date().toISOString().slice(0, 10),
        serialNumber: '',
        drugshopName: '',
        drugshopContactPhones: '',
        boxesImpounded: '',
        impoundedBy: '',
        location: null,
        locationAddress: '',
        sendSms: true,
      });
      setErrors({});

      // router.push('/bounded-drugs'); // optional
    } catch (err) {
      console.error(err);
      alert('Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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
            <h1 className="text-xl sm:text-2xl font-bold text-blue-800 dark:text-blue-200">New Inspection</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">Fill out the form to submit.</p>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
          <ThemeButton
            active={mode === 'light'}
            onClick={() => setMode('light')}
            label="Light"
            icon={<SunMedium className="h-4 w-4" />}
          />
          <ThemeButton
            active={mode === 'system'}
            onClick={() => setMode('system')}
            label="System"
            icon={<Laptop2 className="h-4 w-4" />}
          />
          <ThemeButton
            active={mode === 'dark'}
            onClick={() => setMode('dark')}
            label="Dark"
            icon={<Moon className="h-4 w-4" />}
          />
        </div>
      </div>

      {/* Responsive layout: two columns on lg+, stacked on mobile/tablet */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Section: Inspection Details */}
          <Section title="Inspection Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Inspection Date *" icon={<CalendarIcon className="h-4 w-4" />}>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                />
              </Field>

              <Field label="Inspection Location *" icon={<MapPin className="h-4 w-4" />}>
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
                        {formData.location.latitude.toFixed(6)}, {formData.location.longitude.toFixed(6)}
                      </span>
                    </div>
                  )}
                </div>
                {!!formData.locationAddress && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formData.locationAddress}</p>
                )}
                {errors.location && <ErrorText>{errors.location}</ErrorText>}
              </Field>
            </div>
          </Section>

          {/* Section: Drugshop */}
          <Section title="Drugshop Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Serial Number *" icon={<Hash className="h-4 w-4" />}>
                <input
                  value={formData.serialNumber}
                  onChange={(e) => handleChange('serialNumber', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="SN00123"
                />
                {errors.serialNumber && <ErrorText>{errors.serialNumber}</ErrorText>}
              </Field>

              <Field label="Drugshop Name *" icon={<Briefcase className="h-4 w-4" />}>
                <input
                  value={formData.drugshopName}
                  onChange={(e) => handleChange('drugshopName', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="Facility name"
                />
                {errors.drugshopName && <ErrorText>{errors.drugshopName}</ErrorText>}
              </Field>

              <Field
                label="Drugshop Contact Phone(s) (comma-separated)"
                icon={<Users className="h-4 w-4" />}
                hint="We’ll notify these numbers if boxes are impounded."
              >
                <input
                  value={formData.drugshopContactPhones}
                  onChange={(e) => handleChange('drugshopContactPhones', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="070..., +25670..., 25670..."
                />
                {errors.drugshopContactPhones && <ErrorText>{errors.drugshopContactPhones}</ErrorText>}
              </Field>
            </div>
          </Section>

          {/* Section: Impound */}
          <Section title="Impound Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Boxes Impounded *" icon={<Package className="h-4 w-4" />}>
                <input
                  value={formData.boxesImpounded}
                  onChange={(e) => handleChange('boxesImpounded', e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="e.g. 2"
                  inputMode="numeric"
                />
                {errors.boxesImpounded && <ErrorText>{errors.boxesImpounded}</ErrorText>}
              </Field>

              <Field label="Impounded By *" icon={<UserIcon className="h-4 w-4" />}>
                <input
                  value={formData.impoundedBy}
                  onChange={(e) => handleChange('impoundedBy', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/60"
                  placeholder="Officer name"
                />
                {errors.impoundedBy && <ErrorText>{errors.impoundedBy}</ErrorText>}
              </Field>

              <div className="col-span-1 sm:col-span-2">
                <label className="flex items-start sm:items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={formData.sendSms}
                    onChange={(e) => handleChange('sendSms', e.target.checked)}
                    className="h-4 w-4 mt-0.5"
                  />
                  <span>Send SMS to Drugshop Contact(s) on submit</span>
                </label>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  SMS will be sent only if <strong>Boxes Impounded &gt; 0</strong> and contact phone(s) are provided.
                </p>
              </div>
            </div>
          </Section>
        </div>

        {/* Right rail: Tips / Summary / Actions */}
        <aside className="space-y-4 lg:space-y-6">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
            <header className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-blue-700 dark:text-blue-300" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Submission Tips</h3>
            </header>
            <ul className="text-xs sm:text-sm space-y-2 text-slate-600 dark:text-slate-400">
              <li>• Ensure the GPS location is captured at the inspection site.</li>
              <li>• Use <span className="font-mono">+256</span> format for phone numbers when possible.</li>
              <li>• Double-check the serial number and impounding officer names.</li>
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
            <header className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-blue-700 dark:text-blue-300" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Quick Summary</h3>
            </header>
            <dl className="text-xs sm:text-sm grid grid-cols-1 gap-2 text-slate-700 dark:text-slate-300">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Date</dt>
                <dd>{formData.date || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Serial</dt>
                <dd className="truncate">{formData.serialNumber || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Drugshop</dt>
                <dd className="truncate">{formData.drugshopName || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Boxes</dt>
                <dd>{boxesNum || 0}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Officer</dt>
                <dd className="truncate">{formData.impoundedBy || '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setFormData({
                    date: new Date().toISOString().slice(0, 10),
                    serialNumber: '',
                    drugshopName: '',
                    drugshopContactPhones: '',
                    boxesImpounded: '',
                    impoundedBy: '',
                    location: null,
                    locationAddress: '',
                    sendSms: true,
                  });
                  setErrors({});
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-blue-800 dark:text-blue-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <RefreshCcw className="h-4 w-4" />
                Reset
              </button>

              <button
                form="inspection-form"
                type="submit"
                className="hidden"
              />
            </div>

            <form id="inspection-form" onSubmit={handleSubmit} className="mt-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-800 text-white px-5 py-2.5 disabled:opacity-70"
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
            </form>
          </section>
        </aside>
      </div>
    </main>
  );
}

/** ---- Small UI helpers ---- **/
function ThemeButton({
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
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <h2 className="text-sm sm:text-base font-semibold text-blue-800 dark:text-blue-200">{title}</h2>
      </header>
      <div className="p-4 sm:p-5 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-1">
        {icon} <span>{label}</span>
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-rose-600">{children}</p>;
}
