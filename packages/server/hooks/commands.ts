import { color, type Logger } from "webappwiz/log";
import { fail } from "../exit";
import { type AgentPick, pickLabel } from "../models";
import { changed, type HookChange } from "./edit";
import {
	type Automation,
	GROOMER_AUTOMATION,
	type Hook,
	type HookStore,
	type Trigger,
} from "./store";

/** What the hook commands work with. */
export interface HookDeps {
	hooks: HookStore;
	log: Logger;
}

/** Every automation set for this project, by number. */
export async function hookList(
	{ hooks, log }: HookDeps,
	{ json = false }: { json?: boolean } = {},
): Promise<void> {
	const set = await hooks.read();
	if (json) {
		log.info(JSON.stringify(set, null, "\t"));
		return;
	}
	log.info(
		set.length === 0
			? "no hooks: nothing runs on a task event or a schedule. `splates hook add` sets one"
			: set.map(described).join("\n"),
	);
}

/** Adds `hook` on `trigger`, then says what it set. */
export async function hookAdd(
	{ hooks, log }: HookDeps,
	trigger: Trigger,
	hook: Hook,
): Promise<void> {
	const added = await hooks.add(trigger, hook);
	log.info(`${color.green("hooked")} ${described(added)}`);
}

/** Makes `change` to the person's automation numbered `id`, then says what it set. */
export async function hookEdit(
	{ hooks, log }: HookDeps,
	id: string,
	change: HookChange,
): Promise<void> {
	const was = (await hooks.read()).find((each) => each.id === id);
	if (was === undefined || was.source !== undefined) {
		fail(
			"usage",
			id === GROOMER_AUTOMATION
				? "the groomer changes through `splates hook groomer --agent`"
				: `no automation ${id}: \`splates hook list\` numbers yours`,
			{ id },
		);
	}
	const { trigger, hook } = changed(was, change);
	const edited = await hooks.edit(id, trigger, hook);
	log.info(`${color.green("edited")} ${described(edited)}`);
}

/** Takes away the automation numbered `id`, or every one on the event `id` names. */
export async function hookRemove(
	{ hooks, log }: HookDeps,
	id: string,
): Promise<void> {
	const gone = await hooks.remove(id);
	log.info(
		gone.length === 0
			? `no hooks on ${id}`
			: gone
					.map((each) => `${color.green("unhooked")} ${described(each)}`)
					.join("\n"),
	);
}

/** Turns the groomer on as `pick`, or off for null, then says so. */
export async function hookGroomer(
	{ hooks, log }: HookDeps,
	pick: AgentPick | null,
): Promise<void> {
	const set = await hooks.groomer(pick);
	log.info(
		set === null
			? `${color.green("groomer off")}: \`splates server\` retires its conversation`
			: `${color.green("groomer on")} ${described(set)}`,
	);
}

/** Pauses the automation numbered `id`, or lets it run again. */
export async function hookPause(
	{ hooks, log }: HookDeps,
	id: string,
	paused: boolean,
): Promise<void> {
	const automation = await hooks.pause(id, paused);
	log.info(
		`${color.green(paused ? "paused" : "resumed")} ${described(automation)}`,
	);
}

/** `automation` in a line: its number, trigger and what it runs. */
export function described(automation: Automation): string {
	return `${automation.id}. ${triggerLabel(automation.trigger)}: ${hookLabel(automation.hook)}${automation.paused === true ? " (paused)" : ""}`;
}

/** `trigger` in a few words, as `task.created in backlog, lane 3` or `every 1h`. */
export function triggerLabel(trigger: Trigger): string {
	if ("every" in trigger) {
		return `every ${trigger.every}`;
	}
	if ("cron" in trigger) {
		return `cron ${trigger.cron}`;
	}
	const { stages, lanes } = trigger.filter ?? {};
	const narrowed = [
		...(stages === undefined ? [] : [stages.join(" or ")]),
		...(lanes === undefined ? [] : [`lane ${lanes.join(" or ")}`]),
	];
	return narrowed.length === 0
		? trigger.event
		: `${trigger.event} in ${narrowed.join(", ")}`;
}

/** `hook` in a few words. */
export function hookLabel(hook: Hook): string {
	switch (hook.kind) {
		case "agent":
			return `tell ${pickLabel(hook)}: ${hook.prompt}`;
		case "run":
			return `run \`${hook.command}\``;
		case "groom":
			return `groom the backlog with ${pickLabel(hook)}`;
	}
}
