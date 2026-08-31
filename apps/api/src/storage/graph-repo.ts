import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import {
  RISK_ORDER,
  normalizeEntityKey,
  type EntityType,
  type ExtractedEntity,
  type ExtractedRelationship,
  type RiskLevel,
} from '@mri/shared';
import { transaction } from './db.js';
import { resolveEndpoint, type ResolvableEntity } from './endpoint-resolver.js';
import type {
  EmailGraph,
  EntityRecord,
  PriorEntityContext,
  EntityWithMention,
  GraphEdge,
  GraphNode,
  RelationshipRecord,
} from './types.js';

/** Raw SQL row. The index signature is what `node:sqlite` hands back, so
 *  declaring it here keeps the cast honest instead of double-casting. */
interface EntityRow {
  [column: string]: SQLOutputValue;
  id: string;
  type: string;
  canonical_key: string;
  display_name: string;
  first_seen_at: string;
}

const toEntity = (row: EntityRow): EntityRecord => ({
  id: row.id,
  type: row.type as EntityType,
  canonicalKey: row.canonical_key,
  displayName: row.display_name,
  firstSeenAt: row.first_seen_at,
});

const normalizeAlias = (value: string): string => value.trim().toLowerCase();

const higherRisk = (a: RiskLevel | null, b: RiskLevel | null): RiskLevel | null => {
  if (!a) return b;
  if (!b) return a;
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
};

/** What `persistFragment` did, so the orchestrator can log honest counts. */
export interface FragmentResult {
  entityCount: number;
  relationshipCount: number;
  droppedEntities: number;
  droppedRelationships: number;
}

export function createGraphRepo(db: DatabaseSync) {
  /**
   * Finds or creates the canonical entity for a mention, and records the exact
   * surface form as an alias. This is the one place entity identity is decided.
   */
  const upsertEntity = (type: EntityType, displayName: string): EntityRecord | null => {
    const canonicalKey = normalizeEntityKey(type, displayName);
    if (!canonicalKey) return null;

    const existing = db
      .prepare('SELECT * FROM entities WHERE type = ? AND canonical_key = ?')
      .get(type, canonicalKey) as EntityRow | undefined;

    let entity: EntityRecord;
    if (existing) {
      entity = toEntity(existing);
    } else {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO entities (id, type, canonical_key, display_name, first_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, type, canonicalKey, displayName.trim(), new Date().toISOString());
      entity = {
        id,
        type,
        canonicalKey,
        displayName: displayName.trim(),
        firstSeenAt: new Date().toISOString(),
      };
    }

    db.prepare(
      `INSERT INTO entity_aliases (id, entity_id, alias, normalized_alias)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(entity_id, normalized_alias) DO NOTHING`,
    ).run(randomUUID(), entity.id, displayName.trim(), normalizeAlias(displayName));

    return entity;
  };

  return {
    upsertEntity,

    /**
     * Writes one email's graph fragment for one run, atomically.
     *
     * Mentions and relationships are keyed by run, so reprocessing an email
     * produces a fresh fragment rather than duplicating the old one, while the
     * previous run's fragment stays queryable for the audit trail.
     */
    persistFragment(input: {
      emailId: string;
      runId: string;
      entities: readonly ExtractedEntity[];
      relationships: readonly ExtractedRelationship[];
    }): FragmentResult {
      return transaction(db, () => {
        const resolvable: ResolvableEntity[] = [];
        let droppedEntities = 0;

        for (const extracted of input.entities) {
          const entity = upsertEntity(extracted.type, extracted.name);
          if (!entity) {
            droppedEntities += 1;
            continue;
          }

          db.prepare(
            `INSERT INTO entity_mentions (id, entity_id, email_id, run_id, surface_form, context)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(entity_id, run_id) DO UPDATE SET context = excluded.context`,
          ).run(randomUUID(), entity.id, input.emailId, input.runId, extracted.name, extracted.context);

          resolvable.push({
            id: entity.id,
            type: entity.type,
            canonicalKey: entity.canonicalKey,
            displayName: extracted.name,
          });
        }

        let relationshipCount = 0;
        let droppedRelationships = 0;

        for (const relationship of input.relationships) {
          const source = resolveEndpoint(relationship.source, resolvable);
          const target = resolveEndpoint(relationship.target, resolvable);

          // Self-edges carry no information and clutter the graph view.
          if (!source || !target || source.id === target.id) {
            droppedRelationships += 1;
            continue;
          }

          db.prepare(
            `INSERT INTO relationships
               (id, source_entity_id, target_entity_id, type, email_id, run_id, evidence)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source_entity_id, target_entity_id, type, run_id)
               DO UPDATE SET evidence = excluded.evidence`,
          ).run(
            randomUUID(),
            source.id,
            target.id,
            relationship.type,
            input.emailId,
            input.runId,
            relationship.evidence,
          );
          relationshipCount += 1;
        }

        return {
          entityCount: resolvable.length,
          relationshipCount,
          droppedEntities,
          droppedRelationships,
        };
      });
    },

    /** The graph fragment shown alongside a single email. */
    getEmailGraph(emailId: string): EmailGraph {
      const entities = (
        db
          .prepare(
            `SELECT en.*, m.surface_form, m.context
               FROM entity_mentions m
               JOIN entities en ON en.id = m.entity_id
               JOIN emails    e  ON e.id = m.email_id AND e.latest_run_id = m.run_id
              WHERE m.email_id = ?
              ORDER BY en.type, en.display_name`,
          )
          .all(emailId) as (EntityRow & { surface_form: string; context: string })[]
      ).map((row): EntityWithMention => ({
        ...toEntity(row),
        surfaceForm: row.surface_form,
        context: row.context,
      }));

      const relationships = (
        db
          .prepare(
            `SELECT r.id, r.type, r.evidence, r.email_id,
                    s.id AS s_id, s.type AS s_type, s.canonical_key AS s_key,
                    s.display_name AS s_name, s.first_seen_at AS s_seen,
                    t.id AS t_id, t.type AS t_type, t.canonical_key AS t_key,
                    t.display_name AS t_name, t.first_seen_at AS t_seen
               FROM relationships r
               JOIN emails   e ON e.id = r.email_id AND e.latest_run_id = r.run_id
               JOIN entities s ON s.id = r.source_entity_id
               JOIN entities t ON t.id = r.target_entity_id
              WHERE r.email_id = ?`,
          )
          .all(emailId) as Record<string, string>[]
      ).map(
        (row): RelationshipRecord => ({
          id: row.id ?? '',
          type: row.type ?? '',
          evidence: row.evidence ?? '',
          emailId: row.email_id ?? '',
          source: {
            id: row.s_id ?? '',
            type: (row.s_type ?? 'person') as EntityType,
            canonicalKey: row.s_key ?? '',
            displayName: row.s_name ?? '',
            firstSeenAt: row.s_seen ?? '',
          },
          target: {
            id: row.t_id ?? '',
            type: (row.t_type ?? 'person') as EntityType,
            canonicalKey: row.t_key ?? '',
            displayName: row.t_name ?? '',
            firstSeenAt: row.t_seen ?? '',
          },
        }),
      );

      return { entities, relationships };
    },

    /**
     * The cross-email graph. Only current runs contribute, so superseded
     * fragments do not linger as phantom nodes after a reprocess.
     */
    getAggregateGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
      const mentionRows = db
        .prepare(
          `SELECT en.*, m.email_id, r.level AS risk_level
             FROM entity_mentions m
             JOIN entities en ON en.id = m.entity_id
             JOIN emails   e  ON e.id = m.email_id AND e.latest_run_id = m.run_id
             LEFT JOIN risk_assessments r ON r.run_id = e.latest_run_id`,
        )
        .all() as (EntityRow & { email_id: string; risk_level: string | null })[];

      const nodes = new Map<string, GraphNode>();
      for (const row of mentionRows) {
        const existing = nodes.get(row.id);
        const level = (row.risk_level as RiskLevel | null) ?? null;

        if (existing) {
          existing.mentionCount += 1;
          if (!existing.emailIds.includes(row.email_id)) existing.emailIds.push(row.email_id);
          existing.highestRisk = higherRisk(existing.highestRisk, level);
        } else {
          nodes.set(row.id, {
            ...toEntity(row),
            mentionCount: 1,
            emailIds: [row.email_id],
            highestRisk: level,
          });
        }
      }

      const edgeRows = db
        .prepare(
          `SELECT r.source_entity_id, r.target_entity_id, r.type, r.evidence, r.email_id
             FROM relationships r
             JOIN emails e ON e.id = r.email_id AND e.latest_run_id = r.run_id`,
        )
        .all() as {
        source_entity_id: string;
        target_entity_id: string;
        type: string;
        evidence: string;
        email_id: string;
      }[];

      const edges = new Map<string, GraphEdge>();
      for (const row of edgeRows) {
        // Collapse the same claim seen in several emails into one edge that
        // cites all of them, rather than drawing parallel lines.
        const id = `${row.source_entity_id}|${row.type}|${row.target_entity_id}`;
        const existing = edges.get(id);
        if (existing) {
          if (!existing.emailIds.includes(row.email_id)) existing.emailIds.push(row.email_id);
        } else {
          edges.set(id, {
            id,
            source: row.source_entity_id,
            target: row.target_entity_id,
            type: row.type,
            evidence: row.evidence,
            emailIds: [row.email_id],
          });
        }
      }

      return { nodes: [...nodes.values()], edges: [...edges.values()] };
    },

    /**
     * What the mailbox already knows about these entities.
     *
     * This is the cross-email memory Agent B needs. A single email cannot tell
     * you that a supplier's bank details have changed — only the history can.
     * Given the parties and account numbers pulled out of the current email,
     * this returns each one's prior appearances and the entities it was linked
     * to before, so the prompt can carry that in.
     *
     * `excludeEmailId` keeps an email from being told about itself, which
     * matters on reprocessing.
     */
    getPriorContext(
      candidates: readonly { type: EntityType; name: string }[],
      excludeEmailId: string,
    ): PriorEntityContext[] {
      const seen = new Set<string>();
      const results: PriorEntityContext[] = [];

      for (const candidate of candidates) {
        const canonicalKey = normalizeEntityKey(candidate.type, candidate.name);
        if (!canonicalKey || seen.has(`${candidate.type}:${canonicalKey}`)) continue;
        seen.add(`${candidate.type}:${canonicalKey}`);

        const row = db
          .prepare('SELECT * FROM entities WHERE type = ? AND canonical_key = ?')
          .get(candidate.type, canonicalKey) as EntityRow | undefined;
        if (!row) continue;

        const entity = toEntity(row);

        const history = db
          .prepare(
            `SELECT COUNT(DISTINCT m.email_id) AS email_count,
                    MAX(COALESCE(e.sent_at, e.created_at)) AS last_seen_at
               FROM entity_mentions m
               JOIN emails e ON e.id = m.email_id AND e.latest_run_id = m.run_id
              WHERE m.entity_id = ? AND m.email_id != ?`,
          )
          .get(entity.id, excludeEmailId) as
          | { email_count: number; last_seen_at: string | null }
          | undefined;

        // Never mentioned anywhere else: nothing useful to say about it.
        if (!history || history.email_count === 0) continue;

        const levels = (
          db
            .prepare(
              `SELECT DISTINCT r.level AS level
                 FROM entity_mentions m
                 JOIN emails e ON e.id = m.email_id AND e.latest_run_id = m.run_id
                 JOIN risk_assessments r ON r.run_id = e.latest_run_id
                WHERE m.entity_id = ? AND m.email_id != ?`,
            )
            .all(entity.id, excludeEmailId) as { level: string }[]
        ).map((r) => r.level as RiskLevel);

        const related = (
          db
            .prepare(
              `SELECT other.type AS type, other.display_name AS name, r.type AS relationship,
                      CASE WHEN r.source_entity_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
                 FROM relationships r
                 JOIN emails e ON e.id = r.email_id AND e.latest_run_id = r.run_id
                 JOIN entities other
                   ON other.id = CASE WHEN r.source_entity_id = ? THEN r.target_entity_id
                                      ELSE r.source_entity_id END
                WHERE (r.source_entity_id = ? OR r.target_entity_id = ?)
                  AND r.email_id != ?
                GROUP BY other.id, r.type, direction
                LIMIT 12`,
            )
            .all(entity.id, entity.id, entity.id, entity.id, excludeEmailId) as {
            type: string;
            name: string;
            relationship: string;
            direction: string;
          }[]
        ).map((r) => ({
          type: r.type as EntityType,
          name: r.name,
          relationship: r.relationship,
          direction: r.direction as 'incoming' | 'outgoing',
        }));

        results.push({
          id: entity.id,
          type: entity.type,
          name: entity.displayName,
          canonicalKey: entity.canonicalKey,
          emailCount: history.email_count,
          lastSeenAt: history.last_seen_at,
          highestRisk: levels.reduce<RiskLevel | null>((best, level) => higherRisk(best, level), null),
          related,
        });
      }

      return results;
    },

    getEntity(id: string): EntityRecord | null {
      const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as EntityRow | undefined;
      return row ? toEntity(row) : null;
    },

    getAliases(entityId: string): string[] {
      return (
        db
          .prepare('SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY alias')
          .all(entityId) as { alias: string }[]
      ).map((row) => row.alias);
    },

    /** Emails in which an entity appears, newest first. */
    getEntityEmailIds(entityId: string): string[] {
      return (
        db
          .prepare(
            `SELECT DISTINCT m.email_id
               FROM entity_mentions m
               JOIN emails e ON e.id = m.email_id AND e.latest_run_id = m.run_id
              WHERE m.entity_id = ?
              ORDER BY m.email_id`,
          )
          .all(entityId) as { email_id: string }[]
      ).map((row) => row.email_id);
    },

    countEntities(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM entities').get() as { n: number };
      return row.n;
    },
  };
}

export type GraphRepo = ReturnType<typeof createGraphRepo>;
