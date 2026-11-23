/** How one agent-queued task in a chain stands. */
export type ChainStatus = "running" | "queued" | "merged" | "held" | "removed";

/** One agent-queued task in a chain, with the task whose agent queued it. */
export interface ChainNode {
	id: number;
	title: string;
	status: ChainStatus;
	/** The board task whose agent queued it, or null when the chain's root did. */
	parent: number | null;
	/** The conversation that works or worked it, or null while it waits. */
	conversation: string | null;
	/** Fresh input and output tokens its conversation spent, cache reads left out. */
	tokens: number;
}

/** A chain as its conversations show it: the budget, the tree and Stop auto. */
export interface ChainView {
	/** What the chain is called: its root's task, or its root conversation. */
	name: string;
	root: { conversation: string; title: string };
	spent: number;
	budget: number;
	stopped: boolean;
	nodes: ChainNode[];
}

/** A row of the drawn tree: a task at a depth, or the fold of what lies deeper. */
export type ChainRow =
	| { kind: "task"; node: ChainNode; depth: number }
	| { kind: "more"; count: number; under: number; depth: number };

/** Levels shown below the root before deeper tasks fold. */
export const CHAIN_VISIBLE_DEPTH = 3;

/**
 * The tree's rows in reading order, depth first: tasks down to the third
 * level, and below it each task's remaining descendants as one "N more under
 * #x" row.
 */
export function chainRows(nodes: readonly ChainNode[]): ChainRow[] {
	const known = new Set(nodes.map((node) => node.id));
	const childrenOf = (parent: number | null) =>
		nodes.filter(
			(node) =>
				(node.parent !== null && known.has(node.parent)
					? node.parent
					: null) === parent,
		);
	const count = (id: number): number =>
		childrenOf(id).reduce((sum, child) => sum + 1 + count(child.id), 0);
	const rows: ChainRow[] = [];
	const walk = (parent: number | null, depth: number) => {
		for (const node of childrenOf(parent)) {
			rows.push({ kind: "task", node, depth });
			if (depth < CHAIN_VISIBLE_DEPTH) {
				walk(node.id, depth + 1);
			} else {
				const hidden = count(node.id);
				if (hidden > 0) {
					rows.push({
						kind: "more",
						count: hidden,
						under: node.id,
						depth: depth + 1,
					});
				}
			}
		}
	};
	walk(null, 1);
	return rows;
}

/** How many of the chain's tasks stand in each status. */
export function chainStats(
	nodes: readonly ChainNode[],
): Record<ChainStatus, number> {
	const stats: Record<ChainStatus, number> = {
		running: 0,
		queued: 0,
		merged: 0,
		held: 0,
		removed: 0,
	};
	for (const node of nodes) {
		stats[node.status] += 1;
	}
	return stats;
}

/** Tokens in the compact form the meter uses: 1.8M, 420K. */
export function tokensShort(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
}
