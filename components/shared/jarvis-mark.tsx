import { useId } from "react";

export function JarvisMark({ size = 72, label = "Setly" }: { size?: number; label?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className="setly-flame" style={{ width: size, height: size }} role="img" aria-label={label}>
      <span className="setly-glow" />
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-flame`} x1=".18" y1=".08" x2=".82" y2=".92">
            <stop offset="0" stopColor="#fff4c5" />
            <stop offset=".35" stopColor="#8af2bd" />
            <stop offset="1" stopColor="#40b9a5" />
          </linearGradient>
          <linearGradient id={`${id}-flame-core`} x1=".2" y1="0" x2=".8" y2="1">
            <stop offset="0" stopColor="#fffefa" />
            <stop offset="1" stopColor="#ffb670" />
          </linearGradient>
        </defs>
        <path className="setly-outer" d="M52 5C49 23 28 30 27 52c-1 22 12 39 25 44 15-8 26-24 23-43-2-13-12-22-15-34-4 7-5 12-7 18C48 27 51 16 52 5Z" fill={`url(#${id}-flame)`} />
        <path className="setly-inner" d="M53 48c-2 8-12 12-12 23 0 9 5 16 12 19 8-4 13-12 12-21-1-7-6-10-8-16-1 5-3 7-4 9 0-5 1-10 0-14Z" fill={`url(#${id}-flame-core)`} />
      </svg>
      <span className="setly-sparkle" />
    </span>
  );
}
