/**
 * The auto pick values a browser bundle can take: import them from
 * `@stringsync/splates-server/auto-pick/browser` in the page, and types from
 * `@stringsync/splates-server/auto-pick`.
 */

// The index brings in the judges, and `classificationKey`, which hashes with `Bun`, so
// these are re-exported from the file that brings in neither.

export { DIFFICULTIES, DIFFICULTY_IDS, KIND_IDS, KINDS } from "./classes";
export { DEFAULT_RULES } from "./defaults";
export {
	ANY,
	AUTO_PICK_RULES,
	checkRules,
	RULES_FORMAT,
	ruleLabel,
} from "./rules";
