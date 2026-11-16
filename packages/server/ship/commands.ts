import type { Ps } from "core/system";
import { Duration } from "core/time";
import { lastLines, quoted } from "./shell";
import { type Bump, PLANS, type Plan } from "./wire";

/** How long a command has to answer `plan`. */
const PLAN_TIMEOUT = Duration.secs(30);

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
		const commands =
			typeof this.commands === "function"
				? await this.commands()
				: this.commands;
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

	/** The plan of `target`, served by `command`, at `bump` when given. */
	async plan(command: string, target: string, bump?: Bump): Promise<Plan> {
		const flags = ["--target", target, ...(bump ? ["--bump", bump] : [])];
		const [plan] = await this.plans(command, flags);
		if (plan === undefined || plan.name !== target) {
			throw new Error(`"${command} plan" did not answer for "${target}"`);
		}
		return plan;
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
