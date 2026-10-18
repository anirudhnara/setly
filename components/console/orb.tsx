import type { CSSProperties } from "react";

export type OrbState = "idle" | "thinking" | "listening" | "building";

const PARTICLES = Array.from({ length: 18 }, (_, index) => ({
  radius: 38 + ((index * 37) % 15),
  size: 2 + (index % 3),
  duration: 9 + ((index * 7) % 11),
  delay: -((index * 13) % 17),
  tilt: (index * 47) % 360,
}));

/** Setly's presence: a floating core with counter-rotating rings and orbiting sparks. Decorative only. */
export function Orb({ state = "idle", size = 320 }: { state?: OrbState; size?: number }) {
  return (
    <div className={`orb orb-${state}`} style={{ "--orb": `${size}px` } as CSSProperties} aria-hidden="true">
      <div className="orb-float">
        <div className="orb-halo" />
        <div className="orb-stage">
          <svg className="orb-ring r1" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" /></svg>
          <svg className="orb-ring r2" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" /></svg>
          <svg className="orb-ring r3" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" /></svg>
          <svg className="orb-ring r4" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" /></svg>
        </div>
        <div className="orb-core">
          <span className="orb-shine" />
          <span className="orb-pulse" />
        </div>
        {PARTICLES.map((particle, index) => (
          <span
            key={index}
            className="orb-orbit"
            style={{ "--r": `${particle.radius}%`, "--t": `${particle.duration}s`, "--dl": `${particle.delay}s`, "--tilt": `${particle.tilt}deg`, "--s": `${particle.size}px` } as CSSProperties}
          >
            <i />
          </span>
        ))}
      </div>
    </div>
  );
}
