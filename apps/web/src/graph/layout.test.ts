import { describe, expect, it } from 'vitest';
import {
  clampScale,
  fitToView,
  hitTest,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  neighbourhood,
  nodeRadius,
  screenToWorld,
  worldToScreen,
  zoomAbout,
  type PositionedNode,
} from './layout.js';
import type { GraphEdge } from '../api/types.js';

const node = (id: string, x: number, y: number, mentionCount = 1): PositionedNode => ({
  id,
  type: 'person',
  name: id,
  mentionCount,
  emailIds: [],
  highestRisk: 'high',
  x,
  y,
});

const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  type: 'sends_to',
  evidence: '',
  emailIds: [],
});

describe('coordinate transforms', () => {
  it('round-trips a point through world and screen space', () => {
    const transform = { x: 40, y: -15, scale: 2.5 };
    const original = { x: 12, y: 34 };

    const result = screenToWorld(worldToScreen(original, transform), transform);

    expect(result.x).toBeCloseTo(original.x);
    expect(result.y).toBeCloseTo(original.y);
  });

  it('is the identity at the identity transform', () => {
    expect(worldToScreen({ x: 5, y: 7 }, IDENTITY)).toEqual({ x: 5, y: 7 });
  });
});

describe('zoomAbout', () => {
  it('keeps the point under the cursor fixed', () => {
    const transform = { x: 10, y: 20, scale: 1 };
    const cursor = { x: 200, y: 150 };

    const before = screenToWorld(cursor, transform);
    const after = screenToWorld(cursor, zoomAbout(transform, cursor, 1.8));

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps rather than letting zoom run away', () => {
    expect(zoomAbout(IDENTITY, { x: 0, y: 0 }, 1000).scale).toBe(MAX_SCALE);
    expect(zoomAbout(IDENTITY, { x: 0, y: 0 }, 0.0001).scale).toBe(MIN_SCALE);
    expect(clampScale(1)).toBe(1);
  });
});

describe('hitTest', () => {
  const nodes = [node('a', 0, 0), node('b', 100, 0)];

  it('finds a node under the point', () => {
    expect(hitTest(nodes, { x: 2, y: 2 })?.id).toBe('a');
    expect(hitTest(nodes, { x: 100, y: 0 })?.id).toBe('b');
  });

  it('returns null on empty space', () => {
    expect(hitTest(nodes, { x: 50, y: 50 })).toBeNull();
  });

  it('prefers the node drawn last where they overlap', () => {
    expect(hitTest([node('under', 0, 0), node('over', 0, 0)], { x: 0, y: 0 })?.id).toBe('over');
  });

  it('gives a larger target to a widely-referenced node', () => {
    expect(nodeRadius(12)).toBeGreaterThan(nodeRadius(1));
    // Growth is bounded, so one hub cannot swamp the canvas.
    expect(nodeRadius(1_000)).toBeLessThanOrEqual(16);
  });
});

describe('neighbourhood', () => {
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('d', 'a')];

  it('includes the node and everything one hop away, in both directions', () => {
    expect(neighbourhood(edges, 'a')).toEqual(new Set(['a', 'b', 'd']));
  });

  it('is empty with nothing selected', () => {
    expect(neighbourhood(edges, null).size).toBe(0);
  });

  it('returns just the node when it has no edges', () => {
    expect(neighbourhood(edges, 'lonely')).toEqual(new Set(['lonely']));
  });
});

describe('fitToView', () => {
  it('centres the graph in the viewport', () => {
    const transform = fitToView([node('a', -100, -100), node('b', 100, 100)], 800, 600);
    const a = worldToScreen({ x: -100, y: -100 }, transform);
    const b = worldToScreen({ x: 100, y: 100 }, transform);

    expect((a.x + b.x) / 2).toBeCloseTo(400);
    expect((a.y + b.y) / 2).toBeCloseTo(300);
  });

  it('keeps every node inside the viewport', () => {
    const nodes = [node('a', -500, -500), node('b', 500, 500), node('c', 0, 250)];
    const transform = fitToView(nodes, 800, 600);

    for (const n of nodes) {
      const screen = worldToScreen(n, transform);
      expect(screen.x).toBeGreaterThanOrEqual(0);
      expect(screen.x).toBeLessThanOrEqual(800);
      expect(screen.y).toBeGreaterThanOrEqual(0);
      expect(screen.y).toBeLessThanOrEqual(600);
    }
  });

  it('falls back to the identity for an empty graph', () => {
    expect(fitToView([], 800, 600)).toEqual(IDENTITY);
  });
});
