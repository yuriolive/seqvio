/**
 * Stroke path geometry – align pen tip with visible stroke-dash head (round caps).
 */

import { Point } from '../types';

export function resolvePathLength(
  pathElement: SVGPathElement | null,
  fallback = 0
): number {
  if (!pathElement) return fallback;
  const length = pathElement.getTotalLength();
  return length > 0 ? length : fallback;
}

/**
 * Map a point from a path's own coordinate system into the scene.
 *
 * `getPointAtLength` reports coordinates in the path's local user space, which
 * ignores every transform on its ancestors. Most drawables author their geometry
 * directly in scene pixels, so local space and scene space coincide and this is
 * the identity. `DrawIcon` does not: its geometry lives in a 24x24 icon viewBox
 * and is placed with `translate(...) scale(...)` on a wrapping <g>. Consuming
 * its raw local points put the following pen near the scene origin instead of on
 * the icon.
 *
 * Applying the element's own CTM covers both cases and any future transformed
 * drawable. The matrix is applied by hand rather than via DOMPoint so this stays
 * usable outside a full browser environment.
 */
export function applyElementTransform(
  pathElement: SVGPathElement,
  point: { x: number; y: number }
): Point {
  const m =
    typeof pathElement.getCTM === 'function' ? pathElement.getCTM() : null;
  if (!m) return { x: point.x, y: point.y };
  return {
    x: m.a * point.x + m.c * point.y + m.e,
    y: m.b * point.x + m.d * point.y + m.f,
  };
}

/**
 * Point and tangent angle at the visible stroke head for dashoffset animation.
 * Offsets slightly along the tangent so the nib meets the round line cap.
 */
/**
 * Number of sample steps taken to each side of the head when averaging the
 * tangent. Small enough to stay inside a short sub-stroke, large enough to
 * smooth out roughjs jitter.
 */
const TANGENT_SAMPLE_STEPS = 4;

/**
 * A step longer than `delta * JUMP_STEP_RATIO` cannot be real stroke travel at
 * this sampling density, so it is treated as a pen-up move between sub-paths.
 */
const JUMP_STEP_RATIO = 3;

/**
 * Point and tangent angle at the visible stroke head for dashoffset animation.
 * Offsets slightly along the tangent so the nib meets the round line cap.
 *
 * A hand-drawn path is not one continuous stroke. roughjs emits a single `d`
 * containing many disconnected sub-paths (a jittered rectangle has eight `M`
 * commands, because every edge is drawn twice), and `getPointAtLength` walks
 * straight through those gaps as if they were stroke. Sampling a tangent across
 * such a gap yields the direction of the jump rather than of the stroke, which
 * made the pen spin and skate across the shape.
 *
 * So the tangent is averaged only over the contiguous run of samples that
 * contains the head: walking outward stops at the first gap. When the head sits
 * on a gap there is no meaningful direction, and `penUp` is returned so callers
 * can hold the previous angle instead of snapping to a bogus one.
 */
export function getStrokeHeadOnPath(
  pathElement: SVGPathElement,
  progress: number,
  strokeWidth = 2
): { point: Point; angleDeg: number; penUp: boolean } {
  const length = pathElement.getTotalLength();
  if (length <= 0) {
    return { point: { x: 0, y: 0 }, angleDeg: 0, penUp: true };
  }

  const t = Math.max(0, Math.min(1, progress));
  const headDist = Math.min(length, t * length);
  const point = applyElementTransform(
    pathElement,
    pathElement.getPointAtLength(headDist)
  );

  const delta = Math.max(0.5, length * 0.008);
  const maxStep = delta * JUMP_STEP_RATIO;

  const at = (d: number) =>
    pathElement.getPointAtLength(Math.max(0, Math.min(length, d)));

  // One sampling step, or null when it crosses a sub-path gap (or is degenerate).
  // Gap detection runs on local distances, which share units with `delta`; the
  // direction is taken in scene space so a scaled element reports a scene angle.
  const step = (from: number, to: number): { dx: number; dy: number } | null => {
    if (to <= 0 || from >= length || Math.abs(to - from) < 1e-6) return null;
    const localA = at(from);
    const localB = at(to);
    const localDist = Math.hypot(localB.x - localA.x, localB.y - localA.y);
    if (localDist < 1e-6 || localDist > maxStep) return null;
    const a = applyElementTransform(pathElement, localA);
    const b = applyElementTransform(pathElement, localB);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return null;
    return { dx: dx / d, dy: dy / d };
  };

  let sumX = 0;
  let sumY = 0;
  let used = 0;

  // Walk forward from the head, stopping at the first gap.
  for (let i = 0; i < TANGENT_SAMPLE_STEPS; i++) {
    const s = step(headDist + i * delta, headDist + (i + 1) * delta);
    if (!s) break;
    sumX += s.dx;
    sumY += s.dy;
    used++;
  }

  // Walk backward from the head, stopping at the first gap.
  for (let i = 0; i < TANGENT_SAMPLE_STEPS; i++) {
    const s = step(headDist - (i + 1) * delta, headDist - i * delta);
    if (!s) break;
    sumX += s.dx;
    sumY += s.dy;
    used++;
  }

  const magnitude = Math.hypot(sumX, sumY);
  if (used === 0 || magnitude < 1e-6) {
    // Head is sitting on a gap between sub-strokes: no direction to report.
    return { point: { x: point.x, y: point.y }, angleDeg: 0, penUp: true };
  }

  const angleRad = Math.atan2(sumY / magnitude, sumX / magnitude);
  const capOffset = Math.min(strokeWidth * 0.35, delta * 2);

  return {
    point: {
      x: point.x + Math.cos(angleRad) * capOffset,
      y: point.y + Math.sin(angleRad) * capOffset,
    },
    angleDeg: (angleRad * 180) / Math.PI,
    penUp: false,
  };
}

export function lerpAngleDegrees(
  current: number,
  target: number,
  factor: number
): number {
  let delta = target - current;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return current + delta * factor;
}
