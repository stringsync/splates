import { FileLock, type Fs, type Ps } from "webappwiz/system";
import { z } from "zod";
import { DEFAULT_AGENTS, Roster } from "./roster";
import { OpenCodeModelError } from "./setup-opencode-model-error";
import {
	contentPrefix,
	id,
	managedArgv,
	type OpenCodeRecipe,
	OpenCodeRecipes,
	projectOff,
} from "./setup-opencode-recipe";

/** Only metadata commands. The configuration is embedded in the roster argv so
 * a single atomic rename activates both the models and their experiment policy. */
export class OpenCodeModels {
	private catalog: OpenCodeCatalog = {
		models: [],
		checkedAt: null,
		problem: null,
	};
	private previewed: {
		view: OpenCodePreview;
		before: string | null;
		after: string;
		env: Record<string, string>;
	} | null = null;
	private saved: OpenCodeSelection | null = null;
	readonly recipes: OpenCodeRecipes;
	constructor(
		private readonly deps: { fs: Fs; ps: Ps; home: string },
		private readonly metadata: OpenCodeMetadata,
	) {
		this.recipes = new OpenCodeRecipes(deps);
	}

	read(): OpenCodeModelState {
		return structuredClone({
			catalog: this.catalog,
			preview: this.previewed?.view ?? null,
			saved: this.saved,
		});
	}
	invalidate(): void {
		this.catalog = { models: [], checkedAt: null, problem: null };
		this.previewed = null;
		this.saved = null;
	}
	cancel(): void {
		this.previewed = null;
	}

	async refresh(signal: AbortSignal): Promise<OpenCodeModelState> {
		this.previewed = null;
		this.saved = null;
		this.catalog = { models: [], checkedAt: null, problem: null };
		try {
			const help = await this.metadata.run(["models", "--help"], signal);
			if (!help.includes("--standalone")) {
				throw new OpenCodeModelError("unsupported");
			}
			const models = await this.discover(signal);
			if (!models.length) {
				throw new OpenCodeModelError("empty");
			}
			this.catalog = {
				models,
				checkedAt: new Date().toISOString(),
				problem: null,
			};
		} catch {
			this.catalog.problem = signal.aborted
				? "Model refresh canceled. Retry when ready."
				: "No Go models could be listed. Check your native Go connection and update OpenCode if its model interface is unsupported, then refresh. No prompt was sent.";
		}
		return this.read();
	}

	async preview(
		selection: OpenCodeSelection,
		signal: AbortSignal,
	): Promise<OpenCodeModelState> {
		this.previewed = null;
		if (this.deps.ps.platform === "win32") {
			throw new OpenCodeModelError(
				"This experiment launch recipe requires macOS or Linux.",
			);
		}
		this.requireModels(selection);
		const help = await this.metadata.run(["api", "--help"], signal);
		if (!help.includes("--standalone") || !help.includes("--param")) {
			throw new OpenCodeModelError(
				"Update OpenCode: the supported configuration inspection interface is unavailable.",
			);
		}
		// Project sources are excluded only for this roster command. Global files
		// remain untouched, and all observed custom agents receive an explicit model.
		const baseEnv = { OPENCODE_CONFIG_PROJECT_DISABLE: "1" };
		const names = (await this.agents(signal, baseEnv)).map((agent) => agent.id);
		if (!names.includes("build") || !names.includes("title")) {
			throw new OpenCodeModelError(
				"OpenCode did not expose the expected main and auxiliary agents. Update it and retry.",
			);
		}
		const config = {
			model: selection.model,
			default_agent: "build",
			warming: false,
			policies: [
				{ action: "provider.use", resource: "*", effect: "deny" },
				{ action: "provider.use", resource: "opencode-go", effect: "allow" },
			],
			agents: Object.fromEntries(
				names.map((name) => [
					name,
					{
						model:
							name === "build" || name === "plan"
								? selection.model
								: selection.auxiliary,
					},
				]),
			),
		};
		const env = { ...baseEnv, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
		await this.verify(selection, config, signal, env);
		const before = await this.recipes.rawRoster();
		const after = await this.roster(before, selection, env);
		signal.throwIfAborted();
		this.previewed = {
			before,
			after,
			env,
			view: {
				...selection,
				token: crypto.randomUUID(),
				path: `${this.deps.home}/agents.json`,
				config,
				agents: names,
			},
		};
		return this.read();
	}

	async apply(
		token: string,
		balanceOff: boolean,
		signal: AbortSignal,
	): Promise<OpenCodeModelState> {
		const preview = this.previewed;
		this.previewed = null;
		if (!preview || preview.view.token !== token) {
			throw new OpenCodeModelError(
				"Preview expired. Review the configuration again.",
			);
		}
		if (!balanceOff) {
			throw new OpenCodeModelError(
				"Confirm in Console that Use balance is off before applying.",
			);
		}
		const selected = {
			model: preview.view.model,
			auxiliary: preview.view.auxiliary,
		};
		const fresh = await this.discover(signal, preview.env);
		if (
			!fresh.includes(selected.model) ||
			!fresh.includes(selected.auxiliary)
		) {
			this.catalog = {
				models: fresh,
				checkedAt: new Date().toISOString(),
				problem: "A selected model is no longer available. Choose again.",
			};
			throw new OpenCodeModelError(
				this.catalog.problem ?? "Selected model unavailable",
			);
		}
		await this.verify(selected, preview.view.config, signal, preview.env);
		const path = `${this.deps.home}/agents.json`;
		const lock = new FileLock(`${path}.lock`, this.deps);
		await this.deps.fs.mkdir(this.deps.home, { recursive: true });
		await lock.acquire();
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		try {
			signal.throwIfAborted();
			if ((await this.recipes.rawRoster()) !== preview.before) {
				throw new OpenCodeModelError(
					"The roster changed after preview. Review again to preserve those changes.",
				);
			}
			await this.deps.fs.write(tmp, preview.after);
			await this.deps.fs.chmod(tmp, 0o600);
			signal.throwIfAborted();
			await this.deps.fs.rename(tmp, path);
			this.saved = selected;
		} finally {
			await this.deps.fs.rm(tmp, { force: true }).catch(() => {});
			await lock.release();
		}
		return this.read();
	}

	async verifyStored(
		recipe: OpenCodeRecipe,
		cwd: string,
		signal: AbortSignal,
	): Promise<void> {
		const help = await this.metadata.run(
			["api", "--help"],
			signal,
			recipe.env,
			cwd,
		);
		const modelsHelp = await this.metadata.run(
			["models", "--help"],
			signal,
			recipe.env,
			cwd,
		);
		if (
			!help.includes("--standalone") ||
			!help.includes("--param") ||
			!modelsHelp.includes("--standalone")
		) {
			throw new OpenCodeModelError(
				"Update OpenCode, then retry the configuration check.",
			);
		}
		const models = await this.discover(signal, recipe.env, cwd);
		if (!models.includes(recipe.model) || !models.includes(recipe.auxiliary)) {
			throw new OpenCodeModelError(
				"A saved Go model is unavailable. Revisit model selection and choose again.",
			);
		}
		await this.verify(recipe, recipe.config, signal, recipe.env, cwd);
		await this.recipes.unchanged(recipe, signal);
	}

	private requireModels(selection: OpenCodeSelection): void {
		openCodeSelection.parse(selection);
		if (
			this.catalog.problem ||
			!this.catalog.checkedAt ||
			!this.catalog.models.includes(selection.model) ||
			!this.catalog.models.includes(selection.auxiliary)
		) {
			throw new OpenCodeModelError(
				"Refresh the catalog and choose exact available Go model IDs.",
			);
		}
	}
	private async discover(
		signal: AbortSignal,
		env?: Record<string, string>,
		cwd?: string,
	): Promise<string[]> {
		const text = await this.metadata.run(
			["models", "--standalone"],
			signal,
			env,
			cwd,
		);
		const lines = text.trim() ? text.trim().split(/\r?\n/) : [];
		if (
			lines.length > 10_000 ||
			lines.some(
				(line) => !/^[A-Za-z0-9._-]+\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(line),
			)
		) {
			throw new OpenCodeModelError("unknown catalog");
		}
		if (env && lines.some((line) => !id.safeParse(line).success)) {
			throw new OpenCodeModelError(
				"OpenCode did not enforce the Go-only provider policy. Resolve its managed provider configuration before applying.",
			);
		}
		return [...new Set(lines.filter((line) => id.safeParse(line).success))];
	}
	private async agents(
		signal: AbortSignal,
		env: Record<string, string>,
		cwd = `${this.deps.home}/setup-opencode`,
	) {
		return agentList.parse(
			JSON.parse(
				await this.metadata.run(
					["api", "agent.list", "--standalone", "--param", `directory=${cwd}`],
					signal,
					env,
					cwd,
				),
			),
		).data;
	}
	private async verify(
		selection: OpenCodeSelection,
		config: Record<string, unknown>,
		signal: AbortSignal,
		env: Record<string, string>,
		cwd = `${this.deps.home}/setup-opencode`,
	): Promise<void> {
		// Inspect configuration through the supported API, never native credential
		// files. Keep only comparisons; do not return or persist raw config output.
		const sources = entries.parse(
			JSON.parse(
				await this.metadata.run(
					["api", "config.get", "--standalone", "--param", `directory=${cwd}`],
					signal,
					env,
					cwd,
				),
			),
		);
		let found = false;
		for (const source of sources) {
			if (source.type !== "document") {
				continue;
			}
			const info = source.info;
			if (
				JSON.stringify(info.policies) === JSON.stringify(config.policies) &&
				sameModel(info.model, selection.model) &&
				info.warming === false &&
				info.default_agent === "build" &&
				!(
					typeof info.providers === "object" &&
					info.providers !== null &&
					"opencode-go" in info.providers
				)
			) {
				found = true;
				continue;
			}
			// Managed configuration can outrank inline content. Unknown provider
			// policies or a custom Go endpoint must be resolved, never overwritten.
			const policies = info.policies;
			const providers = info.providers;
			if (
				(Array.isArray(policies) &&
					policies.some(
						(policy) =>
							typeof policy === "object" &&
							policy !== null &&
							"action" in policy &&
							policy.action === "provider.use",
					)) ||
				(typeof providers === "object" &&
					providers !== null &&
					"opencode-go" in providers) ||
				(found &&
					("model" in info ||
						"agents" in info ||
						"warming" in info ||
						"default_agent" in info))
			) {
				throw new OpenCodeModelError(
					"Existing provider or managed configuration conflicts with this experiment. Resolve that configuration before applying; no files were changed.",
				);
			}
		}
		if (!found) {
			throw new OpenCodeModelError(
				"OpenCode did not confirm the experiment provider policy. Update it and retry.",
			);
		}
		const agents = await this.agents(signal, env, cwd);
		const expected = config.agents as Record<string, { model: string }>;
		if (
			agents.length !== Object.keys(expected).length ||
			new Set(agents.map((agent) => agent.id)).size !== agents.length ||
			agents.some(
				(agent) =>
					!Object.hasOwn(expected, agent.id) ||
					`${agent.model?.providerID}/${agent.model?.id}` !==
						expected[agent.id]?.model,
			)
		) {
			throw new OpenCodeModelError(
				"A custom or managed agent overrides an experiment model. Refresh and review the configuration again.",
			);
		}
	}
	private async roster(
		raw: string | null,
		selection: OpenCodeSelection,
		env: Record<string, string>,
	): Promise<string> {
		// Validate using the existing roster contract, then edit the original JSON
		// so unknown fields, other agents, ordering and custom descriptions survive.
		await new Roster(`${this.deps.home}/agents.json`, this.deps).agents();
		const value =
			raw === null
				? { format: 1, agents: structuredClone(DEFAULT_AGENTS) }
				: JSON.parse(raw);
		const agents = value.agents as Array<Record<string, unknown>>;
		let agent = agents.find((entry) => entry.id === "opencode");
		if (agent && !managedArgv(agent.argv)) {
			throw new OpenCodeModelError(
				"The OpenCode entry has a custom launch command. Setup leaves it untouched; reconcile that command before applying.",
			);
		}
		if (!agent) {
			agent = { id: "opencode", name: "OpenCode Go", models: [] };
			agents.push(agent);
		}
		agent.argv = [
			"env",
			projectOff,
			`${contentPrefix}${env.OPENCODE_CONFIG_CONTENT}`,
			"opencode",
			"acp",
		];
		const models = agent.models as Array<Record<string, unknown>>;
		for (const model of new Set([selection.model, selection.auxiliary])) {
			if (!models.some((entry) => entry.id === model)) {
				models.push({
					id: model,
					name: model,
					strengths: "Explicit OpenCode Go selection",
					cost: "Go subscription; access and billing confirmed in Console",
				});
			}
		}
		return `${JSON.stringify(value, null, "\t")}\n`;
	}
}

function sameModel(value: unknown, expected: string): boolean {
	return (
		value === expected ||
		(typeof value === "object" &&
			value !== null &&
			"providerID" in value &&
			"model" in value &&
			`${value.providerID}/${value.model}` === expected)
	);
}

export const openCodeSelection = z.object({ model: id, auxiliary: id });
export type OpenCodeSelection = z.infer<typeof openCodeSelection>;
export interface OpenCodeCatalog {
	models: string[];
	checkedAt: string | null;
	problem: string | null;
}
export interface OpenCodePreview extends OpenCodeSelection {
	token: string;
	path: string;
	config: Record<string, unknown>;
	agents: string[];
}
export interface OpenCodeModelState {
	catalog: OpenCodeCatalog;
	preview: OpenCodePreview | null;
	saved: OpenCodeSelection | null;
}

export interface OpenCodeMetadata {
	run(
		args: string[],
		signal: AbortSignal,
		env?: Record<string, string>,
		cwd?: string,
	): Promise<string>;
}

const agentList = z.object({
	data: z.array(
		z.object({
			id: z.string().min(1).max(240),
			model: z.object({ providerID: z.string(), id: z.string() }).optional(),
		}),
	),
});
const entries = z.array(
	z.union([
		z.object({ type: z.literal("directory"), path: z.string() }),
		z.object({
			type: z.literal("document"),
			info: z.record(z.string(), z.unknown()),
		}),
	]),
);
