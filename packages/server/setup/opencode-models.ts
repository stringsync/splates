import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import { DEFAULT_AGENTS, type Roster, type RosterFile } from "../models";
import { OpenCodeModelError } from "./opencode-model-error";
import {
	contentPrefix,
	id,
	managedArgv,
	type OpenCodeRecipe,
	OpenCodeRecipes,
	projectOff,
} from "./opencode-recipe";

/** Only metadata commands. The configuration is embedded in the roster argv so
 * a single document update activates both the models and their experiment policy. */
export class OpenCodeModels {
	/** The Go catalog as last listed, kept briefly so one page read lists it once. */
	#catalog: { models: Promise<string[]>; at: number } | null = null;
	readonly recipes: OpenCodeRecipes;
	constructor(
		private readonly deps: { fs: Fs; ps: Ps; home: string; roster?: Roster },
		private readonly metadata: OpenCodeMetadata,
	) {
		this.recipes = new OpenCodeRecipes(deps);
	}

	/** The Go models OpenCode lists, by exact id. */
	catalog(): Promise<string[]> {
		if (this.#catalog === null || Date.now() - this.#catalog.at > CATALOG_TTL) {
			const models = this.discover(AbortSignal.timeout(15_000)).then(
				(models) => {
					if (!models.length) {
						throw new OpenCodeModelError("OpenCode lists no Go models.");
					}
					return models;
				},
			);
			// A failed listing is tried again on the next read.
			models.catch(() => {
				this.#catalog = null;
			});
			this.#catalog = { models, at: Date.now() };
		}
		return this.#catalog.models;
	}

	/** Lists the catalog afresh next time, as after a new login. */
	invalidate(): void {
		this.#catalog = null;
	}

	/**
	 * Writes `selection` as the roster's OpenCode recipe, once OpenCode
	 * confirms the configuration it makes is the one in effect.
	 */
	async save(selection: OpenCodeSelection, signal: AbortSignal): Promise<void> {
		if (this.deps.ps.platform === "win32") {
			throw new OpenCodeModelError(
				"This experiment launch recipe requires macOS or Linux.",
			);
		}
		openCodeSelection.parse(selection);
		this.invalidate();
		const models = await this.catalog();
		if (
			!models.includes(selection.model) ||
			!models.includes(selection.auxiliary)
		) {
			throw new OpenCodeModelError(
				"A chosen model is no longer listed. Pick again.",
			);
		}
		const config = recipeOf(selection);
		// Project sources are excluded only for this roster command; global
		// files remain untouched.
		const env = {
			OPENCODE_CONFIG_PROJECT_DISABLE: "1",
			OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
		};
		await this.verify(selection, config, signal, env);
		// Preserve the filesystem boundary's refusal of linked rosters.
		await this.recipes.rawRoster();
		await this.recipes.roster.update((current) => {
			const after = this.roster(current, selection, env);
			signal.throwIfAborted();
			return after;
		});
	}

	async verifyStored(
		recipe: OpenCodeRecipe,
		cwd: string,
		signal: AbortSignal,
	): Promise<void> {
		const models = await this.discover(signal, recipe.env, cwd);
		if (!models.includes(recipe.model) || !models.includes(recipe.auxiliary)) {
			throw new OpenCodeModelError(
				"A saved Go model is no longer listed. Go back to the models and pick again.",
			);
		}
		await this.verify(recipe, recipe.config, signal, recipe.env, cwd);
		await this.recipes.unchanged(recipe, signal);
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
				"OpenCode did not enforce the Go-only provider policy. Resolve its managed provider configuration, then press Try again.",
			);
		}
		return [...new Set(lines.filter((line) => id.safeParse(line).success))];
	}
	/**
	 * Confirms through OpenCode's configuration API that `config` is the
	 * configuration in effect, its agents' models included. OpenCode 2's
	 * agent listing is empty, so the configuration is the only witness.
	 */
	private async verify(
		selection: OpenCodeSelection,
		config: Record<string, unknown>,
		signal: AbortSignal,
		env: Record<string, string>,
		cwd = `${this.deps.home}/setup-opencode`,
	): Promise<void> {
		// Keep only comparisons; never return or persist raw config output.
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
				sameAgents(
					info.agents,
					config.agents as Record<string, { model: string }>,
				) &&
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
					"Your own OpenCode configuration sets providers or models that override this setup. Remove them, then press Try again.",
				);
			}
		}
		if (!found) {
			throw new OpenCodeModelError(
				"OpenCode did not confirm the configuration. Update OpenCode, then press Try again.",
			);
		}
	}
	private roster(
		current: RosterFile | null,
		selection: OpenCodeSelection,
		env: Record<string, string>,
	): RosterFile {
		// Validate using the existing roster contract, then edit the original JSON
		// so unknown fields, other agents, ordering and custom descriptions survive.
		const value = current ?? {
			format: 1,
			agents: structuredClone(DEFAULT_AGENTS),
		};
		const agents = value.agents;
		let agent = agents.find((entry) => entry.id === "opencode");
		if (agent && !managedArgv(agent.argv)) {
			throw new OpenCodeModelError(
				"Your roster's OpenCode entry has a launch command of its own, which Setup leaves alone. Remove it from agents.json, then press Try again.",
			);
		}
		if (!agent) {
			agent = { id: "opencode", name: "OpenCode Go", argv: [], models: [] };
			agents.push(agent);
		}
		agent.argv = [
			"env",
			projectOff,
			`${contentPrefix}${env.OPENCODE_CONFIG_CONTENT}`,
			"opencode",
			"acp",
		];
		const models = agent.models;
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
		return value;
	}
}

/** How long a listed catalog serves page reads before OpenCode is asked again. */
const CATALOG_TTL = 60_000;

/**
 * The agents the recipe names: the main model plans and builds, the
 * auxiliary one writes titles.
 */
const RECIPE_AGENTS = {
	build: "model",
	plan: "model",
	title: "auxiliary",
} as const;

/** The configuration a selection runs OpenCode with. */
function recipeOf(selection: OpenCodeSelection): RecipeConfig {
	return {
		model: selection.model,
		default_agent: "build",
		warming: false,
		policies: [
			{ action: "provider.use", resource: "*", effect: "deny" },
			{ action: "provider.use", resource: "opencode-go", effect: "allow" },
		],
		agents: Object.fromEntries(
			Object.entries(RECIPE_AGENTS).map(([name, which]) => [
				name,
				{ model: selection[which] },
			]),
		),
	};
}

interface RecipeConfig extends Record<string, unknown> {
	model: string;
	default_agent: string;
	warming: boolean;
	policies: unknown[];
	agents: Record<string, { model: string }>;
}

/** Whether OpenCode's echo of `agents` gives each the model the recipe set. */
function sameAgents(
	value: unknown,
	expected: Record<string, { model: string }>,
): boolean {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const echoed = value as Record<string, unknown>;
	return (
		Object.keys(echoed).length === Object.keys(expected).length &&
		Object.entries(expected).every(([name, { model }]) => {
			const agent = echoed[name];
			return (
				typeof agent === "object" &&
				agent !== null &&
				"model" in agent &&
				sameModel(agent.model, model)
			);
		})
	);
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
export interface OpenCodeMetadata {
	run(
		args: string[],
		signal: AbortSignal,
		env?: Record<string, string>,
		cwd?: string,
	): Promise<string>;
}

const entries = z.array(
	z.union([
		z.object({ type: z.literal("directory"), path: z.string() }),
		z.object({
			type: z.literal("document"),
			info: z.record(z.string(), z.unknown()),
		}),
	]),
);
