"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * The identity's picture-making pattern: a picture built from small round glyphs on a grid, like the identity's
 * Eiffel Tower made of dots. Each frame gets a picture of what it's about (a shield for verifying, a receipt for
 * naming the payment, a vault for lenders, a skyline for businesses). The grid is fine, so the silhouette reads
 * precisely. Inside it the glyphs are a dense mix of the whole set; along its edge they turn to rings and dots; the
 * picture's details (a check, the lines on a receipt) are cut out cleanly as negative space; nothing is scattered
 * outside the outline; and
 * only a handful of cells light up in the contrasting colour.
 *
 * Pictures are signed distance fields in their own space (x from 0 to the picture's aspect, y from 0 to 1, top
 * down), fitted into the box without stretching, so they hold their shape from phone to desktop. Everything comes
 * from a seeded hash, so it renders the same on every visit. It's decoration, so it's hidden from screen readers.
 */

type Tone = "on-orange" | "on-night" | "on-pop" | "on-tint" | "on-light";

const COLORS: Record<Tone, { glyph: string; pop: string; tile: string; tileGlyph: string }> = {
  // glyph tint on the spot orange, with Night cells lighting up
  "on-orange": { glyph: "var(--glyph-tint)", pop: "var(--ink)", tile: "var(--ink)", tileGlyph: "var(--spot)" },
  // spot orange on Night, with pale cells lighting up
  "on-night": { glyph: "var(--spot)", pop: "var(--glyph-pop)", tile: "var(--glyph-pop)", tileGlyph: "var(--ink)" },
  // the glyph tint on the pale pop, quiet, with spot orange cells lighting up
  "on-pop": { glyph: "var(--glyph-tint)", pop: "var(--spot)", tile: "var(--spot)", tileGlyph: "var(--glyph-pop)" },
  // Night on the warm light grey, with spot orange cells lighting up
  "on-light": { glyph: "var(--ink)", pop: "var(--spot)", tile: "var(--spot)", tileGlyph: "var(--glyph-pop)" },
  // spot orange on the glyph tint, with Night cells lighting up
  "on-tint": { glyph: "var(--spot)", pop: "var(--ink)", tile: "var(--ink)", tileGlyph: "var(--glyph-tint)" },
};

/** A stable number in [0, 1) for a cell, so the pattern is the same on every render. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

type P = [number, number];

const len = (x: number, y: number) => Math.hypot(x, y);

/** Distance to a segment with round caps of radius r. */
function seg(p: P, a: P, b: P, r: number): number {
  const [px, py] = [p[0] - a[0], p[1] - a[1]];
  const [bx, by] = [b[0] - a[0], b[1] - a[1]];
  const h = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by)));
  return len(px - bx * h, py - by * h) - r;
}

function box(p: P, cx: number, cy: number, hw: number, hh: number): number {
  const dx = Math.abs(p[0] - cx) - hw;
  const dy = Math.abs(p[1] - cy) - hh;
  return len(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

function circle(p: P, cx: number, cy: number, r: number): number {
  return len(p[0] - cx, p[1] - cy) - r;
}

/** Signed distance to a closed polygon. */
function poly(p: P, pts: P[]): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j]!;
    const b = pts[i]!;
    d = Math.min(d, seg(p, a, b, 0));
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? -d : d;
}

const union = (...ds: number[]) => Math.min(...ds);

/** A picture: its width over its height, the silhouette, and the details drawn in the accent colour. */
type Shape = { aspect: number; body: (p: P) => number; detail?: (p: P) => number };

export const SHAPES = {
  /** Get verified: a shield with a check through it */
  shield: {
    aspect: 1,
    body: (p) => poly(p, [[0.5, 0.04], [0.86, 0.17], [0.86, 0.5], [0.5, 0.96], [0.14, 0.5], [0.14, 0.17]]),
    detail: (p) => union(seg(p, [0.33, 0.5], [0.45, 0.62], 0.038), seg(p, [0.45, 0.62], [0.68, 0.36], 0.038)),
  },
  /** Name the payment: a receipt with a torn bottom edge and its lines */
  receipt: {
    aspect: 0.8,
    body: (p) =>
      poly(p, [[0.06, 0.04], [0.74, 0.04], [0.74, 0.92], [0.655, 0.86], [0.57, 0.92], [0.485, 0.86], [0.4, 0.92], [0.315, 0.86], [0.23, 0.92], [0.145, 0.86], [0.06, 0.92]]),
    detail: (p) => union(seg(p, [0.18, 0.2], [0.62, 0.2], 0.03), seg(p, [0.18, 0.33], [0.62, 0.33], 0.03), seg(p, [0.18, 0.46], [0.48, 0.46], 0.03), seg(p, [0.42, 0.68], [0.62, 0.68], 0.04)),
  },
  /** Get the loan: a large coin over a stack of coins */
  coins: {
    aspect: 1.25,
    body: (p) => union(circle(p, 0.82, 0.38, 0.33), ...[0.9, 0.77, 0.64, 0.51].map((y) => box(p, 0.3, y, 0.24, 0.05) - 0.01)),
    detail: (p) => Math.abs(circle(p, 0.82, 0.38, 0.21)) - 0.03,
  },
  /** Pay it back: a circle with a check */
  check: {
    aspect: 1,
    body: (p) => circle(p, 0.5, 0.5, 0.46),
    detail: (p) => union(seg(p, [0.3, 0.52], [0.43, 0.65], 0.04), seg(p, [0.43, 0.65], [0.7, 0.37], 0.04)),
  },
  /** Liquidity: a drop */
  drop: {
    aspect: 0.8,
    body: (p) => union(circle(p, 0.4, 0.63, 0.32), poly(p, [[0.4, 0.03], [0.7, 0.52], [0.1, 0.52]])),
    detail: (p) => seg(p, [0.22, 0.6], [0.27, 0.76], 0.035),
  },
  /** Signed off: a pen over a signature line */
  pen: {
    aspect: 1,
    body: (p) => union(seg(p, [0.8, 0.1], [0.42, 0.56], 0.11), poly(p, [[0.33, 0.5], [0.49, 0.66], [0.2, 0.8]]), seg(p, [0.08, 0.93], [0.92, 0.93], 0.03)),
    detail: (p) => union(seg(p, [0.34, 0.65], [0.26, 0.74], 0.022), seg(p, [0.52, 0.34], [0.62, 0.22], 0.025)),
  },
  /** Interest over a horizon: a clock */
  clock: {
    aspect: 1,
    body: (p) => circle(p, 0.5, 0.5, 0.46),
    detail: (p) => union(seg(p, [0.5, 0.5], [0.5, 0.2], 0.04), seg(p, [0.5, 0.5], [0.72, 0.62], 0.04)),
  },
  /** Lenders' vault: a bank with a pediment, columns, and steps */
  bank: {
    aspect: 1.1,
    body: (p) =>
      union(
        poly(p, [[0.06, 0.3], [0.55, 0.04], [1.04, 0.3]]),
        box(p, 0.55, 0.34, 0.47, 0.04),
        ...[0.15, 0.35, 0.55, 0.75, 0.95].map((x) => box(p, x, 0.61, 0.055, 0.22)),
        box(p, 0.55, 0.87, 0.5, 0.035),
        box(p, 0.55, 0.95, 0.54, 0.035),
      ),
    detail: (p) => circle(p, 0.55, 0.2, 0.05),
  },
  /** Businesses: a city skyline */
  skyline: {
    aspect: 2,
    body: (p) =>
      union(
        ...(
          [
            [0.12, 0.13, 0.45],
            [0.36, 0.11, 0.7],
            [0.6, 0.12, 0.55],
            [0.88, 0.15, 0.88],
            [1.14, 0.11, 0.62],
            [1.38, 0.13, 0.78],
            [1.62, 0.11, 0.5],
            [1.86, 0.13, 0.66],
          ] as const
        ).map(([x, hw, h]) => box(p, x, 1 - h / 2, hw, h / 2)),
        seg(p, [0.88, 0.12], [0.88, 0.02], 0.02),
      ),
  },
  /** Lenders' returns: columns of coins rising left to right */
  growth: {
    aspect: 1.4,
    body: (p) => union(...([[0.2, 0.32], [0.53, 0.5], [0.86, 0.68], [1.19, 0.88]] as const).map(([x, h]) => box(p, x, 1 - h / 2, 0.12, h / 2))),
    detail: (p) => union(seg(p, [0.12, 0.5], [1.05, 0.06], 0.035), seg(p, [1.05, 0.06], [0.9, 0.06], 0.035), seg(p, [1.05, 0.06], [1.05, 0.2], 0.035)),
  },
} satisfies Record<string, Shape>;

export type ShapeName = keyof typeof SHAPES;

const BOUNDS = new Map<string, { cx: number; cy: number; w: number; h: number }>();

/** The silhouette's real extent in picture units, sampled once per picture. */
function bounds(name: string, pic: Shape) {
  const hit = BOUNDS.get(name);
  if (hit) return hit;
  const n = 120;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p: P = [(i / n) * pic.aspect * 1.2 - pic.aspect * 0.1, (j / n) * 1.2 - 0.1];
      if (pic.body(p) <= 0) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
    }
  }
  const b = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  BOUNDS.set(name, b);
  return b;
}

type Kind = "dot" | "ring" | "square" | "quarter" | "plus" | "minus" | "speck" | "check";

/** Mostly round glyphs, with the angular ones as accents. */
function pickKind(r: number): Kind {
  if (r < 0.4) return "dot";
  if (r < 0.56) return "square";
  if (r < 0.68) return "quarter";
  if (r < 0.8) return "ring";
  if (r < 0.88) return "plus";
  if (r < 0.93) return "minus";
  return "check";
}

function Glyph({ kind, x, y, s, color }: { kind: Kind; x: number; y: number; s: number; color: string }) {
  const c = s / 2;
  const cx = x + c;
  const cy = y + c;
  const r = s * 0.4;
  switch (kind) {
    case "dot":
      return <circle cx={cx} cy={cy} r={r} fill={color} />;
    case "ring":
      return <circle cx={cx} cy={cy} r={r - s * 0.08} fill="none" stroke={color} strokeWidth={s * 0.16} />;
    case "square":
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={s * 0.18} fill={color} />;
    case "quarter":
      return <path d={`M${cx - r} ${cy + r} L${cx - r} ${cy - r} A${r * 2} ${r * 2} 0 0 1 ${cx + r} ${cy + r} Z`} fill={color} />;
    case "plus":
      return (
        <g fill={color}>
          <rect x={cx - r} y={cy - s * 0.09} width={r * 2} height={s * 0.18} rx={s * 0.05} />
          <rect x={cx - s * 0.09} y={cy - r} width={s * 0.18} height={r * 2} rx={s * 0.05} />
        </g>
      );
    case "minus":
      return <rect x={cx - r} y={cy - s * 0.1} width={r * 2} height={s * 0.2} rx={s * 0.1} fill={color} />;
    case "check":
      return (
        <path
          d={`M${cx - r * 0.8} ${cy} L${cx - r * 0.2} ${cy + r * 0.6} L${cx + r * 0.85} ${cy - r * 0.6}`}
          fill="none"
          stroke={color}
          strokeWidth={s * 0.15}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "speck":
      return <circle cx={cx} cy={cy} r={s * 0.12} fill={color} />;
  }
}

export function GlyphField({
  tone = "on-orange",
  cell = 10,
  seed = 3,
  shape,
  anchor = 0.5,
  fit = 0.92,
  align = "bottom",
  className,
}: {
  tone?: Tone;
  /** cell size in px, glyph plus its gap */
  cell?: number;
  seed?: number;
  /** the picture to draw */
  shape: ShapeName;
  /** where the picture's centre sits across the box, 0 to 1 */
  anchor?: number;
  /** how much of the box the picture fills, 0 to 1 */
  fit?: number;
  /** sit the picture on the box's bottom edge, or centre it */
  align?: "bottom" | "center";
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colors = COLORS[tone];
  const glyphs: React.ReactNode[] = [];
  if (size && size.w > 0 && size.h > 0) {
    const pic: Shape = SHAPES[shape];
    // fit the picture's actual silhouette (not its nominal box, which some pictures don't fill evenly) inside the box
    // without stretching it, so it sits optically centred on the anchor, or on the bottom edge
    const b = bounds(shape, pic);
    const ph = Math.min((size.h * fit) / b.h, (size.w * fit) / b.w); // px per picture unit
    const half = (b.w * ph) / 2;
    const cx = Math.max(half, Math.min(size.w - half, size.w * anchor));
    const cy = align === "center" ? size.h / 2 : size.h - (b.h * ph) / 2;
    const ox = cx - b.cx * ph;
    const oy = cy - b.cy * ph;
    const eps = cell / ph; // one cell, in picture units
    const g = cell * 0.78; // the glyph inside its cell
    // the grid is laid out from the picture's centre outward, so a symmetric picture lands on the grid symmetrically
    const c0 = Math.ceil(cx / cell - 0.5);
    const c1 = Math.floor((size.w - cx) / cell - 0.5);
    const r0 = align === "center" ? Math.ceil(cy / cell - 0.5) : Math.floor(size.h / cell) - 1;
    const r1 = align === "center" ? Math.floor((size.h - cy) / cell - 0.5) : 0;
    for (let col = -c0; col <= c1; col++) {
      for (let row = -r0; row <= r1; row++) {
        const x = cx + col * cell - g / 2;
        const y = (align === "center" ? cy + row * cell : size.h - cell / 2 + row * cell) - g / 2;
        const p: P = [(x + g / 2 - ox) / ph, (y + g / 2 - oy) / ph];
        const d = pic.body(p);
        const key = `${col}-${row}`;
        const r = hash(col, row, seed + 11);
        // outside: open air, kept clean so the silhouette reads sharply
        if (d > 0) continue;
        // the picture's details are cut out, so they read as clean negative space inside the silhouette
        const dd = pic.detail ? pic.detail(p) : Infinity;
        if (dd < 0) continue;
        // a band of plain solid dots around each detail, so the cut-out reads crisply against the busy fill
        if (dd < eps * 1.6 && d < -eps * 0.8) {
          glyphs.push(<Glyph key={key} kind="dot" x={x} y={y} s={g} color={colors.glyph} />);
          continue;
        }
        // the edge turns to rings and plain dots
        if (d > -eps * 0.8) {
          glyphs.push(<Glyph key={key} kind={r < 0.4 ? "ring" : "dot"} x={x} y={y} s={g} color={colors.glyph} />);
          continue;
        }
        const lit = hash(col, row, seed + 29);
        if (lit < 0.005) {
          // a highlighted tile: a contrasting rounded square with a glyph inside, like the glyph set's dark cells
          glyphs.push(
            <g key={key}>
              <rect x={x} y={y} width={g} height={g} rx={g * 0.24} fill={colors.tile} />
              <Glyph kind={lit < 0.0025 ? "dot" : "square"} x={x + g * 0.2} y={y + g * 0.2} s={g * 0.6} color={colors.tileGlyph} />
            </g>,
          );
          continue;
        }
        const kind = pickKind(hash(col, row, seed + 3));
        const color = lit < 0.011 ? colors.pop : colors.glyph;
        glyphs.push(<Glyph key={key} kind={kind} x={x} y={y} s={g} color={color} />);
      }
    }
  }

  return (
    <div ref={box} aria-hidden className={cn("pointer-events-none overflow-hidden", className)}>
      {size ? (
        <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} className="block">
          {glyphs}
        </svg>
      ) : null}
    </div>
  );
}
