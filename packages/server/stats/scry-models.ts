import { homedir } from "node:os";
import { join } from "node:path";

/** The efforts a rule can ask at, with `default` for a question naming none. */
const EFFORTS = ["default", "low", "medium", "high"] as const;

/** What scry asks when no config names a model, as its config docs give them. */
const DEFAULTS: Record<"som" | "llm", Record<string, string>> = {
	som: { default: "clef", low: "clef-flash" },
	llm: {
		default: "claude-sonnet-5-5",
		low: "claude-haiku-4-5",
		high: "claude-opus-5-5",
	},
};

/** One model scry asks at an effort, and the config naming it. */
export interface ModelChoice {
	effort: string;
	/** The model, or none when no config names one and scry has no default. */
	model: string | null;
	/** The config that names it; none when it is scry's own default. */
	from: string | null;
}

/** The models a project's checks ask, per role. */
export type ScryModels = Record<"som" | "llm", ModelChoice[]>;

/**
 * Reads which models scry will ask, from the project's `scry.config.ts` and
 * then the user's, which lays its own over the project's, over scry's
 * defaults. A config that cannot load names nothing.
 */
export class ScryModelsReader {
	constructor(
		private readonly root: string,
		private readonly home: string = homedir(),
	) {}

	async read(): Promise<ScryModels> {
		const layers = [
			join(this.root, "scry.config.ts"),
			join(this.home, ".config", "scry", "config.ts"),
		];
		const chosen: Record<"som" | "llm", Map<string, ModelChoice>> = {
			som: new Map(),
			llm: new Map(),
		};
		for (const path of layers) {
			const models = await this.#modelsOf(path);
			for (const role of ["som", "llm"] as const) {
				const named = models[role];
				if (typeof named === "string") {
					// a bare name asks it at every effort
					chosen[role].clear();
					chosen[role].set("default", {
						effort: "default",
						model: named,
						from: path,
					});
				} else if (named !== null && typeof named === "object") {
					for (const [effort, model] of Object.entries(named)) {
						if (typeof model === "string") {
							chosen[role].set(effort, { effort, model, from: path });
						}
					}
				}
			}
		}
		const out = { som: [], llm: [] } as ScryModels;
		for (const role of ["som", "llm"] as const) {
			for (const effort of EFFORTS) {
				const named = chosen[role].get(effort);
				const fallback = DEFAULTS[role][effort];
				if (named !== undefined) {
					out[role].push(named);
				} else if (fallback !== undefined && chosen[role].size === 0) {
					out[role].push({ effort, model: fallback, from: null });
				} else if (effort === "default") {
					out[role].push({ effort, model: null, from: null });
				}
			}
		}
		return out;
	}

	async #modelsOf(path: string): Promise<Record<string, unknown>> {
		try {
			const loaded = (await import(path)) as { default?: { models?: unknown } };
			const models = loaded.default?.models;
			return models !== null && typeof models === "object"
				? (models as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}
}
