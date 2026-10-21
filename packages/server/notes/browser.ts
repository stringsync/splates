/**
 * The note values a browser bundle can take: import them from
 * `@stringsync/splates-server/notes/browser` in the page, and types from
 * `@stringsync/splates-server/notes`.
 */

// The index brings in the journal and the filesystem with it, so these are
// re-exported from the file that brings in neither.

export { noteCalled, noteSpellings, notesRead } from "./match";
