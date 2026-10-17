import { FileLock, type Fs, type Ps } from "webappwiz/system";
import { z } from "zod";
import { Roster } from "./roster";
import { OpenCodeModelError } from "./setup-opencode-model-error";
import type { OpenCodeSelection } from "./setup-opencode-models";

export class OpenCodeRecipes {
	constructor(private readonly deps: { fs: Fs; ps: Ps; home: string }) {}

	/** Read disk on every revisit; this never asserts readiness or runs a process. */
	async stored(): Promise<OpenCodeRecipe | null> {
		const raw = await this.rawRoster();
		if (raw === null) {
			return null;
		}
		const agents = await new Roster(
			`${this.deps.home}/agents.json`,
			this.deps,
		).agents();
		const agent = agents.find((entry) => entry.id === "opencode");
		if (!agent) {
			return null;
		}
		if (!managedArgv(agent.argv) || agent.argv.length !== 5) {
			throw new OpenCodeModelError(
				"OpenCode has no supported setup recipe. Revisit model selection to repair it; custom commands are left untouched.",
			);
		}
		const content = agent.argv[2]?.slice(contentPrefix.length) ?? "";
		const config = recipeConfig.parse(JSON.parse(content));
		const selection = {
			model: config.model,
			auxiliary: config.agents.title.model,
		};
		if (
			Object.entries(config.agents).some(
				([name, entry]) =>
					entry.model !==
					(name === "build" || name === "plan"
						? selection.model
						: selection.auxiliary),
			) ||
			!Object.values(selection).every((id) =>
				agent.models.some((model) => model.id === id),
			)
		) {
			throw new OpenCodeModelError(
				"The stored model recipe changed. Revisit model selection and review it again.",
			);
		}
		return {
			...selection,
			config,
			env: {
				OPENCODE_CONFIG_PROJECT_DISABLE: "1",
				OPENCODE_CONFIG_CONTENT: content,
			},
			raw,
		};
	}

	async unchanged(recipe: OpenCodeRecipe, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		if ((await this.rawRoster()) !== recipe.raw) {
			throw new OpenCodeModelError(
				"The roster changed during the check. Check configuration again.",
			);
		}
	}

	/** Only removes the wizard-owned entry; native authentication is untouched. */
	async disable(signal: AbortSignal): Promise<void> {
		const lock = new FileLock(`${this.deps.home}/agents.json.lock`, this.deps);
		await lock.acquire();
		const path = `${this.deps.home}/agents.json`;
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		try {
			const recipe = await this.stored();
			if (!recipe) {
				return;
			}
			const value = JSON.parse(recipe.raw);
			value.agents = value.agents.filter(
				(entry: { id: string }) => entry.id !== "opencode",
			);
			await this.deps.fs.write(tmp, `${JSON.stringify(value, null, "\t")}\n`);
			await this.deps.fs.chmod(tmp, 0o600);
			await this.unchanged(recipe, signal);
			await this.deps.fs.rename(tmp, path);
		} finally {
			await this.deps.fs.rm(tmp, { force: true }).catch(() => {});
			await lock.release();
		}
	}

	async rawRoster(): Promise<string | null> {
		const path = `${this.deps.home}/agents.json`;
		if (await this.deps.fs.isSymlink(path)) {
			throw new OpenCodeModelError(
				"The roster is a symbolic link. Manage its target explicitly before using setup.",
			);
		}
		return (await this.deps.fs.exists(path)) ? this.deps.fs.read(path) : null;
	}
}

export function managedArgv(value: unknown): boolean {
	if (!Array.isArray(value)) {
		return false;
	}
	return (
		JSON.stringify(value) === JSON.stringify(["opencode", "acp"]) ||
		(value.length === 5 &&
			value[0] === "env" &&
			value[1] === projectOff &&
			typeof value[2] === "string" &&
			value[2].startsWith(contentPrefix) &&
			value[3] === "opencode" &&
			value[4] === "acp")
	);
}
export const projectOff = "OPENCODE_CONFIG_PROJECT_DISABLE=1";
export const contentPrefix = "OPENCODE_CONFIG_CONTENT=";

export interface OpenCodeRecipe extends OpenCodeSelection {
	config: Record<string, unknown>;
	env: Record<string, string>;
	raw: string;
}
export const id = z
	.string()
	.max(240)
	.regex(/^opencode-go\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const recipeConfig = z
	.object({
		model: id,
		default_agent: z.literal("build"),
		warming: z.literal(false),
		policies: z.tuple([
			z
				.object({
					action: z.literal("provider.use"),
					resource: z.literal("*"),
					effect: z.literal("deny"),
				})
				.strict(),
			z
				.object({
					action: z.literal("provider.use"),
					resource: z.literal("opencode-go"),
					effect: z.literal("allow"),
				})
				.strict(),
		]),
		agents: z.record(z.string(), z.object({ model: id }).strict()).and(
			z.object({
				build: z.object({ model: id }),
				title: z.object({ model: id }),
			}),
		),
	})
	.strict();
