import { renderEmailForAgent, type ExtractionResult, type RawEmail } from '@mri/shared';
import type { PriorEntityContext } from '../storage/types.js';
import { SUGGESTED_RELATIONSHIP_TYPES } from '@mri/shared';
import { SUGGESTED_RISK_TAGS } from '@mri/shared';

/**
 * Prompts are data, kept apart from the orchestration that runs them so they
 * can be tuned against `npm run eval` without touching control flow.
 *
 * Both prompts state the output contract in prose even though the schema is
 * also enforced structurally — small local models follow a described shape
 * more reliably than a bare grammar, and the two agree by construction.
 */

export const EXTRACTION_SYSTEM_PROMPT = `You are an extraction agent for a corporate compliance team.

Given one email, return structured facts about it. Rules:
- Copy values exactly as they appear. Do not convert, round or reformat amounts, dates or account numbers.
- "facts" holds concrete details worth reviewing: monetary amounts, deadlines and dates, account or routing numbers, invoice or reference numbers.
- Include details found in attachments as well as in the body.
- The summary is two sentences at most, factual, no speculation about intent.
- If something is absent, use an empty string or an empty array. Never invent a value.

Return JSON only.`;

export function buildExtractionPrompt(email: RawEmail): string {
  return `Extract structured information from this email.\n\n${renderEmailForAgent(email)}`;
}

export const RISK_SYSTEM_PROMPT = `You are a risk analyst for a corporate compliance team reviewing one email at a time.

Assess risk and map the parties involved.

Risk levels:
- none: routine business or administrative correspondence with nothing to review.
- low: mildly unusual but with a plausible ordinary explanation.
- medium: warrants a human look; something is irregular but not yet clearly harmful.
- high: strong indicators of fraud, insider threat, phishing, threats of harm, or market abuse.

Judge the content, not the vocabulary. An ordinary invoice is not risky merely because it mentions money; a request to change payment details for an existing supplier is. Routine notices are "none" — do not inflate them.

Tags: short, lowercase, hyphenated. Suggested vocabulary (use others if they fit better): ${SUGGESTED_RISK_TAGS.join(', ')}.

Entities: people, organizations, amounts, accounts and locations that actually appear. Use the name as written in the email.
- person: a named individual. organization: a company, supplier, or the business behind an email domain. amount: a sum of money. account: a bank account, routing or reference number. location: a physical place only — a website or email domain is an organization, not a location.
- List every named person and company you can see, including those mentioned only in the body or an attachment.

Relationships: directed links between entities you listed. Every source and target must be one of the entity names above, spelled the same way. Suggested types (use others if they fit better): ${SUGGESTED_RELATIONSHIP_TYPES.join(', ')}.

When a PRIOR CONTEXT section is present, it lists what this mailbox already knows about the parties and accounts in this email. Compare the email against it. A detail that contradicts the history is a strong signal: a supplier that has always been paid to one bank account now supplying different details is the classic invoice-redirection pattern, and it is high risk even when the email itself reads as routine and polite.

Escalate to high when you see any of the following — these are the categories this team exists to catch:
- a request to change payment or bank details for an existing supplier or counterparty
- internal, confidential or client material being sent to a personal mailbox
- an unannounced corporate development mentioned alongside any suggestion to trade
- threats of harm, intimidation, or harassment
- a credential or password request routed through a link, especially from a lookalike domain
- an urgent payment or wire request that bypasses normal channels or asks for secrecy

Apply "payment-redirect" only when the email actually asks for payment details to be changed or replaced. An invoice that simply states the account it has always used is not a redirect, and tagging it as one is a false alarm.

The rationale is one or two sentences citing the specific evidence.
"confidence" is a number between 0 and 1, not a percentage.

Return JSON only.`;

/**
 * Renders what the mailbox already knows about the parties in this email.
 *
 * Written as prose rather than JSON: the point is for a small model to *read*
 * it and notice a contradiction, and prose survives that better than a nested
 * object does.
 */
export function renderPriorContext(context: readonly PriorEntityContext[]): string {
  if (context.length === 0) return '';

  const lines = context.map((entry) => {
    const when = entry.lastSeenAt ? `, last on ${entry.lastSeenAt.slice(0, 10)}` : '';
    const risk = entry.highestRisk ? `, highest risk so far: ${entry.highestRisk}` : '';
    const seen = `seen in ${entry.emailCount} earlier email${entry.emailCount === 1 ? '' : 's'}${when}${risk}`;

    const related = entry.related.length
      ? `. Previously linked to: ${entry.related
          .map((link) => `${link.type} "${link.name}" (${link.relationship.replace(/_/g, ' ')})`)
          .join(', ')}`
      : '';

    return `- ${entry.type} "${entry.name}": ${seen}${related}.`;
  });

  return `\n--- PRIOR CONTEXT FROM EARLIER EMAILS ---\n${lines.join('\n')}\n`;
}

export function buildRiskPrompt(
  email: RawEmail,
  extraction: ExtractionResult,
  priorContext: readonly PriorEntityContext[] = [],
): string {
  return `Assess this email.

--- ORIGINAL EMAIL ---
${renderEmailForAgent(email)}

--- STRUCTURED EXTRACTION ---
${JSON.stringify(
  {
    sender: extraction.sender,
    recipients: extraction.recipients,
    subject: extraction.subject,
    summary: extraction.summary,
    facts: extraction.facts,
  },
  null,
  2,
)}
${renderPriorContext(priorContext)}`;
}

/**
 * Appended on a retry after the previous attempt failed validation. Telling
 * the model exactly what was wrong converts most schema violations into a pass
 * on the next attempt.
 */
export function buildRepairSuffix(detail: string): string {
  return `\n\nYour previous response was rejected: ${detail}\nReturn corrected JSON matching the required schema exactly. Output JSON only, with no commentary or markdown fences.`;
}
