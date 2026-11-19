import { z } from "zod";
import type { RecLogSource } from "../config";
import { recLogSources } from "../config";
import type { RecCommandLog, RecLogChoice } from "./browser";

/**
 * The log sources a project declares under `rec.logs` in its
 * `splates.config.ts`, for the Rec page to offer and for opening rec to look
 * up: a request names a source, and only a declared command ever runs.
 */
export class RecLogSources {
	constructor(private readonly project: ProjectLogs) {}

	/** What the asking page's project offers, or why its `rec.logs` cannot be read. */
	async offered(
		request: Request,
	): Promise<{ logs?: RecLogChoice[]; logsError?: string }> {
		const declared = await this.declared(request);
		if ("error" in declared) {
			return { logsError: declared.error };
		}
		return declared.logs.length === 0
			? {}
			: {
					logs: declared.logs.map((each) => ({
						name: each.name,
						command: each.command,
						...(each.label === undefined ? {} : { label: each.label }),
					})),
				};
	}

	/**
	 * The declared sources `names` picks and the project's root they run in,
	 * or why they cannot be fetched, such as a name the project does not declare.
	 */
	async picked(
		request: Request,
		names: string[],
	): Promise<{ logs: RecLogSource[]; root?: string } | { refused: string }> {
		if (names.length === 0) {
			return { logs: [] };
		}
		const declared = await this.declared(request);
		if ("error" in declared) {
			return { refused: declared.error };
		}
		const unknown = names.find(
			(name) => !declared.logs.some((each) => each.name === name),
		);
		if (unknown !== undefined) {
			return {
				refused: `no log source '${unknown}' under rec.logs in splates.config.ts`,
			};
		}
		return {
			logs: declared.logs.filter((each) => names.includes(each.name)),
			...(declared.root === undefined ? {} : { root: declared.root }),
		};
	}

	private async declared(
		request: Request,
	): Promise<{ root?: string; logs: RecLogSource[] } | { error: string }> {
		try {
			const project = await this.project.find(request);
			return project === null
				? { logs: [] }
				: { root: project.root, logs: recLogSources(project.rec) };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}
}

/**
 * The asking page's project: its root, where declared log commands run, and
 * the `rec` block of its `splates.config.ts`, unchecked. Null declares none.
 */
export interface ProjectLogs {
	find(request: Request): Promise<{ root: string; rec?: unknown } | null>;
}

/** A project that declares no log sources, for a Rec that serves no page's project. */
export const NO_PROJECT_LOGS: ProjectLogs = { find: async () => null };

/** Rec's `--logs` arguments for `logs`, as `--logs api@utc=<command>`. */
export function logsArgs(logs: RecLogSource[]): string[] {
	return logs.flatMap((log) => [
		"--logs",
		`${log.name}${log.zone === "utc" ? "@utc" : ""}=${log.command}`,
	]);
}

/** How each command log source of the session in `folder` last went, from its manifest. */
export async function commandLogs(folder: string): Promise<RecCommandLog[]> {
	try {
		const parsed = COMMAND_LOGS.safeParse(
			JSON.parse(await Bun.file(`${folder}/manifest.json`).text()),
		);
		return parsed.success
			? (parsed.data.commandLogs ?? []).map((each) => ({
					name: each.name,
					status: each.status,
					...(each.note === undefined ? {} : { note: each.note }),
					...(each.retry === undefined ? {} : { retry: each.retry }),
				}))
			: [];
	} catch {
		return [];
	}
}

const COMMAND_LOGS = z.object({
	commandLogs: z
		.array(
			z.object({
				name: z.string(),
				status: z.enum(["pending", "ok", "cut", "failed"]),
				note: z.string().optional(),
				retry: z.string().optional(),
			}),
		)
		.optional(),
});
