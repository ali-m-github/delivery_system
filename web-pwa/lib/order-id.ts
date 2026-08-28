/** Keep the RTS marker derived from the order's current financial status. */
export function orderIdForFinancialStatus(
  orderId: string,
  financialStatus: string | null | undefined,
): string {
  const baseOrderId = orderId.replace(/R$/i, "");
  return financialStatus === "RTS" ? baseOrderId + "R" : baseOrderId;
}
