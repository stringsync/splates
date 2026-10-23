/**
 * The auto pick values a browser bundle can take: import them from
 * `@stringsync/splates-server/auto-pick/browser` in the page, and types from
 * `@stringsync/splates-server/auto-pick`.
 */

// The index brings in the judges, and `classificationKey`, which hashes with `Bun`, so
// these are re-exported from the file that brings in neither. Checking rules
// takes zod, which is `check.ts`'s, so a page that only reads the classes
// carries none of it.

export {
	CLARITIES,
	CLARITY_IDS,
	DEPTH_IDS,
	DEPTHS,
	KIND_IDS,
	KINDS,
} from "./classes";
export { DEFAULT_RULES } from "./defaults";
export { ANY, DEFAULT_PACE, RULES_FORMAT, ruleLabel } from "./rule-names";
