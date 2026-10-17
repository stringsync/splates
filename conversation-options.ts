import type { IdProvider } from "webappwiz/id";
import type { Fs, Lock } from "webappwiz/system";
import type { Timer, WallClock } from "webappwiz/time";
import type { Adherence } from "./adherence";
import type { Agent, Launch, Launcher } from "./agent-process";
import type { ArtifactLimits } from "./artifacts";
import type { ProjectRoster } from "./conversation-host";
import type { Limit } from "./conversation-state";
import type { Limits } from "./limits";
import type { Offered } from "./offered";
import type { Outcomes } from "./outcomes";
import type { SessionServers } from "./shared-browser";
import type { Watch } from "./watch";
import type { WorkerMachine } from "./worker-machine";
export interface ConversationsOptions {
	fs?: Fs;
	/** How many bytes of artifacts each may keep; `ARTIFACT_LIMITS` by default. */
	artifacts?: ArtifactLimits;
	ids?: IdProvider;
	/** What starts agents, when nothing takes one back after a restart; this process by default. */
	launch?: Launch;
	/** What starts agents and takes them back after a restart, over `launch`: a worker. */
	launcher?: Launcher;
	/**
	 * Where agents run, which their background output is read from; this
	 * machine by default.
	 */
	machine?: WorkerMachine;
	/**
	 * Held while each agent starts, shared by every project's conversations
	 * so no two start at once; one of their own by default.
	 */
	starting?: Lock;
	timer?: Timer;
	clock?: WallClock;
	/** What watches the agents' commands for what they do to git; none by default. */
	watch?: Watch | null;
	/** Where what each agent's sessions offer is kept across projects; nowhere by default. */
	offered?: Offered | null;
	/** Where each agent's plan limits are kept across projects; nowhere by default. */
	limits?: Limits | null;
	/**
	 * Where how each conversation followed the arbor skill is kept across
	 * projects, judged as each turn ends; nowhere by default.
	 */
	adherence?: Adherence | null;
	/**
	 * Where how each task ended is kept across projects, credited with the
	 * turn it ended in once that turn ends; nowhere by default.
	 */
	outcomes?: Outcomes | null;
	/**
	 * Asks an agent that does not send its plan's windows for them, after
	 * each of its turns; none by default.
	 */
	readLimits?: ((agent: Agent) => Promise<Limit[]>) | null;
	/**
	 * The main tree, where a conversation carries on once its task's worktree
	 * is gone, as when the task landed while `arbor dev` was not there to hear
	 * of it; without it, such a conversation cannot resume.
	 */
	root?: string | null;
	/**
	 * The arbor projects on this machine, for a prompt's `#slug` to name one
	 * by; none by default.
	 */
	projects?: ProjectRoster | null;
	/**
	 * The MCP servers each session is offered, beyond the agent's own, shared
	 * across projects like the browser they serve; none by default.
	 */
	servers?: SessionServers | null;
}
