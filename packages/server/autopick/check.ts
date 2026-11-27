/**
 * Checking rules in the browser, apart from `browser.ts` since it brings in
 * zod: import it from `@splates/server/autopick/check` in a page
 * that edits them.
 */
export { idFor } from "./cells";
export { checkRules, lineupFor, planOf } from "./rules";
