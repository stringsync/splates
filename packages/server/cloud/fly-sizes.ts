import type { FlySize } from "./fly-types";

/** Base-region USD list prices from https://fly.io/pricing/ (October 2026); extra RAM is $6/GB per 730 hours. */
export const FLY_SIZES: readonly FlySize[] = presets();

// scry-ignore classes-over-functions: A private table expansion, with no dependencies or behavior to inject.
function presets(): FlySize[] {
	const sizes: FlySize[] = [];
	for (const [kind, presets] of [
		[
			"shared",
			[
				[1, 0.25, 0.003],
				[2, 0.5, 0.0061],
				[4, 1, 0.0122],
				[6, 1.5, 0.0183],
				[8, 2, 0.0244],
			],
		],
		[
			"performance",
			[
				[1, 2, 0.0458],
				[2, 4, 0.0917],
				[4, 8, 0.1833],
				[6, 12, 0.275],
				[8, 16, 0.3667],
				[10, 20, 0.4584],
				[12, 24, 0.55],
				[14, 28, 0.6417],
				[16, 32, 0.7334],
			],
		],
	] as const) {
		for (const [cpus, baseMemory, price] of presets) {
			const preset = `${kind === "shared" ? "shared-cpu" : "performance"}-${cpus}x`;
			// Fly allows up to 2GB per shared vCPU, 8GB per performance vCPU.
			const max = cpus * (kind === "shared" ? 2 : 8);
			const memories = new Set([
				baseMemory,
				baseMemory * 2,
				baseMemory * 4,
				...(baseMemory * 8 <= max ? [baseMemory * 8] : []),
				...[0.5, 1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128].filter(
					(memory) => memory >= baseMemory && memory <= max,
				),
			]);
			for (const memory of memories) {
				sizes.push({
					name: `${preset}-${memory}gb`,
					preset,
					cpus,
					memory,
					cpuKind: kind,
					dollarsPerHour: price + ((memory - baseMemory) * 6) / 730,
					billing: "second",
				});
			}
		}
	}
	return sizes;
}
