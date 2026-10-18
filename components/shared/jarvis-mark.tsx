/** Setly's mark: a stem that branches into a set. `live` makes the branches grow and pulse (thinking, building). */
export function JarvisMark({ size = 72, label = "Setly", live = false }: { size?: number; label?: string; live?: boolean }) {
  return (
    <span className={`setly-mark${live ? " live" : ""}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <rect className="mark-bg" x="0" y="0" width="40" height="40" rx="12" />
        <path className="mark-stem" d="M20 31V19" pathLength={1} />
        <path className="mark-branch b1" d="M20 22c0-4-3.5-6-8-6" pathLength={1} />
        <path className="mark-branch b2" d="M20 19c0-4 3.5-6 8-6" pathLength={1} />
        <circle className="mark-node n1" cx="11" cy="16" r="3" />
        <circle className="mark-node n2" cx="29" cy="13" r="3" />
        <circle className="mark-node n3" cx="20" cy="10.5" r="3.2" />
      </svg>
    </span>
  );
}
