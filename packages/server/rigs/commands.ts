import type { Ps } from "core/system";
import { Duration } from "core/time";
import { lastLines } from "../ship/shell";
import { DESCRIBED, type Described } from "./wire";

/** How long a command has to answer `describe`. */
const DESCRIBE_TIMEOUT = Duration.secs(30);

/** A rig command's answer to `describe`, with the command that gave it. */
export type Group = Described & {
	/** The command, as `splates.config.ts` names it. */
	command: string;
};

/** A command that could not answer `describe`, shown in place of its rigs. */
export type Undescribed = { command: string; error: string };

/** What every registered command answered. */
export type RigListing = { groups: Group[]; errors: Undescribed[] };

/** The rig commands `splates.config.ts` names under `rigs`. */
export class RigCommands {
	constructor(
		/** The commands, or a read of them each time, so a config edit shows. */
		private readonly commands:
			| readonly string[]
			| (() => Promise<readonly string[]>),
		private readonly ps: Pick<Ps, "spawnCapture">,
		private readonly root: string,
	) {}

	/** Every group of rigs the commands describe, and each command that failed. */
	async list(): Promise<RigListing> {
		const commands =
			typeof this.commands === "function"
				? await this.commands()
				: this.commands;
		const answers = await Promise.all(
			commands.map(async (command): Promise<Group | Undescribed> => {
				try {
					return { ...(await this.describe(command)), command };
				} catch (error) {
					return {
						command,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}),
		);
		const listing: RigListing = { groups: [], errors: [] };
		const names = new Map<string, string>();
		for (const answer of answers) {
			if ("error" in answer) {
				listing.errors.push(answer);
				continue;
			}
			const earlier = names.get(answer.name);
			if (earlier !== undefined) {
				listing.errors.push({
					command: answer.command,
					error: `"${answer.name}" is described by "${earlier}" too`,
				});
				continue;
			}
			names.set(answer.name, answer.command);
			listing.groups.push(answer);
		}
		return listing;
	}

	private async describe(command: string): Promise<Described> {
		const result = await this.ps.spawnCapture(
			["sh", "-c", `${command} describe`],
			{ cwd: this.root, stdin: "", timeoutMs: DESCRIBE_TIMEOUT.ms },
		);
		if (result.exitCode !== 0) {
			const why = lastLines(result.stderr || result.stdout);
			throw new Error(
				`"${command} describe" exited ${result.exitCode}${why ? `: ${why}` : ""}`,
			);
		}
		let json: unknown;
		try {
			json = JSON.parse(result.stdout);
		} catch {
			throw new Error(`"${command} describe" did not print JSON`);
		}
		const parsed = DESCRIBED.safeParse(json);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const where = issue?.path.join(".") ?? "";
			throw new Error(
				`"${command} describe" answered wrongly${where ? ` at ${where}` : ""}: ${issue?.message}`,
			);
		}
		return parsed.data;
	}
}
