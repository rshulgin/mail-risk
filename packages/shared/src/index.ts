/**
 * Shared domain contracts for Mail Risk Intelligence.
 *
 * The API and the web app agree on exactly what is exported here: Zod schemas
 * for both agents' output, the risk taxonomy, and the entity normalisation
 * rules that decide when two mentions are the same thing.
 */

export * from './agents.js';
export * from './email.js';
export * from './entities.js';
export * from './risk.js';
