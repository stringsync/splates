import { color, type Logger } from "webappwiz/log";
import { pickLabel } from "../models";
import { TASK_EVENTS } from "./events";
import type { Hook, HookStore } from "./store";

/** What the hook commands work with. */
export interface HookDeps {
	hooks: HookStore;
	log: Logger;
}

/** Every hook set for this project, by event, numbered from 1 within each. */
export async function hookList(
	{ hooks, log }: HookDeps,
	{ json = false }: { json?: boolean } = {},
): Promise<void> {
	const set = await hooks.read();
	if (json) {
		log.info(JSON.stringify(set, null, "\t"));
		return;
	}
	const lines = TASK_EVENTS.flatMap((event) =>
		(set[event] ?? []).map(
			(hook, at) => `${event} ${at + 1}: ${described(hook)}`,
		),
	);
	log.info(
		lines.length === 0
			? "no hooks: nothing runs on a task event. `splates hook add` sets one"
			: lines.join("\n"),
	);
}

/** Adds `hook` on `event`, then says what it set. */
export async function hookAdd(
	{ hooks, log }: HookDeps,
	event: string,
	hook: Hook,
): Promise<void> {
	await hooks.add(event, hook);
	log.info(`${color.green("hooked")} ${event}: ${described(hook)}`);
}

/** Takes away `event`'s hook at `index`, from 1, or every one of them. */
export async function hookRemove(
	{ hooks, log }: HookDeps,
	event: string,
	index?: number,
): Promise<void> {
	await hooks.remove(event, index);
	log.info(
		`${color.green("unhooked")} ${event}${index === undefined ? "" : ` ${index}`}`,
	);
}

/** `hook` in a few words. */
function described(hook: Hook): string {
	switch (hook.kind) {
		case "agent":
			return `tell ${pickLabel(hook)}: ${hook.prompt}`;
		case "run":
			return `run \`${hook.command}\``;
	}
}
