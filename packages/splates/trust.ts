import { basename } from "node:path";
import { fail } from "@splates/server/exit";
import { ranWith } from "@splates/server/models";
import { type Repository, repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import {
	type AssumptionView,
	BAND_LABELS,
	bandOf,
	KIND_LABELS,
	type TrustEntry,
	type TrustPosture,
	TrustStore,
} from "@splates/server/trust";
import { cli } from "core/cmd";
import { z } from "zod";

/** Splits `<agent>` or `<agent>/<model>` into agent and optional model. */
export function parseAgentTarget(
	target: string,
	modelFlag: string,
): { agent: string; model: string | null } {
	const slash = target.indexOf("/");
	if (slash !== -1 && modelFlag === "") {
		const agent = target.slice(0, slash).trim();
		const model = target.slice(slash + 1).trim();
		if (agent === "") {
			fail("usage", `invalid agent/model target: ${target}`);
		}
		return { agent, model: model === "" ? null : model };
	}
	const agent = target.trim();
	if (agent === "") {
		fail("usage", "agent is required");
	}
	return { agent, model: modelFlag.trim() === "" ? null : modelFlag.trim() };
}

/** Formats trust entries as a readable plain-text summary table. */
export function formatTrustList(
	entries: readonly TrustEntry[],
	enabled = true,
): string {
	if (entries.length === 0) {
		return "no trust records yet";
	}
	return entries
		.map((entry) => {
			const label = entry.model ? `${entry.agent}/${entry.model}` : entry.agent;
			const mode =
				entry.mode === "static"
					? `static (dynamic ${entry.dynamicScore})`
					: "dynamic";
			const counts = `${entry.counts.kept} kept, ${entry.counts.amended} amended, ${entry.counts.overturned} overturned`;
			const kinds = entry.kinds
				.filter((k) => k.counts.total > 0)
				.map((k) => `${k.kind}:${k.score}`)
				.join(" ");
			const breakdown = kinds === "" ? "" : `  [${kinds}]`;
			const project = [basename(entry.project), entry.scope]
				.filter(Boolean)
				.join(" · ");
			return `${project}  ${label}  ${entry.score}/100  ${BAND_LABELS[bandOf(entry, enabled)]}  ${mode}  (${counts})${breakdown}`;
		})
		.join("\n");
}

/**
 * The `trust:` line `splates add` and `claim` print: the score, the band the
 * skill reads to ask or assume, and the kinds an overturn sent back to asking.
 */
export function formatPosture(posture: TrustPosture): string {
	const { entry, band, asking } = posture;
	const label = entry.model ? `${entry.agent}/${entry.model}` : entry.agent;
	const decisions = `${entry.counts.total} decision${entry.counts.total === 1 ? "" : "s"}`;
	const mode = entry.mode === "static" ? "static" : decisions;
	const details = [entry.scope, mode].filter(Boolean).join(", ");
	const back =
		asking.length === 0
			? ""
			: `; ask first on ${asking.map((kind) => KIND_LABELS[kind]).join(", ")} (overturned)`;
	return `  trust:    ${entry.score}/100 for ${label} (${details}): ${BAND_LABELS[band]}${back}`;
}

/**
 * Prints the `trust:` line for the `splates server` conversation this agent
 * runs in; says nothing outside one, where `splates trust` lists every model.
 */
export async function printTrust(
	ctx: SplatesDeps & Repository,
	task: string,
): Promise<void> {
	const id = await ctx.service.conversation().catch(() => undefined);
	if (id === undefined) {
		return;
	}
	const ran = await ranWith(ctx.service.conversationLog(id)).catch(() => null);
	if (ran === null) {
		return;
	}
	const trust = new TrustStore(ctx.machine);
	const project = ctx.git.root;
	const files = await trust
		.hasScopeHistory(project)
		.then(async (hasScopes) =>
			hasScopes ? (await ctx.service.find(task)).changedFiles() : null,
		)
		.catch(() => null);
	const posture = await trust
		.keyForFiles({ project, ...ran }, files ?? [])
		.then((key) => trust.posture(key))
		.catch(() => null);
	if (posture !== null) {
		ctx.log.info(formatPosture(posture));
	}
}

/** One assumption as `splates trust assumptions` lists it. */
export function formatAssumption(each: AssumptionView): string {
	const label = each.model ? `${each.agent}/${each.model}` : each.agent;
	const what = each.overturned
		? `overturned: ${each.assumed} → ${each.overturned.instead}`
		: `${each.assumed} (vs ${each.alternative})`;
	return `${each.at.slice(0, 16).replace("T", " ")}  ${basename(each.project)}  ${label}  ${KIND_LABELS[each.kind]}  ${what}  [${each.conversation} #${each.number}]`;
}

/**
 * `splates trust`: inspect and manage per project × agent/model trust scores
 * and static/dynamic settings.
 */
export const splatesTrust = cli<SplatesDeps>("trust")
	.description(
		"list, set, reset, and switch between static and dynamic trust scores per project and agent/model",
	)
	.fallback("list");

splatesTrust
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"list trust scores for this project (or every project with --all)",
	)
	.option("all", z.boolean(), {
		default: false,
		description: "show trust across every project on this machine",
	})
	.option("json", z.boolean(), {
		default: false,
		description: "emit JSON",
	})
	.action(async (opts, ctx) => {
		const store = new TrustStore(ctx.machine);
		const entries = await store.list(opts.all ? {} : { project: ctx.git.root });
		const enabled = await store.enabled();
		if (opts.json) {
			ctx.log.info(JSON.stringify({ entries, enabled }, null, 2));
			return;
		}
		if (!enabled) {
			ctx.log.info(
				"Trusted decisions are paused for all projects. Ask and wait.",
			);
		}
		ctx.log.info(formatTrustList(entries, enabled));
	});

splatesTrust
	.command("assumptions")
	.use(repository({ needs: "read" }))
	.description(
		"list the calls agents made without asking (`🛡 Assumed:` lines), newest first, with any the user overturned",
	)
	.option("all", z.boolean(), {
		default: false,
		description: "show assumptions across every project on this machine",
	})
	.option("limit", z.coerce.number(), {
		default: 20,
		description: "how many to show",
	})
	.option("json", z.boolean(), {
		default: false,
		description: "emit JSON",
	})
	.action(async (opts, ctx) => {
		const { assumptions, total } = await new TrustStore(
			ctx.machine,
		).assumptions({
			project: opts.all ? undefined : ctx.git.root,
			limit: Math.max(1, opts.limit),
		});
		if (opts.json) {
			ctx.log.info(JSON.stringify({ assumptions, total }, null, 2));
			return;
		}
		ctx.log.info(
			assumptions.length === 0
				? "no assumptions yet"
				: [
						...assumptions.map(formatAssumption),
						...(total > assumptions.length
							? [`${total - assumptions.length} older not shown`]
							: []),
					].join("\n"),
		);
	});

splatesTrust
	.command("set")
	.use(repository({ needs: "read" }))
	.description(
		"set a model's trust value (0-100) for this project, keeping its current mode (dynamic or static); pass <agent> or <agent>/<model>",
	)
	.arg("target", z.string(), {
		description: "agent or agent/model (e.g. claude/Opus 4.6)",
	})
	.arg("value", z.coerce.number(), {
		description: "trust value from 0 to 100",
	})
	.option("model", z.string(), {
		default: "",
		description: "model name, when not given as <agent>/<model>",
	})
	.action(async (opts, ctx) => {
		const { agent, model } = parseAgentTarget(opts.target, opts.model);
		const store = new TrustStore(ctx.machine);
		const key = { project: ctx.git.root, agent, model };
		await store.setValue(key, opts.value);
		const entry = await store.entryFor(key);
		const label = entry.model ? `${entry.agent}/${entry.model}` : entry.agent;
		ctx.log.info(`${label} set to ${entry.mode} ${entry.score}/100`);
	});

splatesTrust
	.command("static")
	.use(repository({ needs: "read" }))
	.description(
		"switch a model to static trust (optionally setting its 0-100 value)",
	)
	.arg("target", z.string(), {
		description: "agent or agent/model",
	})
	.arg("value", z.string(), {
		default: "",
		description: "optional static trust value from 0 to 100",
	})
	.option("model", z.string(), {
		default: "",
		description: "model name, when not given as <agent>/<model>",
	})
	.action(async (opts, ctx) => {
		const { agent, model } = parseAgentTarget(opts.target, opts.model);
		const value = opts.value === "" ? undefined : Number(opts.value);
		const store = new TrustStore(ctx.machine);
		const setting = await store.setMode(
			{ project: ctx.git.root, agent, model },
			"static",
			value,
		);
		const label = setting.model
			? `${setting.agent}/${setting.model}`
			: setting.agent;
		ctx.log.info(`${label} set to static ${setting.value}/100`);
	});

splatesTrust
	.command("dynamic")
	.use(repository({ needs: "read" }))
	.description(
		"switch a model back to dynamic trust (optionally setting its starting 0-100 value)",
	)
	.arg("target", z.string(), {
		description: "agent or agent/model",
	})
	.arg("value", z.string(), {
		default: "",
		description: "optional starting dynamic trust value from 0 to 100",
	})
	.option("model", z.string(), {
		default: "",
		description: "model name, when not given as <agent>/<model>",
	})
	.action(async (opts, ctx) => {
		const { agent, model } = parseAgentTarget(opts.target, opts.model);
		const value = opts.value === "" ? undefined : Number(opts.value);
		const store = new TrustStore(ctx.machine);
		await store.setMode(
			{ project: ctx.git.root, agent, model },
			"dynamic",
			value,
		);
		const entry = await store.entryFor({ project: ctx.git.root, agent, model });
		const label = entry.model ? `${entry.agent}/${entry.model}` : entry.agent;
		ctx.log.info(`${label} set to dynamic (${entry.score}/100)`);
	});

splatesTrust
	.command("reset")
	.use(repository({ needs: "read" }))
	.description(
		"reset a model's trust history for this project and return to dynamic mode",
	)
	.arg("target", z.string(), {
		description: "agent or agent/model",
	})
	.option("model", z.string(), {
		default: "",
		description: "model name, when not given as <agent>/<model>",
	})
	.action(async (opts, ctx) => {
		const { agent, model } = parseAgentTarget(opts.target, opts.model);
		const store = new TrustStore(ctx.machine);
		await store.reset({ project: ctx.git.root, agent, model });
		const entry = await store.entryFor({ project: ctx.git.root, agent, model });
		const label = entry.model ? `${entry.agent}/${entry.model}` : entry.agent;
		ctx.log.info(`${label} trust reset (dynamic ${entry.score}/100)`);
	});
