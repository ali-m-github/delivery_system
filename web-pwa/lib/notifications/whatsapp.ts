import { maskPhone } from "@/lib/pii";

// ──────────────────────────────────────────────────────────────────────────────
// Meta WhatsApp Cloud API client (zero-config development mock mode).
//
// Configuration (all optional):
//   WHATSAPP_PHONE_NUMBER_ID  — the Cloud API phone number id
//   WHATSAPP_ACCESS_TOKEN     — a permanent/system-user access token
//   WHATSAPP_GRAPH_VERSION    — defaults to "v21.0"
//
// When the id/token are missing (the default in development), the message is
// rendered to the console in the same colored style as lib/notifications.ts
// and a mocked success is returned. This module NEVER throws to its caller:
// notification delivery is best-effort and must not fail the order flow.
// ──────────────────────────────────────────────────────────────────────────────

export interface WhatsAppSendResult {
  ok: boolean;
  /** "sent" | "mocked" | "skipped" — useful for logs/tests, not user-facing. */
  mode: "sent" | "mocked" | "skipped";
  waMessageId?: string;
  error?: string;
}

interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  graphVersion: string;
}

function getWhatsAppConfig(): WhatsAppConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) return null;
  return {
    phoneNumberId,
    accessToken,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0",
  };
}

let mockWarned = false;

function logMockMessage(to: string, body: string): void {
  if (!mockWarned) {
    mockWarned = true;
    console.log(
      "\x1b[33m[whatsapp] WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN " +
        "not set — running in MOCK mode (messages are logged, not sent).\x1b[0m",
    );
  }
  // \x1b[36m = cyan, \x1b[33m = yellow, \x1b[0m = reset (same style as lib/notifications.ts)
  console.log("\x1b[36m=== WHATSAPP (MOCK) \x1b[0m");
  console.log(`\x1b[33mTo:\x1b[0m      ${maskPhone(to)}`);
  console.log(`\x1b[33mMessage:\x1b[0m ${body}`);
  console.log("\x1b[36m=====================\n\x1b[0m");
}

/**
 * Normalize a merchant phone into E.164-ish digits for the WhatsApp API.
 * Lebanese local numbers ("03123456") get the +961 country code prepended.
 * Returns null when the value has too few digits to be dialable.
 */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  // Local Lebanese format: 8 digits starting with 3-9, or 10 digits starting with 0
  if (/^[3-9]\d{7}$/.test(digits)) digits = `961${digits}`;
  else if (/^0\d{9}$/.test(digits)) digits = `961${digits.slice(1)}`;
  return digits.length >= 8 ? digits : null;
}

/**
 * Send a WhatsApp text message via the Meta Cloud API.
 * Never throws — failures are returned as { ok: false } and logged.
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
): Promise<WhatsAppSendResult> {
  const phone = normalizeWhatsAppPhone(to);
  if (!phone) {
    console.warn(
      `[whatsapp] Skipping message: recipient phone ${maskPhone(to)} is not dialable`,
    );
    return { ok: false, mode: "skipped", error: "Invalid phone number" };
  }

  const config = getWhatsAppConfig();
  if (!config) {
    logMockMessage(phone, body);
    return { ok: true, mode: "mocked" };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body },
        }),
        // Fail fast rather than hanging the (fire-and-forget) request chain.
        signal: AbortSignal.timeout(10_000),
      },
    );

    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err =
        payload && typeof payload === "object"
          ? JSON.stringify((payload as { error?: unknown }).error ?? payload)
          : `HTTP ${res.status}`;
      console.error(
        `[whatsapp] Send failed for ${maskPhone(phone)}: HTTP ${res.status} ${err}`,
      );
      return { ok: false, mode: "sent", error: err };
    }

    const waMessageId =
      payload && typeof payload === "object"
        ? (
            (payload as { messages?: { id?: string }[] }).messages?.[0]?.id ??
            undefined
          )
        : undefined;
    return { ok: true, mode: "sent", waMessageId };
  } catch (error) {
    console.error(
      `[whatsapp] Send error for ${maskPhone(phone)}:`,
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      mode: "sent",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
