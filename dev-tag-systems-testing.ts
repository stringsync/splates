import type { System } from "./systems";

/** Systems as `arbor.systems.ts` might name them, for the tagging tests. */
export const SYSTEMS: Record<string, System> = {
	scry: { globs: ["packages/scry/**"] },
	board: { aliases: ["todos", "lanes"], globs: ["packages/arbor/todo*.ts"] },
	conversations: {
		aliases: ["conversation view"],
		globs: ["packages/arbor/conversations*.ts"],
	},
	checkpoint: { globs: ["packages/arbor/dev/checkpoint.tsx"] },
};
