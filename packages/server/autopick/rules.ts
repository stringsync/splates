import { z } from "zod";
import type { AgentPick } from "../models";
import {
	LINEUP_COLORS,
	type LineupColor,
	ROUTE_DEPTHS,
	ROUTE_KINDS,
	type RouteDepth,
	type RouteKind,
	RULES_FORMAT,
	UNSURE,
} from "./cells";
import { migrateRules } from "./migrate";

// Browser-safe: the page edits the rules, so this file brings in no agent
// processes and no `bun:` modules, and takes only types from `../models`.

/** Rules that check out, or the first problem with them, in a line the page can show. */
export type CheckedRules =
	| { ok: true; rules: AutopickRules }
	| { ok: false; problem: string };

/** Checks `value` as a mapping, for the page's editor and the file alike. */
export function checkRules(value: unknown): CheckedRules {
	const parsed = AUTOPICK_RULES.safeParse(migrateRules(value));
	if (parsed.success) {
		return { ok: true, rules: parsed.data as AutopickRules };
	}
	const issue = parsed.error.issues[0];
	return {
		ok: false,
		problem: `${issue?.path.join(".") || "the rules"}: ${issue?.message}`,
	};
}

/**
 * The person's mapping from a task's kind and depth to who works it, one per
 * machine, kept in `~/.splates/auto-pick.json`: named lineups, and routes
 * sending every kind and depth, unsure ones too, to one of them.
 */
export interface AutopickRules {
	/** The file's own format. */
	format: typeof RULES_FORMAT;
	/**
	 * How sure the judge has to be, 0 to 1, before its likeliest kind or depth
	 * counts; below it, the task is that dimension's `unsure`.
	 */
	threshold: number;
	/** Who can work a task, each a named list of picks in fallback order. */
	lineups: Lineup[];
	/** The lineup, by id, for every kind and depth. */
	routes: Routes;
	/** When a pick's plan counts as used too fast; left out, `DEFAULT_PACE`. */
	pace?: Pace;
	/** Whether a share of tasks starts one difficulty easier, as an experiment; left out, off. */
	holdout?: Holdout;
}

/**
 * A share of tasks started one difficulty easier than judged, on the same
 * agent, so their outcomes show whether a cell's lineup is stronger than its
 * tasks need. It trades some quality for knowing, so only the person turns
 * it on.
 */
export interface Holdout {
	on: boolean;
	/** The share of tasks held out, 0 to 1. */
	share: number;
}

/** A named fallback order for tasks: choose one model per agent. */
export interface Lineup {
	/** Stable identifier. Use this value in routes to select the lineup. */
	id: string;
	name: string;
	color: LineupColor;
	/**
	 * Whom it picks, the first first: a pick whose agent's plan is nearly
	 * used up is passed over for the next. A pick with no model takes the
	 * agent's default model, one with no effort its default thinking level.
	 */
	picks: AgentPick[];
}

/** The lineup id for each kind, then each depth. */
export type Routes = Record<RouteKind, Record<RouteDepth, string>>;

/** The lineup the routes send `kind` at `depth` to; unsure when null. */
export function lineupFor(
	rules: AutopickRules,
	kind: RouteKind | null,
	depth: RouteDepth | null,
): Lineup | undefined {
	const id = rules.routes[kind ?? UNSURE]?.[depth ?? UNSURE];
	return rules.lineups.find((each) => each.id === id);
}

/**
 * When a pick is passed over for the next in its lineup because of its
 * agent's plan, each share 0 to 1 of a plan window.
 */
export interface Pace {
	/**
	 * Whether a pick is passed over while its agent uses any window faster
	 * than the window goes by: more of it used than `slack` past the share
	 * of it gone.
	 */
	on: boolean;
	/** How far use may run ahead of the window's time before a pick is passed over. */
	slack: number;
	/** Past this much of any window, a pick is passed over, pace or not. */
	spent: number;
}

/**
 * The plan quota `pick` draws on, which a lineup picks once: falling back
 * within one plan gets no further. An agent's models share its plan, except
 * Antigravity's, whose Gemini models and Claude and GPT models are separate.
 */
export function planOf(pick: AgentPick): string {
	if (pick.agent !== "antigravity") {
		return pick.agent;
	}
	// Antigravity's own model, with none named, is a Gemini one.
	const gemini = pick.model === undefined || pick.model.startsWith("gemini");
	return `antigravity:${gemini ? "gemini" : "claude-gpt"}`;
}

const PICK = z.object({
	agent: z.string().min(1),
	model: z.string().min(1).optional(),
	effort: z.string().min(1).optional(),
});

const LINEUP = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1, "a lineup has a name"),
	color: z.enum(LINEUP_COLORS),
	picks: z
		.array(PICK)
		.min(1, "a lineup picks at least one agent")
		.superRefine((picks, ctx) => {
			const at = picks.findIndex(
				(pick, index) =>
					picks.findIndex((each) => planOf(each) === planOf(pick)) !== index,
			);
			if (at >= 0) {
				ctx.addIssue({
					code: "custom",
					path: [at],
					message:
						"a lineup allows only one pick per agent plan; choose a different agent for the fallback",
				});
			}
		}),
});

const ROW = z.object(
	Object.fromEntries(ROUTE_DEPTHS.map((depth) => [depth, z.string().min(1)])),
);

/** What `auto-pick.json` holds: every kind and depth routed to a lineup it lists. */
export const AUTOPICK_RULES = z
	.object({
		format: z.literal(RULES_FORMAT),
		threshold: z.number().min(0).max(1),
		lineups: z.array(LINEUP).min(1, "the rules list at least one lineup"),
		routes: z.object(
			Object.fromEntries(ROUTE_KINDS.map((kind) => [kind, ROW])),
		),
		pace: z
			.object({
				on: z.boolean(),
				slack: z.number().min(0).max(1),
				spent: z.number().min(0).max(1),
			})
			.optional(),
		holdout: z
			.object({ on: z.boolean(), share: z.number().min(0).max(1) })
			.optional(),
	})
	.superRefine((value, ctx) => {
		const ids = value.lineups.map((each) => each.id);
		const names = value.lineups.map((each) => each.name.trim().toLowerCase());
		for (const [at, lineup] of value.lineups.entries()) {
			if (ids.indexOf(lineup.id) !== at) {
				ctx.addIssue({
					code: "custom",
					path: ["lineups", at, "id"],
					message: `two lineups have the id '${lineup.id}'`,
				});
			}
			if (names.indexOf(lineup.name.trim().toLowerCase()) !== at) {
				ctx.addIssue({
					code: "custom",
					path: ["lineups", at, "name"],
					message: `two lineups are named '${lineup.name}'`,
				});
			}
		}
		for (const kind of ROUTE_KINDS) {
			for (const depth of ROUTE_DEPTHS) {
				const id = (value.routes as Routes)[kind][depth];
				if (!ids.includes(id)) {
					ctx.addIssue({
						code: "custom",
						path: ["routes", kind, depth],
						message: `no lineup has the id '${id}'`,
					});
				}
			}
		}
	});
