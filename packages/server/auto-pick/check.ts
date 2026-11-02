/**
 * Checking rules in the browser, apart from `browser.ts` since it brings in
 * zod: import it from `@splates/server/auto-pick/check` in a page
 * that edits them.
 */
export { checkRules } from "./rules";
