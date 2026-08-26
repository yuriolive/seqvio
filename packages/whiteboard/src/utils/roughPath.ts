/**
 * Excalidraw-style hand-drawn paths via roughjs (seeded for stable video frames).
 */

import { RoughGenerator } from 'roughjs/bin/generator';
import type { Options } from 'roughjs/bin/core';
import { Point } from '../types';
import {
  createArrowPath,
  createRoundedRectanglePath,
  createUnderlinePath,
} from './pathUtils';

let generator: RoughGenerator | null = null;

function getGenerator(): RoughGenerator {
  if (!generator) {
    generator = new RoughGenerator();
  }
  return generator;
}

export interface RoughStyle {
  roughness: number;
  bowing: number;
  seed: number;
}

/** Sketchy interior fill: hachure and friends are drawn as strokes, not a fill. */
export interface RoughFill {
  color: string;
  style?: 'hachure' | 'cross-hatch' | 'zigzag' | 'dots' | 'dashed' | 'zigzag-line';
  /** Spacing between hachure lines in px. */
  gap?: number;
  /** Stroke width of the hachure lines. */
  weight?: number;
  /** Hachure angle in degrees. */
  angle?: number;
}

/**
 * Outline and interior sketch as two separate `d` strings.
 *
 * They must stay separate. The outline is what `Hand` follows, and mixing fill
 * geometry into it makes the pen jump across the shape (see the fill: 'none'
 * regression in git history). Callers render the interior as its own path.
 */
export interface RoughParts {
  outline: string;
  fill: string;
}

export function hashRoughSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2_147_483_647 || 1;
}

function roughOptions(style: RoughStyle): Options {
  return {
    roughness: style.roughness,
    bowing: style.bowing,
    seed: style.seed,
    stroke: '#000',
    strokeWidth: 1,
    // `fill` is deliberately omitted, never set to 'none'. roughjs reads fill as
    // a colour string, so 'none' is a request to fill — it emits a `fillSketch`
    // set of hachure lines exactly as `fill: 'red'` would. drawableToPathD then
    // concatenates every set into one `d`, so those hachure lines were stroked
    // as part of the outline: shapes appeared crosshatched (unreadable behind
    // text, and immune to the caller's fillColor="none"), and the path gained
    // hundreds of disconnected sub-strokes with jumps as long as the shape's
    // diagonal, which made the pen teleport and spin while following it.
    // Omitting fill takes a 500x220 rectangle from 532 segments / 264 jumps to
    // 8 segments / 3 jumps.
    disableMultiStroke: true,
    preserveVertices: false,
  };
}

function fillOptions(fill: RoughFill | undefined): Options {
  if (!fill) return {};
  return {
    fill: fill.color,
    fillStyle: fill.style ?? 'hachure',
    hachureGap: fill.gap ?? 5,
    fillWeight: fill.weight ?? 1.4,
    hachureAngle: fill.angle ?? -41,
  };
}

/**
 * Split a drawable into outline (`path` sets) and interior (`fillSketch` /
 * `fillPath` sets), keeping each as its own `d`.
 */
function drawableToParts(
  gen: RoughGenerator,
  drawable: ReturnType<RoughGenerator['line']>
): RoughParts {
  const outline: string[] = [];
  const fill: string[] = [];
  for (const set of drawable.sets) {
    const d = gen.opsToPath(set);
    if (!d) continue;
    if (set.type === 'path') outline.push(d);
    else fill.push(d);
  }
  return { outline: outline.join(' '), fill: fill.join(' ') };
}

export function roughRectangleParts(
  x: number,
  y: number,
  width: number,
  height: number,
  style: RoughStyle,
  fill?: RoughFill
): RoughParts {
  const gen = getGenerator();
  return drawableToParts(
    gen,
    gen.rectangle(x, y, width, height, {
      ...roughOptions(style),
      ...fillOptions(fill),
    })
  );
}

export function roughCircleParts(
  center: Point,
  diameter: number,
  style: RoughStyle,
  fill?: RoughFill
): RoughParts {
  const gen = getGenerator();
  return drawableToParts(
    gen,
    gen.circle(center.x, center.y, diameter, {
      ...roughOptions(style),
      ...fillOptions(fill),
    })
  );
}

function drawableToPathD(gen: RoughGenerator, drawable: ReturnType<RoughGenerator['line']>): string {
  const paths = gen.toPaths(drawable);
  if (paths.length === 0) {
    return '';
  }
  // Keep only outline geometry. roughjs returns fill geometry (hachure lines)
  // as separate entries whose `fill` is set and whose `stroke` is 'none';
  // concatenating those into the stroked outline `d` is what previously made
  // shapes look crosshatched and made the following pen jump around.
  const outline = paths.filter((p) => p.stroke !== 'none');
  return (outline.length > 0 ? outline : paths).map((p) => p.d).join(' ');
}

export function roughLine(
  from: Point,
  to: Point,
  style: RoughStyle
): string {
  const gen = getGenerator();
  const drawable = gen.line(from.x, from.y, to.x, to.y, roughOptions(style));
  return drawableToPathD(gen, drawable);
}

export function roughRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  style: RoughStyle
): string {
  const gen = getGenerator();
  const drawable = gen.rectangle(x, y, width, height, roughOptions(style));
  return drawableToPathD(gen, drawable);
}

export function roughCircle(
  center: Point,
  diameter: number,
  style: RoughStyle
): string {
  const gen = getGenerator();
  // roughjs circle(x, y, diameter) takes the CENTER coordinates
  const drawable = gen.circle(center.x, center.y, diameter, roughOptions(style));
  return drawableToPathD(gen, drawable);
}

export function roughPathFromSvg(
  pathD: string,
  style: RoughStyle
): string {
  const gen = getGenerator();
  const drawable = gen.path(pathD, roughOptions(style));
  return drawableToPathD(gen, drawable);
}

export function roughRoundedRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  style: RoughStyle
): string {
  const d = createRoundedRectanglePath(x, y, width, height, radius);
  return roughPathFromSvg(d, style);
}

export function roughArrow(from: Point, to: Point, style: RoughStyle): string {
  return roughPathFromSvg(createArrowPath(from, to), style);
}

export function roughUnderline(
  x: number,
  y: number,
  length: number,
  style: RoughStyle
): string {
  return roughPathFromSvg(createUnderlinePath(x, y, length), style);
}

export function roughStarPath(center: Point, size: number, style: RoughStyle): string {
  const points = 5;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * 0.4;
  let d = '';

  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }

  return roughPathFromSvg(`${d} Z`, style);
}
