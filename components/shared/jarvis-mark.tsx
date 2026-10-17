export function JarvisMark({ size = 72, label = "Setly" }: { size?: number; label?: string }) {
  return (
    <span className="jarvis" style={{ width: size, height: size }} role="img" aria-label={label}>
      <span className="jarvis-ring r1" />
      <span className="jarvis-ring r2" />
      <span className="jarvis-ring r3" />
      <span className="jarvis-core" />
      <span className="jarvis-scan" />
    </span>
  );
}
