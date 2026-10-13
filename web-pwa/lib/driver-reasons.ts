/**
 * Shared driver exception reason codes (postponement + rejection/return).
 *
 * Single source of truth used by:
 *  - app/driver/DriverClient.tsx  → reason picker radio lists (EN/AR labels)
 *  - components/OrderHistoryModal.tsx → rendering `Reason: …` tags from the
 *    `reasonCode` stored in OrderHistory.meta
 *
 * Labels are stored as "English / العربية" so a single string works in both
 * locales; `splitReasonLabel` extracts one side when a strict locale is needed.
 */

export type ReasonCategory = "postponement" | "rejection";

export interface DriverReason {
  code: string;
  /** Combined bilingual label: "English / العربية" */
  label: string;
}

/** Postponement Reasons (أسباب التأجيل) */
export const POSTPONEMENT_REASONS: DriverReason[] = [
  {
    code: "customer_not_answering",
    label: "Customer not answering / الزبون لا يرد على الاتصال",
  },
  { code: "wrong_phone_number", label: "Wrong phone number / رقم الهاتف خاطئ" },
  {
    code: "phone_switched_off",
    label: "Phone switched off or unreachable / الهاتف مغلق أو خارج التغطية",
  },
  {
    code: "customer_not_at_location",
    label: "Customer not at location / الزبون خارج المنزل أو مكان التسليم",
  },
  {
    code: "customer_requested_tomorrow",
    label: "Customer requested delivery tomorrow / الزبون طلب التأجيل للغد",
  },
  {
    code: "customer_requested_later_today",
    label:
      "Customer requested later time today / الزبون طلب التسليم في وقت لاحق اليوم",
  },
  {
    code: "no_cash_today",
    label: "Customer has no cash ready today / الزبون لا يملك كاش حالياً",
  },
  {
    code: "inaccessible_road",
    label: "Road blocked or inaccessible address / العنوان غير متاح أو الطريق مقطوع",
  },
  {
    code: "out_of_working_hours",
    label: "Ran out of delivery hours / انتهاء وقت الدوام اليومي",
  },
  { code: "other", label: "Other custom reason / سبب آخر" },
];

/** Rejection / Return Reasons (أسباب الرفض والإرجاع) */
export const REJECTION_REASONS: DriverReason[] = [
  {
    code: "refused_without_reason",
    label: "Customer refused without reason / الزبون رفض الاستلام دون سبب",
  },
  { code: "canceled_order", label: "Customer canceled order / الزبون ألغى الطلب" },
  {
    code: "fake_order",
    label: "Customer claims they never ordered / الزبون ينكر الطلب (طلب وهمي)",
  },
  {
    code: "wrong_number_permanent",
    label: "Wrong phone number / permanently unreachable / رقم الهاتف خاطئ أو ملغى",
  },
  {
    code: "price_mismatch",
    label: "Price mismatch on waybill / اختلاف في السعر عن المتفق عليه",
  },
  {
    code: "refused_delivery_fee",
    label: "Customer refused delivery fee / الزبون يرفض دفع كلفة التوصيل",
  },
  {
    code: "wrong_item",
    label: "Wrong item sent by merchant / بضاعة غير مطابقة من المصدر",
  },
  {
    code: "damaged_parcel",
    label: "Damaged or leaking parcel / الطرد متضرر أو مكسور",
  },
  {
    code: "opened_and_rejected",
    label: "Customer opened item and rejected / تم فتح الطرد ورفضه من الزبون",
  },
  { code: "other", label: "Other custom reason / سبب آخر" },
];

const ALL_REASON_LABELS = new Map<string, string>(
  [...POSTPONEMENT_REASONS, ...REJECTION_REASONS].map((r) => [r.code, r.label]),
);

/**
 * Resolve a stored reasonCode to its bilingual display label.
 * Returns null for unknown/missing codes so callers can fall back gracefully.
 */
export function getReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ALL_REASON_LABELS.get(code) ?? null;
}

/**
 * Split a "English / العربية" label into one side.
 * `side: "en"` returns the part before the LAST " / " separator (labels may
 * themselves contain " / ", e.g. "Wrong phone number / permanently unreachable"),
 * so we split on the final separator that precedes Arabic text.
 */
export function splitReasonLabel(label: string, side: "en" | "ar"): string {
  const hasArabic = /[\u0600-\u06FF]/.test(label);
  if (!hasArabic) return label;
  const parts = label.split(" / ");
  if (parts.length < 2) return label;
  // Re-join: the Arabic half is the last segment that contains Arabic script.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/[\u0600-\u06FF]/.test(parts[i])) {
      return side === "ar"
        ? parts.slice(i).join(" / ")
        : parts.slice(0, i).join(" / ");
    }
  }
  return label;
}
