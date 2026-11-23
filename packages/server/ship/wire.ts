import { z } from "zod";

/** A bump a target takes. */
export const BUMP = z.enum(["patch", "minor", "major"]);
export type Bump = z.infer<typeof BUMP>;

/** An exact artifact version, as core's ship takes one: nonempty, untrimmed. */
export const VERSION = z
	.string()
	.min(1)
	.refine(
		(each) => each === each.trim(),
		"A version has no surrounding spaces",
	);

/** A target picked to ship, as the plan and start routes take it. */
export const PICK = z.object({
	name: z.string().min(1),
	bump: BUMP.optional(),
	version: VERSION.optional(),
	/** Set to ship at the version the followed dependency releases, no bump or version. */
	follow: z.literal(true).optional(),
});

/** A step as a ship command's `plan` prints it. */
const STEP = z.object({
	id: z.string().min(1),
	does: z.string(),
	dependencies: z.array(z.string()).optional(),
});
export type PlannedStep = z.infer<typeof STEP>;

/** One target's plan as a ship command's `plan` prints it. */
export const PLAN = z.object({
	name: z.string().min(1),
	/** Set when the target takes an artifact version, chosen or bumped to. */
	versioned: z.boolean().optional(),
	/** The version it resolved, from the version or bump it was planned with. */
	version: z.string().optional(),
	bump: BUMP.optional(),
	/** The dependency whose release it takes by default, offered as "Follow <it>". */
	follows: z.string().optional(),
	dependencies: z.array(z.string()),
	steps: z.array(STEP),
});
export type Plan = z.infer<typeof PLAN>;

/** What `plan` prints: one plan, or an array when the command serves several. */
export const PLANS = z.union([PLAN.transform((plan) => [plan]), z.array(PLAN)]);
