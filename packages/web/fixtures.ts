import type { Checkpoint } from "@stringsync/splates-server/conversations";
import type { AgentChoice } from "./conversation-feed";
import type { ProjectChoice } from "./project-api";

export * from "@stringsync/splates-server/fixtures";

/** A conversation of a project's, as the projects route lists it. */
export function live(
	id: string,
	name: string,
	checkpoint: Checkpoint | null = null,
	survives = false,
) {
	return {
		id,
		name,
		status: checkpoint === "done" ? "stopped" : "running",
		checkpoint,
		survives,
	};
}

/** A project as the projects route lists it, holding `listed`. */
export function project(
	slug: string,
	listed: ProjectChoice["conversations"],
	focused = false,
): ProjectChoice {
	return {
		slug,
		root: `/code/${slug}`,
		gone: false,
		focused,
		conversations: listed,
		waiting: 0,
	};
}

// scry-ignore tests-own-their-state: the roster every conversation test opens with by default; a test about the agents passes its own to openConversations
export const AGENTS: AgentChoice[] = [
	{ id: "claude", name: "Claude", settings: [], limits: [] },
	{ id: "codex", name: "Codex", settings: [], limits: [] },
];

/** A server's public key, as `/api/push` hands it out. */
export const PUSH_KEY =
	"BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
