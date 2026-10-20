import { z } from "zod";
import type { AgentPick } from "../models";
import { DEPTH_IDS, type DepthId, KIND_IDS, type KindId } from "./classes";
import { ANY, DEFAULT_PACE, RULES_FORMAT, ruleLabel } from "./rule-names";

export { ANY, DEFAULT_PACE, RULES_FORMAT, ruleLabel };

// Browser-safe: the page edits the rules, so this file brings in no agent
// processes and no `bun:` modules, and takes only types from `../models`.

/**
 * The person's mapping from a task's classification to an agent, a model and
 * a thinking level, one per machine, kept in `~/.splates/auto-pick.json`.
 */
export interface AutoPickRules {
	/** The file's own format. */
	format: 2;
	/**
	 * How sure the judge has to be, 0 to 1, before its likeliest kind or
	 * depth counts; below it, the task is that dimension's `*` alone.
	 */
	threshold: number;
	/** Tried in order: the first that matches the task decides. The last is `* *`. */
	rules: Rule[];
	/** When a pick's plan counts as used too fast; left out, `DEFAULT_PACE`. */
	pace?: Pace;
}

/** One line of the mapping: what it matches, and whom it picks. */
export interface Rule {
	/** The kind of work it matches, or `*` for any, a task of no sure kind too. */
	kind: KindId | "*";
	/** The depth it matches, or `*` for any, a task of no sure depth too. */
	depth: DepthId | "*";
	/**
	 * Whom it picks, the first first: a pick whose agent's plan is nearly
	 * used up is passed over for the next. A pick with no model takes the
	 * agent's default model, one with no effort its default thinking level.
	 */
	picks: AgentPick[];
}

/** Rules that check out, or the first problem with them, in a line the page can show. */
export type CheckedRules =
	| { ok: true; rules: AutoPickRules }
	| { ok: false; problem: string };

/** Checks `value` as a mapping, for the page's editor and the file alike. */
export function checkRules(value: unknown): CheckedRules {
	const parsed = AUTO_PICK_RULES.safeParse(migrateRules(value));
	if (parsed.success) {
		return { ok: true, rules: parsed.data as AutoPickRules };
	}
	const issue = parsed.error.issues[0];
	return {
		ok: false,
		problem: `${issue?.path.join(".") || "the rules"}: ${issue?.message}`,
	};
}

/**
 * When a pick is passed over for the next on its rule because of its agent's
 * plan, each share 0 to 1 of a plan window.
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

const PICK = z.object({
	agent: z.string().min(1),
	model: z.string().min(1).optional(),
	effort: z.string().min(1).optional(),
});

const RULE = z.object({
	kind: z.enum([ANY, ...KIND_IDS]),
	depth: z.enum([ANY, ...DEPTH_IDS]),
	picks: z
		.array(PICK)
		.min(1, "a rule picks at least one agent")
		.superRefine((picks, ctx) => {
			const at = picks.findIndex(
				(pick, index) =>
					picks.findIndex(
						(each) => each.agent === pick.agent && each.model === pick.model,
					) !== index,
			);
			if (at >= 0) {
				ctx.addIssue({
					code: "custom",
					path: [at],
					message: "a rule names the same agent and model once",
				});
			}
		}),
});

/** What `auto-pick.json` holds, its last rule `* *`. */
export const AUTO_PICK_RULES = z
	.object({
		format: z.literal(RULES_FORMAT),
		threshold: z.number().min(0).max(1),
		rules: z.array(RULE).min(1, "the rules list at least one rule"),
		pace: z
			.object({
				on: z.boolean(),
				slack: z.number().min(0).max(1),
				spent: z.number().min(0).max(1),
			})
			.optional(),
	})
	.superRefine((value, ctx) => {
		const last = value.rules.at(-1);
		if (last !== undefined && (last.kind !== ANY || last.depth !== ANY)) {
			ctx.addIssue({
				code: "custom",
				path: ["rules", value.rules.length - 1],
				message:
					"the last rule must be kind * and depth *, so every task maps to a pick",
			});
		}
	});

/** Carry format 1 mappings forward in order, preserving their picks and pace. */
function migrateRules(value: unknown): unknown {
	if (
		value === null ||
		typeof value !== "object" ||
		!("format" in value) ||
		value.format !== 1 ||
		!("rules" in value) ||
		!Array.isArray(value.rules)
	) {
		return value;
	}
	const depths: Record<string, string> = {
		easy: "shallow",
		medium: "moderate",
		hard: "deep",
		"*": "*",
	};
	return {
		...value,
		format: 2,
		rules: value.rules.map((rule: unknown) => {
			if (rule === null || typeof rule !== "object") {
				return rule;
			}
			const { difficulty, ...rest } = rule as Record<string, unknown>;
			return {
				...rest,
				kind:
					rest.kind === "lookup" || rest.kind === "mechanical"
						? "*"
						: rest.kind,
				depth:
					rest.depth ??
					(typeof difficulty === "string"
						? difficulty === "*" && rest.kind === "lookup"
							? "shallow"
							: difficulty === "*" && rest.kind === "mechanical"
								? "moderate"
								: (depths[difficulty] ?? difficulty)
						: difficulty),
			};
		}),
	};
}
