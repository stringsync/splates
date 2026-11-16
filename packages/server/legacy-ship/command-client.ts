import {
	SHIP_PLAN,
	SHIP_STATUS,
	type ShipIdentity,
} from "core/legacy-ship/contract";
import type { Logger } from "core/log";
import type { Ps } from "core/system";
import { Duration } from "core/time";
import type { z } from "zod";

import { inputArguments, type ShipInputs } from "./inputs";

const PLAN = SHIP_PLAN.transform((plan) => ({
	...plan,
	identity: identityOf(plan.identity),
}));
const STATUS = SHIP_STATUS.transform((status) => ({
	...status,
	identity: identityOf(status.identity),
}));

/** The read-only contract returned by a target's ship command. */
export type CommandPlan = z.infer<typeof PLAN>;
export type CommandStatus = z.infer<typeof STATUS>;

/** Read a target’s release plan and live status, returning null when its command cannot answer. */
export class ShipCommandClient {
	constructor(
		private readonly ps: Pick<Ps, "spawnCapture">,
		private readonly log: Logger,
	) {}

	async plan(
		project: CommandProject,
		inputs?: ShipInputs,
	): Promise<CommandPlan | null> {
		return this.read(project, "plan", PLAN, inputs);
	}

	async status(
		project: CommandProject,
		inputs?: ShipInputs,
	): Promise<CommandStatus | null> {
		return this.read(project, "status", STATUS, inputs);
	}

	private async read<T>(
		project: CommandProject,
		operation: string,
		schema: z.ZodType<T>,
		inputs?: ShipInputs,
	): Promise<T | null> {
		if (!project.ship?.trim()) {
			return null;
		}
		// Appending arguments to shell redirections or command lists can execute a
		// legacy release even though it cannot answer the contract.
		if (/[;&|<>\n]/.test(project.ship)) {
			this.log.info(
				`${project.slug ?? project.root}: compound ship command; adopt the core/legacy-ship ShipCommand wrapper`,
			);
			return null;
		}
		try {
			const result = await this.ps.spawnCapture(
				[
					"sh",
					"-c",
					`${project.ship}${inputArguments(inputs ?? {})} ${operation} --json`,
				],
				{
					cwd: project.root,
					stdin: "",
					timeoutMs: Duration.secs(5).ms,
				},
			);
			if (result.exitCode !== 0) {
				throw new Error(`exited ${result.exitCode}: ${result.stderr.trim()}`);
			}
			return schema.parse(JSON.parse(result.stdout));
		} catch (error) {
			this.log.info(
				`${project.slug ?? project.root}: ship ${operation} contract unavailable; adopt the core/legacy-ship ShipCommand wrapper: ${error}`,
			);
			return null;
		}
	}
}

interface CommandProject {
	root: string;
	slug?: string;
	ship?: string | null;
}

/** The identity as the server reads it: a deployment's `to` is its commit and it has no `from`. */
type Identity = { kind: "version" | "commit"; from: string | null; to: string };

function identityOf(identity: ShipIdentity): Identity {
	return identity.kind === "commit"
		? { kind: "commit", from: null, to: identity.commit }
		: { kind: "version", from: identity.from, to: identity.to };
}
