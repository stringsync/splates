import { basename } from "node:path";
import { fail } from "@splates/server/exit";
import { ranWith } from "@splates/server/models";
import { type Repository, repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import {
	type AssumptionView,
	BAND_LABELS,
	bandOf,
	isTrustBand,
	KIND_LABELS,
	type TrustBand,
	type TrustEntry,
	type TrustPosture,
	type TrustStanding,
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

/** Formats an agent/model pair for display. */
function modelLabel(entry: { agent: string; model: string | null }): string {
	return entry.model ? `${entry.agent}/${entry.model}` : entry.agent;
}

/** Formats session-bounded standing metrics compactly for CLI output. */
export function formatStanding(standing: TrustStanding): string {
	const sessions = `${standing.sessions} ${standing.sessions === 1 ? "session" : "sessions"}`;
	const days = `${standing.activeDays} ${standing.activeDays === 1 ? "day" : "days"}`;
	const parts = [sessions, days];
	if (standing.agreement !== null) {
		parts.push(`${standing.agreement}% agreed`);
	}
	return parts.join(", ");
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
			const label = modelLabel(entry);
			const mode =
				entry.mode === "static"
					? `pinned (earned ${BAND_LABELS[entry.earnedBand]})`
					: "auto";
			const standing = formatStanding(entry.standing);
			const asking =
				enabled && entry.asking.length > 0
					? `  ask first on ${entry.asking.map((kind) => KIND_LABELS[kind]).join(", ")}`
					: "";
			const project = [basename(entry.project), entry.scope]
				.filter(Boolean)
				.join(" · ");
			return `${project}  ${label}  ${BAND_LABELS[bandOf(entry, enabled)]}  ${mode}  (${standing})${asking}`;
		})
		.join("\n");
}

/**
 * The `trust:` line `splates add` and `claim` print: the effective band the
 * skill reads to ask or assume, `auto` vs `pinned`, compact earned standing,
 * and any kinds an overturn sent back to asking.
 */
export function formatPosture(posture: TrustPosture): string {
	const { entry, band, asking } = posture;
	const label = modelLabel(entry);
	const mode = entry.mode === "static" ? "pinned" : "auto";
	const standing = formatStanding(entry.standing);
	const details = [entry.scope, mode, standing].filter(Boolean).join(", ");
	const back =
		asking.length === 0
			? ""
			: `; ask first on ${asking.map((kind) => KIND_LABELS[kind]).join(", ")} (overturned)`;
	return `  trust:    ${BAND_LABELS[band]} for ${label} (${details})${back}`;
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
	const label = modelLabel(each);
	const what = each.overturned
		? `overturned: ${each.assumed} → ${each.overturned.instead}`
		: `${each.assumed} (vs ${each.alternative})`;
	return `${each.at.slice(0, 16).replace("T", " ")}  ${basename(each.project)}  ${label}  ${KIND_LABELS[each.kind]}  ${what}  [${each.conversation} #${each.number}]`;
}

/** Parses a trust band argument for CLI override commands. */
export function parseTrustBand(input: string): TrustBand {
	const normalized = input.trim().toLowerCase();
	if (isTrustBand(normalized)) {
		return normalized;
	}
	fail(
		"usage",
		`trust level must be "ask-and-wait", "ask-and-go", or "assume", got ${input}`,
	);
}

/** Parses `auto` or a pinned trust band for `splates trust set`. */
export function parseSetLevel(input: string): "auto" | TrustBand {
	const normalized = input.trim().toLowerCase();
	if (normalized === "auto") {
		return "auto";
	}
	if (isTrustBand(normalized)) {
		return normalized;
	}
	fail(
		"usage",
		`trust level must be "auto", "ask-and-wait", "ask-and-go", or "assume", got ${input}`,
	);
}

/**
 * `splates trust`: inspect and manage per project × agent/model earned trust
 * levels and band overrides.
 */
export const splatesTrust = cli<SplatesDeps>("trust")
	.description(
		"list, set, pin, reset, and switch trust levels per project and agent/model",
	)
	.fallback("list");

splatesTrust
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"list trust levels for this project (or every project with --all)",
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
		"set a model to auto or pin a trust level (ask-and-wait, ask-and-go, assume) for this project; pass <agent> or <agent>/<model>",
	)
	.arg("target", z.string(), {
		description: "agent or agent/model (e.g. claude/Opus 4.6)",
	})
	.arg("level", z.string(), {
		description: "auto, ask-and-wait, ask-and-go, or assume",
	})
	.option("model", z.string(), {
		default: "",
		description: "model name, when not given as <agent>/<model>",
	})
	.action(async (opts, ctx) => {
		const { agent, model } = parseAgentTarget(opts.target, opts.model);
		const level = parseSetLevel(opts.level);
		const store = new TrustStore(ctx.machine);
		const key = { project: ctx.git.root, agent, model };
		if (level === "auto") {
			await store.setDynamic(key);
		} else {
			await store.setStatic(key, level);
		}
		const entry = await store.entryFor(key);
		const label = modelLabel(entry);
		ctx.log.info(
			entry.mode === "static"
				? `${label} pinned to ${BAND_LABELS[entry.band]}`
				: `${label} set to auto (${BAND_LABELS[entry.band]})`,
		);
	});

splatesTrust
	.command("static")
	.use(repository({ needs: "read" }))
	.description(
		"pin a model to a trust level (ask-and-wait, ask-and-go, or assume)",
	)
	.arg("target", z.string(), {
		description: "agent or agent/model",
	})
	.arg("band", z.string(), {
		description: "trust level to pin: ask-and-wait, ask-and-go, or assume",
	})
	.option("model", z.string(), {
		default: "",
		description: "model name, when not given as <agent>/<model>",
	})
	.action(async (opts, ctx) => {
		const { agent, model } = parseAgentTarget(opts.target, opts.model);
		const band = parseTrustBand(opts.band);
		const store = new TrustStore(ctx.machine);
		const key = { project: ctx.git.root, agent, model };
		await store.setStatic(key, band);
		const entry = await store.entryFor(key);
		ctx.log.info(`${modelLabel(entry)} pinned to ${BAND_LABELS[entry.band]}`);
	});

splatesTrust
	.command("dynamic")
	.use(repository({ needs: "read" }))
	.description("switch a model back to auto (earned) trust")
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
		const key = { project: ctx.git.root, agent, model };
		await store.setDynamic(key);
		const entry = await store.entryFor(key);
		ctx.log.info(
			`${modelLabel(entry)} set to auto (${BAND_LABELS[entry.band]})`,
		);
	});

splatesTrust
	.command("reset")
	.use(repository({ needs: "read" }))
	.description(
		"reset a model's trust history for this project and return to auto mode",
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
		ctx.log.info(
			`${modelLabel(entry)} trust reset (auto, ${BAND_LABELS[entry.band]})`,
		);
	});
