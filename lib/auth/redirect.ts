/** Keep post-login navigation on this site, including browser-normalized URLs. */
export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/";
  const base = new URL("https://setly.invalid");
  const target = new URL(value, base);
  return target.origin === base.origin ? `${target.pathname}${target.search}${target.hash}` : "/";
}
