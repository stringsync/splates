import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { fail } from "../exit";
import type { AgentPick } from "../models";

/** The agents an eval runs on, as the file keeps them. */
export interface EvalAgents {
	/** The file's own format. */
	format: 1;
	/** Each a full pick; one agent and model may stand at several thinking levels. */
	agents: AgentPick[];
}

/** The agents the eval runner starts natively, by roster id. */
export const NATIVE_AGENTS = ["claude", "codex", "opencode", "kimi"];

const FORMAT = 1;

const EVAL_AGENTS = z.object({
	format: z.literal(FORMAT),
	agents: z.array(
		z.object({
			agent: z.enum(NATIVE_AGENTS as [string, ...string[]]),
			model: z.string().min(1).optional(),
			effort: z.string().min(1).optional(),
		}),
	),
});

/** The eval agents as `~/.splates/eval-agents.json` keeps them, one list for every project on the machine. */
export class EvalAgentsStore {
	constructor(
		/** The file's path, or a test's own. */
		readonly path: string,
		private readonly fs: Fs,
	) {}

	/** The agents saved; none when there is no file. */
	async agents(): Promise<AgentPick[]> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return [];
		}
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			fail("usage", `${this.path} is not JSON: fix or delete it`, {
				path: this.path,
			});
		}
		return this.checked(json, `${this.path} is not eval agents`).agents;
	}

	/** Writes `agents` once they check out, refusing them, file untouched, when not. */
	async save(agents: unknown): Promise<void> {
		const checked = this.checked({ format: FORMAT, agents }, "not eval agents");
		const seen = new Set<string>();
		for (const pick of checked.agents) {
			const key = JSON.stringify([pick.agent, pick.model, pick.effort]);
			if (seen.has(key)) {
				fail(
					"usage",
					"not eval agents: an agent names the same model and thinking level once",
					{ path: this.path },
				);
			}
			seen.add(key);
		}
		await this.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")), {
			recursive: true,
		});
		// Through a temporary file, so a reader never sees half of it.
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(checked, null, "\t")}\n`);
		await this.fs.rename(tmp, this.path);
	}

	private checked(value: unknown, what: string): EvalAgents {
		const parsed = EVAL_AGENTS.safeParse(value);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			fail(
				"usage",
				`${what}: ${issue?.path.join(".") || "the agents"}: ${issue?.message}`,
				{ path: this.path },
			);
		}
		return parsed.data;
	}
}
