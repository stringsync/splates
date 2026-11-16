// Ship targets that send nothing out, for the user to hand test the ship
// engine and the Ships page against: `splates dev placeholder-ship` serves
// them, and mono's `splates.config.ts` lists that command under `ships`.
// They go with the legacy ships once real targets cover what they show.
import { type Bump, placeholder, step, type Target, target } from "core/ship";

/**
 * The placeholder targets to hand to `serve`: a quick one, a slow one with
 * steps side by side, one that fails until you
 * `touch /tmp/splates-placeholder-ship-fixed`, one that asks every kind of
 * prompt, one that depends on the quick one, and one that prints a lot.
 */
export function placeholderShips(): Target[] {
	return [quick(), slow(), failing(), prompting(), dependent(), noisy()];
}

// The failing ship removes it as it ends, so the next try fails again.
const FIXED_MARKER = "/tmp/splates-placeholder-ship-fixed";
const QUICK = "placeholder-quick";
const VERSIONS: Record<Bump, string> = {
	patch: "0.0.1",
	minor: "0.1.0",
	major: "1.0.0",
};

function quick(): Target {
	return target({
		name: QUICK,
		bump: "patch",
		plan: ({ bump = "patch" }) => [
			...placeholder.wait({ id: "wait", seconds: 2 }),
			// A made-up version for the bump, so the dependent has one to read.
			step({
				id: "release",
				does: `Pretend to release ${VERSIONS[bump]}`,
				dependencies: ["wait"],
				run: async (ctx) => {
					ctx.released(VERSIONS[bump]);
					ctx.update(`Released ${VERSIONS[bump]}, nowhere`);
				},
			}),
		],
	});
}

function slow(): Target {
	return target({
		name: "placeholder-slow",
		plan: () => [
			...placeholder.wait({ id: "warm-up", seconds: 5 }),
			...placeholder.wait({
				id: "parallel",
				seconds: 20,
				branches: 3,
				dependencies: ["warm-up"],
			}),
			...placeholder.wait({
				id: "wind-down",
				seconds: 5,
				dependencies: ["parallel"],
			}),
		],
	});
}

function failing(): Target {
	return target({
		name: "placeholder-failing",
		plan: () => [
			...placeholder.wait({ id: "wait", seconds: 2 }),
			...placeholder.failUntil({
				id: "fix-me",
				marker: FIXED_MARKER,
				dependencies: ["wait"],
			}),
			...placeholder.wait({
				id: "after",
				seconds: 2,
				dependencies: ["fix-me"],
			}),
			step({
				id: "unfix",
				does: `Remove ${FIXED_MARKER}, so the next try fails again`,
				dependencies: ["after"],
				run: async (ctx) => {
					await ctx.sh(`rm -f '${FIXED_MARKER}'`);
				},
			}),
		],
	});
}

function prompting(): Target {
	return target({
		name: "placeholder-prompts",
		plan: () => [
			...placeholder.prompts({ id: "prompts" }),
			...placeholder.wait({
				id: "after",
				seconds: 2,
				dependencies: ["prompts"],
			}),
		],
	});
}

function noisy(): Target {
	return target({
		name: "placeholder-noisy",
		plan: () => [
			step({
				id: "print",
				does: "Print a few hundred lines, a few a second",
				run: async (ctx) => {
					await ctx.sh(
						'for i in $(seq 1 300); do echo "line $i: the quick brown fox jumps over the lazy dog"; if [ $((i % 5)) -eq 0 ]; then sleep 0.2; fi; done',
					);
				},
			}),
		],
	});
}

function dependent(): Target {
	return target({
		name: "placeholder-dependent",
		dependencies: [QUICK],
		plan: ({ upstream }) => [
			step({
				id: "read-upstream",
				does: `Read ${QUICK} at ${upstream(QUICK).version}`,
				run: async (ctx) => {
					ctx.update(`Got ${QUICK} ${upstream(QUICK).version}`);
				},
			}),
			...placeholder.wait({
				id: "wait",
				seconds: 3,
				dependencies: ["read-upstream"],
			}),
		],
	});
}
