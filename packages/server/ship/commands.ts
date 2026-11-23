import type { Ps } from "core/system";
import { Duration } from "core/time";
import { z } from "zod";
import { lastLines, quoted } from "./shell";
import { type Bump, PLANS, type Plan } from "./wire";

/** How long a command has to answer `plan`. */
const PLAN_TIMEOUT = Duration.secs(30);

/** How long a command has to answer `unshipped`. */
const UNSHIPPED_TIMEOUT = Duration.mins(1);

/** Each target's unshipped commit count, by name, for those that count them. */
export type Unshipped = Record<string, number>;

/** Each target's current version, by name, for those that can say. */
export type Currents = Record<string, string>;

const VERSIONS = z.record(z.string(), z.string().min(1));

/** How long a command has to answer `current`. */
const CURRENT_TIMEOUT = Duration.secs(30);

const COUNTS = z.record(z.string(), z.number().int().nonnegative());

/** A target a ship command serves, as its `plan` with no flags describes it. */
export type Listed = {
	/** The command that serves it, as `splates.config.ts` names it. */
	command: string;
	plan: Plan;
};

/** A command that could not answer `plan`, shown in place of its targets. */
export type Unanswered = {
	command: string;
	error: string;
};

type Answered = { command: string; plans: Plan[] };

/** What every registered command answered. */
export type Listing = {
	targets: Listed[];
	errors: Unanswered[];
	/** Set when this is the last listing read, a fresh one being read behind it. */
	stale?: true;
};

/**
 * The ship commands `splates.config.ts` names under `ships`: `list` reads
 * every target they serve, and `plan` one target's steps at a bump.
 */
export class ShipCommands {
	constructor(
		/** The commands, or a read of them each time, so a config edit shows. */
		private readonly commands:
			| readonly string[]
			| (() => Promise<readonly string[]>),
		private readonly ps: Pick<Ps, "spawnCapture">,
		private readonly root: string,
	) {}

	/** Every target each command serves, and each command that failed. */
	async list(): Promise<Listing> {
		const commands = await this.registered();
		const answers = await Promise.all(
			commands.map(async (command): Promise<Answered | Unanswered> => {
				try {
					return { command, plans: await this.plans(command, []) };
				} catch (error) {
					return { command, error: messageOf(error) };
				}
			}),
		);
		const listing: Listing = { targets: [], errors: [] };
		const names = new Map<string, string>();
		for (const answer of answers) {
			if ("error" in answer) {
				listing.errors.push(answer);
				continue;
			}
			for (const plan of answer.plans) {
				const earlier = names.get(plan.name);
				if (earlier !== undefined) {
					listing.errors.push({
						command: answer.command,
						error: `"${plan.name}" is served by "${earlier}" too`,
					});
					continue;
				}
				names.set(plan.name, answer.command);
				listing.targets.push({ command: answer.command, plan });
			}
		}
		return listing;
	}

	/** Each target's unshipped commit count, by name, for those that count. */
	async unshipped(): Promise<Unshipped> {
		const commands = await this.registered();
		const answers = await Promise.all(
			commands.map((command) => this.counts(command)),
		);
		return Object.assign({}, ...answers);
	}

	/** Each target's current version, by name, for those that can say. */
	async current(): Promise<Currents> {
		const commands = await this.registered();
		const answers = await Promise.all(
			commands.map((command) => this.versions(command)),
		);
		return Object.assign({}, ...answers);
	}

	/** The versions each target may ship, newest first, for those that can say. */
	async shippable(): Promise<Shippables> {
		const commands = await this.registered();
		const answers = await Promise.all(
			commands.map(async (command): Promise<Shippables> => {
				const result = await this.ps
					.spawnCapture(["sh", "-c", `${command} versions`], {
						cwd: this.root,
						stdin: "",
						timeoutMs: CURRENT_TIMEOUT.ms,
					})
					.catch(() => null);
				if (result === null || result.exitCode !== 0) {
					return {};
				}
				try {
					const parsed = SHIPPABLES.safeParse(JSON.parse(result.stdout));
					return parsed.success ? parsed.data : {};
				} catch {
					return {};
				}
			}),
		);
		return Object.assign({}, ...answers);
	}

	/** The plan of `target`, served by `command`, at the `version`, `bump` and `upstream` versions given. */
	async plan(
		command: string,
		target: string,
		chosen: {
			bump?: Bump;
			version?: string;
			upstream?: Record<string, string>;
		} = {},
	): Promise<Plan> {
		const flags = [
			"--target",
			target,
			...(chosen.version !== undefined
				? ["--version", chosen.version]
				: chosen.bump
					? ["--bump", chosen.bump]
					: []),
			...Object.entries(chosen.upstream ?? {}).flatMap(([name, version]) => [
				"--upstream",
				`${name}=${version}`,
			]),
		];
		const [plan] = await this.plans(command, flags);
		if (plan === undefined || plan.name !== target) {
			throw new Error(`"${command} plan" did not answer for "${target}"`);
		}
		return plan;
	}

	private async registered(): Promise<readonly string[]> {
		return typeof this.commands === "function"
			? await this.commands()
			: this.commands;
	}

	private async counts(command: string): Promise<Unshipped> {
		const result = await this.ps
			.spawnCapture(["sh", "-c", `${command} unshipped`], {
				cwd: this.root,
				stdin: "",
				timeoutMs: UNSHIPPED_TIMEOUT.ms,
			})
			.catch(() => null);
		if (result === null || result.exitCode !== 0) {
			return {};
		}
		try {
			const counts = COUNTS.safeParse(JSON.parse(result.stdout));
			return counts.success ? counts.data : {};
		} catch {
			return {};
		}
	}

	private async versions(command: string): Promise<Currents> {
		const result = await this.ps
			.spawnCapture(["sh", "-c", `${command} current`], {
				cwd: this.root,
				stdin: "",
				timeoutMs: CURRENT_TIMEOUT.ms,
			})
			.catch(() => null);
		if (result === null || result.exitCode !== 0) {
			return {};
		}
		try {
			const versions = VERSIONS.safeParse(JSON.parse(result.stdout));
			return versions.success ? versions.data : {};
		} catch {
			return {};
		}
	}

	private async plans(command: string, flags: string[]): Promise<Plan[]> {
		const line = [command, "plan", ...flags.map(quoted)].join(" ");
		const result = await this.ps.spawnCapture(["sh", "-c", line], {
			cwd: this.root,
			stdin: "",
			timeoutMs: PLAN_TIMEOUT.ms,
		});
		if (result.exitCode !== 0) {
			const said = lastLines(result.stderr || result.stdout);
			throw new Error(
				`"${command} plan" exited ${result.exitCode}${said ? `: ${said}` : ""}`,
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(result.stdout);
		} catch {
			throw new Error(`"${command} plan" did not print JSON`);
		}
		const plans = PLANS.safeParse(parsed);
		if (!plans.success) {
			throw new Error(
				`"${command} plan" printed no plan: ${plans.error.message}`,
			);
		}
		return plans.data;
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A version a target may ship, with a short note such as "staging now". */
export type Shippable = { version: string; note?: string };

/** The versions each target may ship, newest first, by name. */
export type Shippables = Record<string, Shippable[]>;

const SHIPPABLES = z.record(
	z.string(),
	z.array(
		z.object({ version: z.string().min(1), note: z.string().optional() }),
	),
);
