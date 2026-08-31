import type { RiskLevel } from '@mri/shared';
import type { GraphEdge, GraphNode } from '../api/types.js';

/**
 * Geometry and selection logic for the knowledge graph, kept free of canvas
 * and React so it can be tested directly. The component below is then only
 * responsible for drawing and for wiring events.
 */

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, scale: 1 };

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const worldToScreen = (
  point: { x: number; y: number },
  transform: Transform,
): { x: number; y: number } => ({
  x: point.x * transform.scale + transform.x,
  y: point.y * transform.scale + transform.y,
});

export const screenToWorld = (
  point: { x: number; y: number },
  transform: Transform,
): { x: number; y: number } => ({
  x: (point.x - transform.x) / transform.scale,
  y: (point.y - transform.y) / transform.scale,
});

/**
 * Zooms about a fixed screen point, so the spot under the cursor stays put.
 * Zooming about the origin instead makes the graph feel like it is sliding
 * away from you.
 */
export function zoomAbout(
  transform: Transform,
  screenPoint: { x: number; y: number },
  factor: number,
): Transform {
  const scale = clampScale(transform.scale * factor);
  const applied = scale / transform.scale;

  return {
    scale,
    x: screenPoint.x - (screenPoint.x - transform.x) * applied,
    y: screenPoint.y - (screenPoint.y - transform.y) * applied,
  };
}

/** Widely-referenced entities are drawn larger, with diminishing returns. */
export const nodeRadius = (mentionCount: number): number =>
  6 + Math.min(10, Math.sqrt(Math.max(0, mentionCount - 1)) * 4);

/** Topmost node under a world-space point, or null. Later nodes draw on top. */
export function hitTest(
  nodes: readonly PositionedNode[],
  world: { x: number; y: number },
): PositionedNode | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node) continue;

    const radius = nodeRadius(node.mentionCount);
    const dx = node.x - world.x;
    const dy = node.y - world.y;
    // Generous by 4px, so small nodes stay clickable on a touch screen.
    if (dx * dx + dy * dy <= (radius + 4) ** 2) return node;
  }
  return null;
}

/** The selected node plus everything one hop away. */
export function neighbourhood(
  edges: readonly GraphEdge[],
  nodeId: string | null,
): Set<string> {
  if (!nodeId) return new Set();

  const ids = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return ids;
}

export const RISK_NODE_COLOR: Record<RiskLevel | 'unknown', string> = {
  high: '#a8321f',
  medium: '#8a5a12',
  low: '#1f6383',
  none: '#5b6470',
  unknown: '#9aa3ae',
};

export const nodeColor = (node: GraphNode): string =>
  RISK_NODE_COLOR[node.highestRisk ?? 'unknown'];

/**
 * Centres and scales the graph so every node is on screen.
 * A single node cannot define a bounding box, so it just gets centred.
 */
export function fitToView(
  nodes: readonly PositionedNode[],
  width: number,
  height: number,
  padding = 48,
): Transform {
  if (nodes.length === 0) return IDENTITY;

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const scale = clampScale(
    Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY),
  );

  return {
    scale,
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
  };
}
