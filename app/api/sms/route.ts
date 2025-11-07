import { NextResponse } from "next/server";

type SendSmsPayload = {
  phone: string;   // comma-separated numbers e.g. "070..., +25670..., 25670..."
  message: string; // SMS body
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.YOOLA_SMS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Server is missing YOOLA_SMS_API_KEY." },
        { status: 500 }
      );
    }

    const body = (await req.json()) as Partial<SendSmsPayload>;
    const phone = (body.phone ?? "").trim();
    const message = (body.message ?? "").trim();

    if (!phone) {
      return NextResponse.json({ ok: false, error: "Phone is required." }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ ok: false, error: "Message is required." }, { status: 400 });
    }

    // Optional: light sanity check — remove accidental spaces around commas
    const cleanedPhone = phone
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .join(",");

    const upstream = await fetch("https://yoolasms.com/api/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // IMPORTANT: No Cookie header needed; keep it simple + stateless
      body: JSON.stringify({
        phone: cleanedPhone,
        message,
        api_key: apiKey,
      }),
    });

    const data = await upstream.json().catch(() => ({}));

    // Pass through upstream status and payload so you see exact response
    return NextResponse.json(
      { ok: upstream.ok, status: upstream.status, data },
      { status: upstream.status }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
