/** Display-only. Money stays integer cents everywhere else. */
export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function payLabel(payType: string) {
  if (payType === "shared") return "Shared";
  if (payType === "per_person") return "Each person";
  if (payType === "already_owned") return "Already owned";
  return payType;
}

export function statusLabel(status: string) {
  if (status === "ok") return "Clear";
  if (status === "warning") return "Watch";
  if (status === "broken") return "Broken";
  if (status === "not_checked") return "Unchecked";
  return status;
}
