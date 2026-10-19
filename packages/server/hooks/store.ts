import type { Fs } from "webappwiz/system";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import { TASK_EVENTS, type TaskEventName } from "./events";

/**
 * What runs on a task event: an agent told of it with a prompt, or a
 * shell command.
 */
export type Hook =
	| ({ kind: "agent"; prompt: string } & AgentPick)
	| { kind: "run"; command: string };

/** Each event's hooks, in the order they run. */
export type Hooks = Partial<Record<TaskEventName, Hook[]>>;

/**
 * The hooks one person set for one project, in `.git/splates/hooks.json`:
 * never checked in, since an agent hook spends its person's tokens. None
 * set, nothing runs.
 */
export class HookStore {
	constructor(
		/** `.git/splates/hooks.json`, or a test's own. */
		readonly path: string,
		private readonly fs: Fs,
	) {}

	/** Every hook set; none when the file is missing or will not parse. */
	async read(): Promise<Hooks> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return {};
		}
		try {
			const parsed = JSON.parse(raw) as unknown;
			return parsed !== null && typeof parsed === "object"
				? (parsed as Hooks)
				: {};
		} catch {
			return {};
		}
	}

	/** Adds `hook` after `event`'s others. */
	async add(event: string, hook: Hook): Promise<Hooks> {
		const name = eventNamed(event);
		return this.change((hooks) => ({
			...hooks,
			[name]: [...(hooks[name] ?? []), hook],
		}));
	}

	/** Takes away `event`'s hooks: the one at `index`, from 1, or all of them. */
	async remove(event: string, index?: number): Promise<Hooks> {
		const name = eventNamed(event);
		return this.change((hooks) => {
			const left =
				index === undefined
					? []
					: (hooks[name] ?? []).filter((_, at) => at !== index - 1);
			const { [name]: _, ...rest } = hooks;
			return left.length === 0 ? rest : { ...rest, [name]: left };
		});
	}

	private async change(edit: (hooks: Hooks) => Hooks): Promise<Hooks> {
		const hooks = edit(await this.read());
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(hooks, null, "\t")}\n`);
		await this.fs.rename(tmp, this.path);
		return hooks;
	}
}

/** `name` as a task event, refusing one that is none. */
export function eventNamed(name: string): TaskEventName {
	if (!(TASK_EVENTS as readonly string[]).includes(name)) {
		fail(
			"usage",
			`'${name}' is no task event: use one of ${TASK_EVENTS.join(", ")}`,
			{ event: name },
		);
	}
	return name as TaskEventName;
}
