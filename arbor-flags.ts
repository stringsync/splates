import { z } from "zod";
import type { ArborDeps } from "./arbor";
import { fail } from "./exit";
import type { Repository } from "./repository";
import {
	type AgentPick,
	arborHome,
	pickAgent,
	Roster,
	type RosterAgent,
} from "./roster";

/** A place in the todo list, 1 at the top; absent leaves it to the command. */
export const position = z.coerce.number().int().positive().optional();

/**
 * The agent `--agent` and `--model` name off the roster: undefined when
 * neither is given, null for `--agent none`.
 */
export async function assigneeIn(
	deps: ArborDeps,
	agent: string,
	model: string,
): Promise<AgentPick | null | undefined> {
	if (agent === "") {
		if (model !== "") {
			fail("usage", "--model goes with --agent", { model });
		}
		return undefined;
	}
	if (agent === "none") {
		return null;
	}
	return pickAgent(
		await seeded(rosterOf(deps)),
		agent,
		model === "" ? undefined : model,
	);
}

/** The user's roster, beside the project registry. */
export function rosterOf({ ps, fs }: ArborDeps): Roster {
	return new Roster(`${arborHome(ps)}/agents.json`, { fs });
}

/** The roster's agents, written out as the defaults first when there is none. */
export async function seeded(roster: Roster): Promise<RosterAgent[]> {
	await roster.seed();
	return roster.agents();
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

/** A comma-separated flag's values, with no empty ones. */
export function commaList(raw: string): string[] {
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

/**
 * Which task a command that takes no task name is about, so the journal can
 * name it. `merge` and `escalate` read it off the current branch.
 */
export async function here({
	service,
	git,
	ps,
}: ArborDeps & Repository): Promise<string | null> {
	return service.taskFor(await git.currentBranch(ps.cwd()));
}
