// What the other modules build on, apart from the server itself, so using it
// never loads the whole process.

export type { EventSink, StreamWatcher } from "./http";
export {
	body,
	eventStream,
	fileResponse,
	HostGate,
	hostname,
	json,
	LOOPBACK,
	MEDIA_TYPES,
	refuse,
	uploads,
} from "./http";
export { DEFAULT_PORT } from "./ports";
export {
	BESIDE_GATE_NICE,
	PREMERGE_HELD,
	PREMERGE_TIMEOUT_MS,
	premergeLockOfMachine,
	RECENT_FAILED_FILES,
} from "./premerge";
export type { DevMachine, Handler, Project, Served } from "./project";
export type { ProjectWatch } from "./project-watch";
export type { Behind, Release } from "./release";
export { RUNNING } from "./release";
export type { SplatesDeps } from "./runtime-deps";
export { installedVersion, projectSkills } from "./skills";
export type { Connection } from "./sockets";
export { CONNECTIONS } from "./sockets";
export { RESTART, SERVING } from "./supervise";
export type { PlacedLock } from "./ticketed-lock";
