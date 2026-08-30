import { Router } from 'express';
import { z } from 'zod';
import { RISK_LEVELS, RISK_ORDER, type RiskLevel } from '@mri/shared';
import { ApiError } from '../errors.js';
import type { Storage } from '../storage/index.js';

const graphQuerySchema = z.object({
  minRisk: z.enum(RISK_LEVELS).optional(),
});

export function createGraphRoutes(storage: Storage): Router {
  const router = Router();

  /**
   * The cross-email knowledge graph.
   *
   * `minRisk` filters to nodes seen in at least one email at or above that
   * level, then keeps only edges whose endpoints both survive — otherwise the
   * client receives edges pointing at nodes it was never given.
   */
  router.get('/graph', (req, res) => {
    const parsed = graphQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.badRequest('Invalid query parameters.', parsed.error.issues);
    }

    const { nodes, edges } = storage.graph.getAggregateGraph();
    const floor = parsed.data.minRisk;

    const visible = floor
      ? nodes.filter(
          (node) => node.highestRisk && RISK_ORDER[node.highestRisk] >= RISK_ORDER[floor as RiskLevel],
        )
      : nodes;

    const visibleIds = new Set(visible.map((node) => node.id));

    res.json({
      nodes: visible.map((node) => ({
        id: node.id,
        type: node.type,
        name: node.displayName,
        mentionCount: node.mentionCount,
        emailIds: node.emailIds,
        highestRisk: node.highestRisk,
      })),
      edges: edges
        .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          evidence: edge.evidence,
          emailIds: edge.emailIds,
        })),
    });
  });

  /** One entity, its aliases, the emails it appears in, and its neighbours. */
  router.get('/entities/:id', (req, res) => {
    const entity = storage.graph.getEntity(req.params.id);
    if (!entity) throw ApiError.notFound('Entity');

    const { nodes, edges } = storage.graph.getAggregateGraph();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const connected = edges.filter(
      (edge) => edge.source === entity.id || edge.target === entity.id,
    );

    res.json({
      id: entity.id,
      type: entity.type,
      name: entity.displayName,
      canonicalKey: entity.canonicalKey,
      firstSeenAt: entity.firstSeenAt,
      aliases: storage.graph.getAliases(entity.id),
      emailIds: storage.graph.getEntityEmailIds(entity.id),
      neighbours: connected.map((edge) => {
        const isSource = edge.source === entity.id;
        const otherId = isSource ? edge.target : edge.source;
        const other = byId.get(otherId);
        return {
          direction: isSource ? ('outgoing' as const) : ('incoming' as const),
          type: edge.type,
          evidence: edge.evidence,
          emailIds: edge.emailIds,
          entity: other
            ? { id: other.id, name: other.displayName, type: other.type }
            : { id: otherId, name: 'unknown', type: 'person' as const },
        };
      }),
    });
  });

  return router;
}
