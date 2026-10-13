// ──────────────────────────────────────────────────────────────────────────────
// Shared notification types & preference normalization.
//
// Merchant.notificationPreferences is a nullable Json column. A null value
// means "never configured" and behaves as DEFAULT_MERCHANT_PREFERENCES:
// every channel and every event enabled (opt-in everything). The settings
// modal always writes a fully-materialized object, so partial/legacy blobs
// are merged over the defaults here rather than in the UI.
// ──────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = [
  "DELIVERED",
  "POSTPONED",
  "PRICE_DISCREPANCY",
  "REJECTED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export interface NotificationPreferences {
  channels: {
    inApp: boolean;
    whatsapp: boolean;
  };
  events: Record<NotificationType, boolean>;
}

export const DEFAULT_MERCHANT_PREFERENCES: NotificationPreferences = {
  channels: { inApp: true, whatsapp: true },
  events: {
    DELIVERED: true,
    POSTPONED: true,
    PRICE_DISCREPANCY: true,
    REJECTED: true,
  },
};

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Merge a raw (possibly null / partial / malformed) preferences blob from the
 * database over the defaults. Never throws — unknown keys are ignored.
 */
export function normalizeMerchantPreferences(
  raw: unknown,
): NotificationPreferences {
  const defaults = DEFAULT_MERCHANT_PREFERENCES;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return structuredClone(defaults);
  }
  const obj = raw as Record<string, unknown>;

  const channelsRaw =
    obj.channels && typeof obj.channels === "object" && !Array.isArray(obj.channels)
      ? (obj.channels as Record<string, unknown>)
      : {};
  const eventsRaw =
    obj.events && typeof obj.events === "object" && !Array.isArray(obj.events)
      ? (obj.events as Record<string, unknown>)
      : {};

  return {
    channels: {
      inApp: boolOr(channelsRaw.inApp, defaults.channels.inApp),
      whatsapp: boolOr(channelsRaw.whatsapp, defaults.channels.whatsapp),
    },
    events: {
      DELIVERED: boolOr(eventsRaw.DELIVERED, defaults.events.DELIVERED),
      POSTPONED: boolOr(eventsRaw.POSTPONED, defaults.events.POSTPONED),
      PRICE_DISCREPANCY: boolOr(
        eventsRaw.PRICE_DISCREPANCY,
        defaults.events.PRICE_DISCREPANCY,
      ),
      REJECTED: boolOr(eventsRaw.REJECTED, defaults.events.REJECTED),
    },
  };
}

/**
 * Validate an incoming PATCH payload from the settings modal into a fully
 * materialized preferences object. Returns null when the payload shape is
 * invalid so the route can answer 400.
 */
export function parseMerchantPreferencesPayload(
  body: unknown,
): NotificationPreferences | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;

  const channels = obj.channels;
  const events = obj.events;
  if (
    !channels ||
    typeof channels !== "object" ||
    Array.isArray(channels) ||
    !events ||
    typeof events !== "object" ||
    Array.isArray(events)
  ) {
    return null;
  }

  const c = channels as Record<string, unknown>;
  const e = events as Record<string, unknown>;
  if (
    typeof c.inApp !== "boolean" ||
    typeof c.whatsapp !== "boolean"
  ) {
    return null;
  }
  for (const type of NOTIFICATION_TYPES) {
    if (typeof e[type] !== "boolean") return null;
  }

  return {
    channels: { inApp: c.inApp, whatsapp: c.whatsapp },
    events: {
      DELIVERED: e.DELIVERED as boolean,
      POSTPONED: e.POSTPONED as boolean,
      PRICE_DISCREPANCY: e.PRICE_DISCREPANCY as boolean,
      REJECTED: e.REJECTED as boolean,
    },
  };
}
