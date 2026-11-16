/**
 * Groups `nodes` (targets or steps) into waves to run one after another,
 * each wave's nodes together. A dependency outside `nodes` is not waited
 * on. Throws on a cycle, naming it with `what` ("step", "target").
 */
export function waves(
	nodes: readonly { id: string; dependencies?: readonly string[] }[],
	what: string,
): string[][] {
	const ids = new Set(nodes.map((node) => node.id));
	const left = new Map(
		nodes.map((node) => [
			node.id,
			(node.dependencies ?? []).filter((each) => ids.has(each)),
		]),
	);
	const ran = new Set<string>();
	const out: string[][] = [];
	while (left.size > 0) {
		const wave = [...left]
			.filter(([, dependencies]) => dependencies.every((each) => ran.has(each)))
			.map(([id]) => id);
		if (wave.length === 0) {
			throw new Error(
				`The ${what}s depend on each other in a cycle: ${cycleIn(left).join(" -> ")}`,
			);
		}
		for (const id of wave) {
			left.delete(id);
			ran.add(id);
		}
		out.push(wave);
	}
	return out;
}

/** One cycle among `left`, every node of which waits on another of them. */
function cycleIn(left: Map<string, string[]>): string[] {
	const path: string[] = [];
	let at = left.keys().next().value as string;
	while (!path.includes(at)) {
		path.push(at);
		at = (left.get(at) ?? []).find((each) => left.has(each)) as string;
	}
	return [...path.slice(path.indexOf(at)), at].map((each) => `"${each}"`);
}
