/**
 * The conversation values a browser bundle can take: import them from
 * `@stringsync/splates/conversations/browser` in the page, and types from
 * `@stringsync/splates/conversations`.
 */

// The index brings in the server, agent processes and `bun:` modules with it,
// so these are re-exported from the files that bring in none.

export { paused } from "./messages";
export {
	lanesOf,
	namedForTask,
	nameOf,
	openingOf,
	realName,
	startedLanes,
} from "./name";
export { conversationReference } from "./reference";
export {
	blank,
	DEVICES,
	FROM_HEADER,
	HEARTBEAT_IDLE,
	IDLE_STOP,
	unused,
} from "./state";
