import { commaList } from "@stringsync/splates-server/comma-list";
import { SYSTEM_STORES } from "@stringsync/splates-server/creds";
import { pickEffort } from "@stringsync/splates-server/effort";
import { fail } from "@stringsync/splates-server/exit";
import { Offered } from "@stringsync/splates-server/offered";
import type { Repository } from "@stringsync/splates-server/records";
import {
	type AgentPick,
	pickAgent,
	type RosterAgent,
	splatesHome,
} from "@stringsync/splates-server/roster";
import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import { SavedTunnel } from "@stringsync/splates-server/saved-tunnel";
import { SLOT_POOL } from "@stringsync/splates-server/slots";
import { rosterOf, seeded } from "@stringsync/splates-server/start-settings";
import { z } from "zod";

/** A place in the todo list, 1 at the top; absent leaves it to the command. */
export const position = z.coerce.number().int().positive().optional();

/**
 * The agent `--agent`, `--model` and `--effort` name off the roster:
 * undefined when none is given, null for `--agent none`.
 */
export async function assigneeIn(
	deps: SplatesDeps,
	agent: string,
	model: string,
	effort: string,
): Promise<AgentPick | null | undefined> {
	if (agent === "") {
		if (model !== "" || effort !== "") {
			fail("usage", "--model and --effort go with --agent", {
				model,
				effort,
			});
		}
		return undefined;
	}
	if (agent === "none") {
		return null;
	}
	return pickIn(deps, await seeded(rosterOf(deps)), agent, model, effort);
}

/**
 * `agent` on `model` off `agents`, at the thinking level `effort` names
 * among those it offers, each left out when empty.
 */
export async function pickIn(
	deps: SplatesDeps,
	agents: RosterAgent[],
	agent: string,
	model: string,
	effort: string,
	data: Record<string, unknown> = {},
): Promise<AgentPick> {
	const picked = pickAgent(
		agents,
		agent,
		model === "" ? undefined : model,
		data,
	);
	return { ...picked, ...(await effortIn(deps, picked.agent, effort, data)) };
}

/**
 * `{ effort }` for the thinking level `effort` names among those `agent`
 * offered when last started, or nothing when it is empty.
 */
export async function effortIn(
	deps: SplatesDeps,
	agent: string,
	effort: string,
	data: Record<string, unknown> = {},
): Promise<{ effort?: string }> {
	if (effort === "") {
		return {};
	}
	const offered = (await offeredOf(deps).all())[agent];
	return { effort: pickEffort(offered, agent, effort, data) };
}

/** The settings each agent offered when last started, from any project. */
export function offeredOf({ ps, fs }: SplatesDeps): Offered {
	return new Offered(`${splatesHome(ps)}/offered.json`, { fs });
}

/** The tunnel each slot's home may have saved, for every word of the pool. */
export function slotTunnelsOf({
	ps,
	fs,
	secrets = SYSTEM_STORES,
}: SplatesDeps): SavedTunnel[] {
	return SLOT_POOL.map(
		({ word }) =>
			new SavedTunnel(`${splatesHome(ps)}/slots/${word}/tunnel.json`, {
				fs,
				store: secrets.device,
			}),
	);
}

/** `--lane 3`, `new` or `none` as a lane; absent leaves it to the command. */
export function laneIn(raw: string): number | "new" | null | undefined {
	const value = raw.trim();
	if (value === "") {
		return undefined;
	}
	if (value === "new") {
		return "new";
	}
	if (value === "none") {
		return null;
	}
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) {
		fail("usage", `'${value}' is not a lane: pass its number, new or none`, {
			lane: value,
		});
	}
	return id;
}

/** `--todo 3,5` as ids, refusing anything that is not one. */
export function todoIds(raw: string): number[] {
	return commaList(raw).map((value) => {
		const id = Number(value);
		if (!Number.isInteger(id) || id <= 0) {
			fail("usage", `'${value}' is not a todo id`, { todo: value });
		}
		return id;
	});
}

/**
 * Which task a command that takes no task name is about, so the journal can
 * name it. `merge` and `escalate` read it off the current branch.
 */
export async function here({
	service,
	git,
	ps,
	project,
}: SplatesDeps & Repository): Promise<string | null> {
	// Run with `--project`, the working directory is another repository's.
	return project === undefined
		? service.taskFor(await git.currentBranch(ps.cwd()))
		: null;
}
