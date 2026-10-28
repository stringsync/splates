import type * as acp from "@agentclientprotocol/sdk";
import type { AsyncTaskUpdate, Flag, ProcessHandle } from "../agents";
import type { ArtifactChange } from "../artifacts";
import type { ObservedTurn } from "../models";
import type {
	Ask,
	Attached,
	AutoPickSet,
	Checkpoint,
	Decision,
	Device,
	Image,
	Limit,
	Setting,
} from "./state";

/**
 * A line of a conversation's log: what was said, in the order it was. Each
 * carries the `seq` of the agent's frame being handled when it was written;
 * missing before the first frame, and from older logs.
 */
export type Entry = Said & { seq?: number };

type Said =
	| {
			kind: "start";
			id: string;
			agent: string;
			task: string | null;
			/** Where it runs; missing from logs written before resuming. */
			cwd?: string;
			/** The task's base; missing from logs written before parts nested. */
			base?: string | null;
			/** Who added the task; missing from logs written before tasks remembered it. */
			caller?: string | null;
			createdAt: string;
			/** Missing from logs written before assignments were kept apart. */
			assigned?: boolean;
			/** The lane orchestrator that handed it its task; missing for one nobody did. */
			startedBy?: string;
			/** The project's splates skill version; missing when it had none, or before it was kept. */
			skill?: string;
			/** Whether the server's queue or a hook started it; missing for one neither did. */
			automatic?: boolean;
			/** What `automatic` was written as before it was renamed. */
			capped?: boolean;
			/** The queued task it was held for; missing for one held for none. */
			queued?: number;
			/** The persistent agent's role it was started for; missing for an ordinary one. */
			persistent?: string;
			/** The automation that started it, by its id; missing for one none did. */
			automation?: string;
	  }
	| { kind: "session"; session: string; cwd?: string }
	| { kind: "model-request"; model: string }
	/** The person set a model or effort after Auto pick chose it, by the setting's id and what it was set to. */
	| {
			kind: "override";
			setting: string;
			aspect: "model" | "effort";
			value: string;
			at: string;
	  }
	/**
	 * What Auto pick set it to: at its start, or `lifted` when it moved it up
	 * for what the person said later.
	 */
	| { kind: "auto-pick"; pick: AutoPickSet; lifted?: true; at: string }
	/** The person switched Auto pick on or off for the conversation. */
	| { kind: "auto-pick-switch"; on: boolean; at: string }
	/** Whether note pointers are held back from it, chosen as its first message was routed. */
	| {
			kind: "notes-holdout";
			holdout: boolean;
			experiment?: { version: string; at: string };
	  }
	/** Settings to set once the session opens, by id, as Auto pick chose them. */
	| { kind: "picks-request"; picks: Record<string, string> }
	/** Auto picked another agent than the one it started on, before any session opened. */
	| { kind: "agent"; agent: string }
	/** The queue started the task it was held for, so it is held no more. */
	| { kind: "queued"; queued: null }
	/** Moved into a task's worktree, or back to the main tree. */
	| {
			kind: "task";
			task: string | null;
			cwd: string;
			/** The task's base; missing from logs written before parts nested. */
			base?: string | null;
			/** Who added the task; missing from logs written before tasks remembered it. */
			caller?: string | null;
	  }
	/** What the session offered and had set, kept so the next one can start alike. */
	| { kind: "settings"; settings: Setting[] }
	/** `at` is missing from logs written before older archived ones were deleted. */
	| {
			kind: "archive";
			archived: boolean;
			at?: string;
			/** The conversation whose archiving took this one with it. */
			with?: string;
			/** Archived resting, as a persistent agent's run that ended with its role still on. */
			rest?: true;
	  }
	| { kind: "rename"; name: string | null }
	| { kind: "unread"; unread: boolean }
	| { kind: "read"; read: number }
	| { kind: "pin"; pinned: boolean }
	| { kind: "parent"; parent: { id: string | null } }
	/** `at` is missing from logs written before the page showed how long things took. */
	| {
			kind: "prompt";
			text: string;
			at?: string;
			queued?: true;
			steered?: true;
			/** The conversation that said it with `splates tell`. */
			told?: string;
			/** Said into the mic; missing from logs written before the page said. */
			dictated?: true;
			/** The page's id for it; missing for an agent's word, or from older logs. */
			id?: string;
			/** Where the person said it on the page; missing for an agent's word, or from older logs. */
			from?: Device;
			/** Missing from logs written before the page sent images. */
			images?: Image[];
			/** Missing from logs written before the page sent other files. */
			files?: Attached[];
	  }
	/** Every queued prompt went out. */
	| { kind: "sent"; count?: number; at?: string }
	/** The person stopped the agent's turn. */
	| { kind: "stopped"; at: string }
	/** The agent's turn ended early, its connection lost or its process gone. */
	| { kind: "interrupted"; at: string }
	/** A turn started or ended, so one a dead process left running shows as cut short. */
	| { kind: "turn"; running: boolean; at?: string }
	| { kind: "observed-turn"; turn: ObservedTurn }
	/** The `index`th queued prompt was taken back. */
	| { kind: "unqueue"; index: number }
	/** Where a checkpoint stands, and what comes after it. */
	| {
			kind: "checkpoint";
			checkpoint: Checkpoint | null;
			/** Why a worker budget hard stop asked it; absent for any other. */
			budget?: string;
	  }
	| {
			kind: "update";
			update: acp.SessionUpdate;
			at?: string;
			/** When the last of the chunks joined into this one came. */
			until?: string;
	  }
	/** The tokens a turn used, as the agent said when it ended. */
	| { kind: "usage"; usage: acp.Usage }
	/** The plan's windows, as asked of an agent that does not send them. */
	| { kind: "limits"; limits: Limit[] }
	/** What a finished command did to git that it should not have. */
	| { kind: "flags"; tool: string; flags: Flag[] }
	/** How the person answered the agent asking permission for a tool call. */
	| { kind: "decision"; tool: string; decision: Decision }
	/** An artifact added, removed, or its bytes deleted. */
	| { kind: "artifact"; change: ArtifactChange }
	/**
	 * The agent's session is open on a process a worker runs, which a
	 * server started again takes back by `handle`, until `end`.
	 */
	| {
			kind: "launched";
			handle: ProcessHandle;
			/** Whether the agent takes a prompt into its running turn. */
			steers: boolean;
			/** Whether the agent takes images in a prompt. */
			sees: boolean;
			/** Whether the agent says on its session list when a turn ends; missing from older logs. */
			follows?: boolean;
			/** The `LOG_FORMAT` that wrote the log; missing from logs before it was stamped, which are format 1. */
			format?: number;
	  }
	/** A request this side sent the agent, by the id it went out with. */
	| { kind: "request"; id: number; method: string }
	/** What the agent asks the person, by the request id `rpc` to answer on, when known; null once answered. */
	| { kind: "ask"; rpc: acp.JsonRpcId | null; ask: Ask }
	| { kind: "ask"; ask: null }
	/** Word of a command the agent left running in the background. */
	| { kind: "background"; update: AsyncTaskUpdate; at?: string }
	| {
			kind: "end";
			error: string | null;
			/**
			 * The server went down while it started, before its agent heard
			 * what was queued: the next run starts it again to say it.
			 */
			unsaid?: true;
	  };
