import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from 'd3-force';
import type { GraphEdge, GraphNode } from '../api/types.js';
import {
  fitToView,
  hitTest,
  IDENTITY,
  neighbourhood,
  nodeColor,
  nodeRadius,
  screenToWorld,
  worldToScreen,
  zoomAbout,
  type PositionedNode,
  type Transform,
} from '../graph/layout.js';
import { EmptyState } from './States.js';

/**
 * The cross-email knowledge graph.
 *
 * Canvas rather than SVG: a few hundred nodes redrawn on every simulation tick
 * is more than the DOM wants to handle, and the drawing is simple enough that
 * we lose nothing by giving up elements.
 *
 * Canvas is also invisible to assistive technology, so the picture is paired
 * with a real list of entities beside it. The list is the keyboard and screen
 * reader route to exactly the same selection — not a lesser fallback, but the
 * same interaction in another modality.
 */

/**
 * d3 seeds node positions itself, in a phyllotaxis spiral around the origin —
 * but only for nodes whose `x`/`y` are absent. Supplying `x: 0, y: 0` up front
 * leaves every node coincident, which gives the charge force no direction to
 * push in and collapses the whole layout into a dot. So `x`/`y` are optional
 * here and filled in by the simulation.
 */
interface SimNode extends GraphNode {
  x?: number;
  y?: number;
  index?: number;
  vx?: number;
  vy?: number;
}

/** After the simulation has initialised, every node has coordinates. */
const positioned = (nodes: readonly SimNode[]): PositionedNode[] =>
  nodes.map((node) => ({ ...node, x: node.x ?? 0, y: node.y ?? 0 }));

interface SimLink {
  source: PositionedNode;
  target: PositionedNode;
  edge: GraphEdge;
}

export function GraphView({
  nodes,
  edges,
  onOpenEmail,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpenEmail(emailId: string): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>(IDENTITY);
  const simNodesRef = useRef<SimNode[]>([]);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  /** Set once the user pans or zooms, so we stop reframing under them. */
  const userAdjusted = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });

  const highlighted = useMemo(() => neighbourhood(edges, selectedId), [edges, selectedId]);
  const selected = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const connections = useMemo(
    () =>
      selectedId
        ? edges
            .filter((edge) => edge.source === selectedId || edge.target === selectedId)
            .map((edge) => {
              const outgoing = edge.source === selectedId;
              const otherId = outgoing ? edge.target : edge.source;
              return {
                edge,
                outgoing,
                other: nodes.find((node) => node.id === otherId) ?? null,
              };
            })
        : [],
    [edges, nodes, selectedId],
  );

  // Track the container size so the canvas stays crisp and correctly scaled.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size;
    const transform = transformRef.current;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const dimmed = selectedId !== null;

    const drawn = positioned(simNodesRef.current);
    // Boxes of labels already painted, so a later one can yield rather than
    // stack on top of an earlier one.
    const labelBoxes: { x1: number; y1: number; x2: number; y2: number }[] = [];

    for (const link of buildLinks(drawn, edges)) {
      const active = !dimmed || (highlighted.has(link.edge.source) && highlighted.has(link.edge.target));
      const from = worldToScreen(link.source, transform);
      const to = worldToScreen(link.target, transform);

      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.strokeStyle = active ? 'rgba(90,100,115,0.55)' : 'rgba(150,158,170,0.12)';
      context.lineWidth = active ? 1.4 : 1;
      context.stroke();
    }

    for (const node of drawn) {
      const active = !dimmed || highlighted.has(node.id);
      const point = worldToScreen(node, transform);
      // Scale with zoom, but never below a clickable size — a fitted graph
      // sits around 0.3x, which would render every node as a speck.
      const radius =
        nodeRadius(node.mentionCount) * Math.max(0.7, Math.min(1.4, transform.scale));

      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = nodeColor(node);
      context.globalAlpha = active ? 1 : 0.15;
      context.fill();

      if (node.id === selectedId) {
        context.lineWidth = 3;
        context.strokeStyle = '#1d4ed8';
        context.stroke();
      }

      // Labels only where they will be legible and not overlap into mush.
      if (active && (transform.scale > 0.7 || node.mentionCount > 1)) {
        const label = truncate(node.name);
        context.font = '11px ui-sans-serif, system-ui, sans-serif';
        context.textAlign = 'center';

        const half = context.measureText(label).width / 2 + 2;
        const baseline = point.y + radius + 12;
        const box = { x1: point.x - half, y1: baseline - 10, x2: point.x + half, y2: baseline + 3 };
        const collides = labelBoxes.some(
          (other) =>
            box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1,
        );

        // Drop a colliding label rather than painting mush. The entity is
        // still identifiable by clicking it, or from the list beside the graph.
        if (collides) {
          context.globalAlpha = 1;
          continue;
        }
        labelBoxes.push(box);

        context.globalAlpha = active ? 1 : 0.2;
        // Stroke a light halo first: in a dense cluster labels overlap, and
        // without this they turn into unreadable mush.
        context.lineWidth = 3;
        context.strokeStyle = 'rgba(255,255,255,0.9)';
        context.strokeText(label, point.x, baseline);
        context.fillStyle = '#26303c';
        context.fillText(label, point.x, baseline);
      }
      context.globalAlpha = 1;
    }
  }, [edges, highlighted, selectedId, size]);

  // Build and run the force simulation whenever the data changes.
  useEffect(() => {
    simRef.current?.stop();

    const simNodes: SimNode[] = nodes.map((node) => ({ ...node }));
    const byId = new Map(simNodes.map((node) => [node.id, node]));
    const links = edges
      .map((edge) => ({ source: byId.get(edge.source), target: byId.get(edge.target) }))
      .filter((link): link is { source: SimNode; target: SimNode } =>
        Boolean(link.source && link.target),
      );

    simNodesRef.current = simNodes;

    const simulation = forceSimulation(simNodes)
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<SimNode>().radius((node) => nodeRadius(node.mentionCount) + 14))
      .force(
        'link',
        forceLink(links)
          .id((node) => (node as SimNode).id)
          .distance(90)
          .strength(0.35),
      )
      .on('tick', draw);

    simRef.current = simulation as unknown as Simulation<SimNode, undefined>;

    // Settle off-screen, then frame the result, so the graph does not visibly
    // explode outwards on first paint.
    simulation.tick(120);
    userAdjusted.current = false;
    transformRef.current = fitToView(positioned(simNodes), size.width, size.height);
    draw();

    return () => {
      simulation.stop();
    };
    // `draw` and `size` are intentionally excluded: relaying out the graph on
    // every resize would throw away the user's pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Reframe on resize, but only while the view is still ours to choose. Once
  // the user has panned or zoomed, refitting would yank the graph out from
  // under them; before that, keeping a stale fit just leaves nodes off-screen.
  useEffect(() => {
    if (!userAdjusted.current && simNodesRef.current.length > 0) {
      transformRef.current = fitToView(
        positioned(simNodesRef.current),
        size.width,
        size.height,
      );
    }
    draw();
  }, [draw, size]);

  // --- interaction --------------------------------------------------------

  const dragState = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const localPoint = (event: React.PointerEvent | React.WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    dragState.current = { x: point.x, y: point.y, moved: false };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragState.current;
    if (!drag) return;

    const point = localPoint(event);
    const dx = point.x - drag.x;
    const dy = point.y - drag.y;
    // A few pixels of slop, so a click with a shaky hand is still a click.
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
      userAdjusted.current = true;
    }

    transformRef.current = {
      ...transformRef.current,
      x: transformRef.current.x + dx,
      y: transformRef.current.y + dy,
    };
    dragState.current = { x: point.x, y: point.y, moved: drag.moved };
    draw();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag || drag.moved) return;

    const world = screenToWorld(localPoint(event), transformRef.current);
    const hit = hitTest(positioned(simNodesRef.current), world);
    setSelectedId(hit ? hit.id : null);
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    userAdjusted.current = true;
    transformRef.current = zoomAbout(
      transformRef.current,
      localPoint(event),
      event.deltaY < 0 ? 1.12 : 1 / 1.12,
    );
    draw();
  };

  const resetView = () => {
    userAdjusted.current = false;
    transformRef.current = fitToView(positioned(simNodesRef.current), size.width, size.height);
    draw();
  };

  if (nodes.length === 0) {
    return (
      <EmptyState
        title="No graph yet"
        description="Entities appear here once emails have been through the pipeline."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div ref={wrapperRef} className="bg-surface relative min-h-[420px] flex-1">
        <canvas
          ref={canvasRef}
          style={{ width: size.width, height: size.height }}
          className="block touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          aria-hidden="true"
        />

        <div className="absolute left-3 top-3 flex gap-2">
          <button
            type="button"
            onClick={resetView}
            className="border-line bg-surface/90 hover:bg-surface rounded-md border px-2.5 py-1 text-xs font-medium shadow-sm"
          >
            Reset view
          </button>
          {selectedId && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="border-line bg-surface/90 hover:bg-surface rounded-md border px-2.5 py-1 text-xs font-medium shadow-sm"
            >
              Clear selection
            </button>
          )}
        </div>

        <p className="text-ink-muted absolute bottom-3 left-3 text-[11px]">
          Drag to pan · scroll to zoom · click a node
        </p>
      </div>

      {/* The accessible, keyboard-navigable route to the same selection. */}
      <aside className="border-line bg-surface-muted flex max-h-[40vh] min-h-0 flex-col overflow-y-auto border-t lg:max-h-none lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
        {selected ? (
          <div className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-ink-muted text-[11px] uppercase tracking-wide">{selected.type}</p>
              <h3 className="text-base font-semibold">{selected.name}</h3>
              <p className="text-ink-muted mt-1 text-xs">
                Seen in {selected.emailIds.length} email
                {selected.emailIds.length === 1 ? '' : 's'}
                {selected.highestRisk && <> · highest risk {selected.highestRisk}</>}
              </p>
            </div>

            <div>
              <h4 className="text-ink-muted text-[11px] font-semibold uppercase tracking-wide">
                Connections
              </h4>
              {connections.length === 0 ? (
                <p className="text-ink-muted mt-1.5 text-xs">
                  No relationships recorded for this entity.
                </p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {connections.map(({ edge, outgoing, other }) => (
                    <li
                      key={edge.id}
                      className="border-line bg-surface rounded-md border px-2 py-1.5 text-xs"
                    >
                      <span className="text-ink-muted">
                        {outgoing ? '→' : '←'} {edge.type.replace(/_/g, ' ')}
                      </span>{' '}
                      <span className="font-medium">{other?.name ?? 'unknown'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="text-ink-muted text-[11px] font-semibold uppercase tracking-wide">
                Appears in
              </h4>
              <ul className="mt-1.5 flex flex-col gap-1">
                {selected.emailIds.map((emailId) => (
                  <li key={emailId}>
                    <button
                      type="button"
                      onClick={() => onOpenEmail(emailId)}
                      className="text-accent text-left text-xs font-medium hover:underline"
                    >
                      Open email
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <h3 className="text-sm font-semibold">Entities</h3>
            <p className="text-ink-muted mt-1 text-xs">
              Select one to highlight its connections in the graph.
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {[...nodes]
                .sort((a, b) => b.mentionCount - a.mentionCount)
                .map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(node.id)}
                      className="hover:bg-surface flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: nodeColor(node) }}
                      />
                      <span className="truncate font-medium">{node.name}</span>
                      <span className="text-ink-muted ml-auto shrink-0">{node.mentionCount}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

const truncate = (value: string, max = 22): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

function buildLinks(nodes: readonly PositionedNode[], edges: readonly GraphEdge[]): SimLink[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links: SimLink[] = [];

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source && target) links.push({ source, target, edge });
  }
  return links;
}
