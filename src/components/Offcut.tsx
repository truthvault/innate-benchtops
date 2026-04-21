import { useMemo } from "react";
import { findSpecies, type SpeciesId } from "../species";

interface Props {
  species: SpeciesId;
  seed?: number;
}

// Procedural wood-grain offcut. Each species uses its own palette;
// grain lines are deterministic per seed so the same card renders stably.
export function Offcut({ species, seed = 17 }: Props) {
  const sp = findSpecies(species);
  const lines = useMemo(() => buildGrain(seed), [seed]);
  const knots = useMemo(() => buildKnots(seed), [seed]);
  const id = `grain-${species}-${seed}`;

  return (
    <svg
      className="offcut-svg"
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Offcut sample of ${sp.name} timber`}
    >
      <defs>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={sp.grain.highlight} />
          <stop offset="40%" stopColor={sp.grain.base} />
          <stop offset="100%" stopColor={sp.grain.mid} />
        </linearGradient>
        <filter id={`${id}-noise`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9 0.02"
            numOctaves="2"
            seed={seed}
          />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      <rect width="100" height="60" fill={`url(#${id}-base)`} />
      {lines.map((d, i) => (
        <path
          key={i}
          d={d.path}
          stroke={sp.grain.streak}
          strokeWidth={d.w}
          fill="none"
          opacity={d.o}
        />
      ))}
      {knots.map((k, i) => (
        <ellipse
          key={i}
          cx={k.cx}
          cy={k.cy}
          rx={k.rx}
          ry={k.ry}
          fill={sp.grain.streak}
          opacity={0.45}
        />
      ))}
      <rect
        width="100"
        height="60"
        fill="transparent"
        filter={`url(#${id}-noise)`}
      />
      <rect
        width="100"
        height="60"
        fill="none"
        stroke="#00000033"
        strokeWidth="0.4"
      />
    </svg>
  );
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildGrain(seed: number) {
  const r = rng(seed);
  const lines: Array<{ path: string; w: number; o: number }> = [];
  for (let i = 0; i < 28; i++) {
    const y = (i / 28) * 60 + (r() - 0.5) * 1.6;
    const amp = 0.7 + r() * 1.4;
    const freq = 2 + r() * 3;
    let path = `M0 ${y.toFixed(2)}`;
    for (let x = 2; x <= 100; x += 2) {
      const yy = y + Math.sin((x / 100) * Math.PI * freq + i) * amp;
      path += ` L${x} ${yy.toFixed(2)}`;
    }
    lines.push({
      path,
      w: 0.25 + r() * 0.35,
      o: 0.18 + r() * 0.35,
    });
  }
  return lines;
}

function buildKnots(seed: number) {
  const r = rng(seed + 1);
  const knots = [] as Array<{ cx: number; cy: number; rx: number; ry: number }>;
  const n = 1 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    knots.push({
      cx: 10 + r() * 80,
      cy: 8 + r() * 44,
      rx: 1.2 + r() * 1.6,
      ry: 0.6 + r() * 1.1,
    });
  }
  return knots;
}
