"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  getDatabase,
  ref,
  onValue,
  query as fbQuery,
  orderByChild,
  startAt,
  update,
  push,
} from "firebase/database";
import primaryApp, { database as primaryDb } from "@/firebase";
import { getAuth } from "firebase/auth";
import {
  Search as SearchIcon,
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
} from "lucide-react";

/** ------------------------------------------------------------------
 * Types
 * -------------------------------------------------------------------*/
export type Inspection = {
  id: string;
  serialNumber?: string;
  drugshopName?: string;
  clientTelephone?: string;
  location?: unknown;
  boxesImpounded?: string | number;
  reason?: string;
  impoundedBy?: string;
  date?: string; // ISO
  createdAt?: string | number; // ISO or ms
  createdBy?: string;
  status?: string;
  releasedAt?: number;
  inspectionId?: string;
};

/** ------------------------------------------------------------------
 * Utilities
 * -------------------------------------------------------------------*/
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const parseMs = (v?: string | number): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

const fmtDateTime = (isoOrMs?: string | number): string => {
  if (!isoOrMs) return "—";
  const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

const telOk = (t: string) => /^(\+?\d{7,15})$/.test((t || "").replace(/\s+/g, ""));

/** Simple debounce */
function useDebounced<T>(value: T, delayMs = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
}

/** ------------------------------------------------------------------
 * SMS (proxied through API)
 * -------------------------------------------------------------------*/
async function sendSmsViaApi(phone: string, message: string) {
  // Keep secrets server-side in /api/sms
  const res = await fetch("/api/sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  });
  if (!res.ok) throw new Error(`SMS failed (${res.status})`);
  return res.json().catch(() => ({}));
}

/** ------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------*/
export default function BoundedDrugsPage() {
  const db = primaryDb ?? getDatabase(primaryApp);
  const auth = getAuth(primaryApp);
  const me = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Inspection[]>([]);
  const [q, setQ] = useState("");
  const qDebounced = useDebounced(q, 200);

  // Modal state
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Inspection | null>(null);

  // Form
  const [relDate, setRelDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [clientName, setClientName] = useState("");
  const [telephone, setTelephone] = useState("");
  const [releasedBy, setReleasedBy] = useState("");
  const [comment, setComment] = useState("");
  const [boxesReleased, setBoxesReleased] = useState("");
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to /inspections where boxesImpounded > 0
  useEffect(() => {
    const qy = fbQuery(ref(db, "inspections"), orderByChild("boxesImpounded"), startAt(1 as any));
    const unsub = onValue(
      qy,
      (snap) => {
        const val = snap.val() as Record<string, any> | null;
        let list: Inspection[] = [];
        if (val) list = Object.entries(val).map(([id, v]) => ({ id, ...(v as object) })) as Inspection[];
        list = list.filter((r) => num(r.boxesImpounded) > 0);
        list.sort((a, b) => {
          const aT = parseMs(a.createdAt) || parseMs(a.date);
          const bT = parseMs(b.createdAt) || parseMs(b.date);
          return bT - aT;
        });
        setRows(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [db]);

  // Modal focus + Escape
  useEffect(() => {
    if (!open) return;
    firstInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    const s = qDebounced.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.serialNumber || "").toLowerCase().includes(s) ||
      (r.drugshopName || "").toLowerCase().includes(s) ||
      (r.impoundedBy || "").toLowerCase().includes(s) ||
      (typeof r.location === "string" ? r.location.toLowerCase().includes(s) : false)
    );
  }, [rows, qDebounced]);

  const openModal = useCallback((row: Inspection) => {
    setTarget(row);
    setError(null);
    setRelDate(new Date().toISOString().slice(0, 10));
    setClientName("");
    setTelephone(row.clientTelephone || "");
    setReleasedBy(me?.displayName || me?.email || "");
    setComment("");
    setBoxesReleased("");
    setAck1(false);
    setAck2(false);
    setConfirmText("");
    setOpen(true);
  }, [me?.displayName, me?.email]);

  const canConfirm = useMemo(() => {
    if (!target) return false;
    const typed = confirmText.trim();
    const serial = (target.serialNumber || "").trim();
    const okTyped = typed.toUpperCase() === "RELEASE" || (!!serial && typed.toLowerCase() === serial.toLowerCase());
    return ack1 && ack2 && okTyped;
  }, [ack1, ack2, confirmText, target?.serialNumber]);

  const statusPill = (r: Inspection) => {
    const boxes = num(r.boxesImpounded);
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
    return "—";
  };

  async function handleSubmitRelease() {
    if (!target) return;
    const available = num(target.boxesImpounded);
    const count = parseInt(boxesReleased, 10);

    if (!relDate) return setError("Release date is required.");
    if (!clientName.trim()) return setError("Client name is required.");
    if (!telephone.trim()) return setError("Telephone number is required.");
    if (!telOk(telephone)) return setError("Enter a valid phone number (e.g. +2567XXXXXXX).");
    if (!releasedBy.trim()) return setError("Released by is required.");
    if (Number.isNaN(count) || count <= 0) return setError("Enter a valid number of boxes to release.");
    if (count > available) return setError(`You are releasing ${count}, but only ${available} are impounded.`);
    if (!canConfirm) return setError("Complete acknowledgements and type RELEASE or the Serial.");

    try {
      setError(null);
      setSavingId(target.id);

      // 1) Append a release record under /releases/{inspectionId}
      const releaseRef = ref(db, `releases/${target.id}`);
      const nowIso = new Date().toISOString();
      await push(releaseRef, {
        inspectionId: target.id,
        date: new Date(relDate).toISOString(),
        clientName: clientName.trim(),
        telephone: telephone.replace(/\s+/g, ""),
        releasedBy: releasedBy.trim(),
        comment: comment.trim(),
        boxesReleased: count,
        createdAt: nowIso,
        createdByUid: me?.uid ?? "anonymous",
        createdByEmail: me?.email ?? null,
        createdByName: me?.displayName ?? null,
      });

      // 2) Update the inspection entry
      const remaining = Math.max(0, available - count);
      const isStr = typeof target.boxesImpounded === "string";
      const nextStatus = remaining === 0 ? "Completed" : "Pending Review";

      await update(ref(db, `inspections/${target.id}`), {
        boxesImpounded: isStr ? String(remaining) : remaining,
        status: nextStatus,
        releasedAt: Date.now(),
        releasedBy: me?.uid ?? "anonymous",
        releasedByEmail: me?.email ?? null,
        releasedByName: me?.displayName ?? null,
        lastReleaseNote: comment.trim() || null,
        lastReleaseCount: count,
      });

      // 3) SMS (fire-and-forget)
      const when = new Date(relDate);
      const whenStr = Number.isNaN(when.getTime())
        ? relDate
        : new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).format(when);

      const msg =
        `Dear ${target.drugshopName || "Drugshop"}, ` +
        `${count} box(es) have been released on ${whenStr}. ` +
        `Serial: ${target.serialNumber || "—"}. ` +
        `Remaining: ${remaining}. ` +
        `Officer: ${releasedBy.trim()}.`;

      try {
        await sendSmsViaApi(telephone.replace(/\s+/g, ""), msg);
      } catch (e) {
        // Non-blocking: we still consider the release successful
        console.warn("SMS failed:", e);
      }

      setOpen(false);
      alert(`Release recorded. Status: ${nextStatus}`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to submit release. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

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
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by Serial, Drugshop, Officer or Location…"
            className="pl-9 pr-10 py-2.5 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            aria-label="Search bounded drugs"
          />
          {q && (
            <button
              onClick={() => setQ("")}
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
              "Loading…"
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
              const boxes = num(r.boxesImpounded);
              const isCompleted = (r.status || "").toLowerCase().includes("complete") || boxes === 0;
              return (
                <li key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{r.serialNumber || "—"}</p>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 truncate">{r.drugshopName || "—"}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{fmtDateTime(r.date || r.createdAt)}</p>
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
                        onClick={() => openModal(r)}
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
                  const boxes = num(r.boxesImpounded);
                  const isCompleted = (r.status || "").toLowerCase().includes("complete") || boxes === 0;
                  const locStr =
                    typeof r.location === "string"
                      ? r.location
                      : (r as any)?.location?.coordinates
                      ? "has coordinates"
                      : "—";

                  return (
                    <tr key={r.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-[12rem] truncate">{r.serialNumber || "—"}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[18rem] truncate">{r.drugshopName || "—"}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[18rem] truncate">{locStr}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{boxes}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDateTime(r.date || r.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.impoundedBy || "—"}</td>
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
                            onClick={() => openModal(r)}
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

      {/* Release Form Modal */}
      {open && target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 supports-[backdrop-filter]:backdrop-blur-sm" onClick={() => setOpen(false)} />

          {/* Dialog */}
          <div
            className="relative z-10 w-full max-w-xl sm:max-w-2xl rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/90 supports-[backdrop-filter]:backdrop-blur-xl shadow-xl p-4 sm:p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-title"
            aria-describedby="release-desc"
          >
            {/* Saving overlay */}
            {savingId === target.id && (
              <div className="absolute inset-0 rounded-2xl bg-white/60 dark:bg-black/40 backdrop-blur-sm flex items-center justify-center z-10">
                <Loader2 className="h-6 w-6 animate-spin text-gray-600 dark:text-gray-200" />
              </div>
            )}

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h2 id="release-title" className="text-base sm:text-lg font-semibold">Release Form</h2>
              </div>
              <button
                className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Summary */}
            <div className="mt-3 text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
              <p><span className="text-gray-500">Serial:</span> <span className="font-medium break-words">{target.serialNumber || "—"}</span></p>
              <p><span className="text-gray-500">Drugshop:</span> <span className="font-medium break-words">{target.drugshopName || "—"}</span></p>
              <p><span className="text-gray-500">Impounded:</span> <span className="font-medium">{num(target.boxesImpounded)} box(es)</span></p>
              <p className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <UserIcon className="h-4 w-4" />
                Officer: <span className="font-medium text-gray-800 dark:text-gray-200 ml-1">{me?.displayName || me?.email || me?.uid || "anonymous"}</span>
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Date */}
              <div>
                <label className="text-sm font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> Date *</label>
                <input
                  ref={firstInputRef}
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
                  onChange={(e) => setBoxesReleased(e.target.value.replace(/[^\d]/g, ""))}
                  className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                  placeholder="e.g. 2"
                  inputMode="numeric"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Available: {num(target.boxesImpounded)} box(es)</p>
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
            </div>

            {/* Acknowledgements */}
            <div className="mt-4 space-y-2">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={ack1} onChange={(e) => setAck1(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>I have verified and counted the items with the facility representative.</span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={ack2} onChange={(e) => setAck2(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>I accept responsibility and a handover record will be kept.</span>
              </label>
            </div>

            {/* Type-to-confirm */}
            <div className="mt-3">
              <label className="text-sm font-medium">
                Type <code>RELEASE</code> or the Serial (<code>{target.serialNumber || "—"}</code>) to confirm
              </label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                placeholder="RELEASE or SN00123"
                autoCapitalize="characters"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="mt-3 rounded-lg border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                disabled={savingId === target.id}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitRelease}
                disabled={!canConfirm || savingId === target.id}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-2 disabled:opacity-60"
                title="Submit release"
              >
                {savingId === target.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Submit Release
              </button>
            </div>

            {!canConfirm && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Complete checks and type the exact Serial or <strong>RELEASE</strong> to enable.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
