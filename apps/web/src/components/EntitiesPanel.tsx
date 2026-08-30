import { ENTITY_TYPES, type EntityType } from '@mri/shared';
import type { EntityView, RelationshipView } from '../api/types.js';
import { ENTITY_TYPE_LABEL } from '../risk-styles.js';
import { EmptyState } from './States.js';

/**
 * Entities grouped by type, then the relationships between them.
 *
 * Relationship types are an open vocabulary on the server, so labels are
 * rendered from whatever the pipeline produced — `requests_transfer_to` reads
 * as "requests transfer to" — rather than being mapped through a fixed table
 * that would silently drop anything unrecognised.
 */
const humanise = (type: string): string => type.replace(/_/g, ' ');

function EntityGroup({ type, entities }: { type: EntityType; entities: EntityView[] }) {
  if (entities.length === 0) return null;

  return (
    <div>
      <h4 className="text-ink-muted text-[11px] font-semibold uppercase tracking-wide">
        {ENTITY_TYPE_LABEL[type]}
      </h4>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {entities.map((entity) => (
          <li key={entity.id}>
            <span
              title={entity.context || undefined}
              className="border-line bg-surface inline-flex items-center rounded-md border px-2 py-1 text-xs"
            >
              {entity.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EntitiesPanel({
  entities,
  relationships,
}: {
  entities: EntityView[];
  relationships: RelationshipView[];
}) {
  if (entities.length === 0) {
    return (
      <EmptyState
        title="No entities extracted"
        description="The pipeline did not identify any people, organisations, amounts or accounts in this email."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {ENTITY_TYPES.map((type) => (
          <EntityGroup
            key={type}
            type={type}
            entities={entities.filter((entity) => entity.type === type)}
          />
        ))}
      </div>

      <div>
        <h4 className="text-ink-muted text-[11px] font-semibold uppercase tracking-wide">
          Relationships
        </h4>
        {relationships.length === 0 ? (
          <p className="text-ink-muted mt-1.5 text-xs">
            No relationships were identified between these entities.
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {relationships.map((edge) => (
              <li
                key={edge.id}
                title={edge.evidence || undefined}
                className="border-line bg-surface flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
              >
                <span className="font-medium">{edge.source.name}</span>
                <span className="text-ink-muted" aria-label={`${humanise(edge.type)} →`}>
                  —{humanise(edge.type)}→
                </span>
                <span className="font-medium">{edge.target.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
