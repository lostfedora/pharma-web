"use client";

import React, { useState } from "react";

export default function Home() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to send SMS");
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow p-6">
        <h1 className="text-2xl font-semibold mb-4">Send SMS via Yoola</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Phone(s) (comma-separated)
            </label>
            <input
              type="text"
              placeholder="070..., +25670..., 25670"
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Example: <code>0701234567,+256701234567,256701234567</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Message</label>
            <textarea
              placeholder="Your message"
              className="w-full rounded-lg border px-3 py-2 h-28 outline-none focus:ring-2 focus:ring-emerald-500"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-600 text-white py-2.5 font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send SMS"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 text-red-700 p-3 text-sm">
            {error}
          </div>
        )}

        {result && (
          <pre className="mt-4 text-sm bg-gray-100 p-3 rounded-lg overflow-x-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </main>
  );
}
