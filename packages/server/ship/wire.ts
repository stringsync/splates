import { z } from "zod";

/** A bump a target takes. */
export const BUMP = z.enum(["patch", "minor", "major"]);
export type Bump = z.infer<typeof BUMP>;

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
	bump: BUMP.optional(),
	dependencies: z.array(z.string()),
	/** Commits waiting to ship, when the target counts them. */
	unshipped: z.number().int().nonnegative().optional(),
	steps: z.array(STEP),
});
export type Plan = z.infer<typeof PLAN>;

/** What `plan` prints: one plan, or an array when the command serves several. */
export const PLANS = z.union([PLAN.transform((plan) => [plan]), z.array(PLAN)]);
