import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * Projects drawn as a dependency tree, each beneath the first of its
 * dependencies among `items`, as the ship plan and the Ship page show them.
 */
export function ShipTree<T>({
	items,
	slugOf,
	dependenciesOf,
	render,
	label,
	className,
}: {
	items: T[];
	slugOf: (item: T) => string;
	/** The slugs `item` depends on, in the order it pins them. */
	dependenciesOf: (item: T) => string[];
	render: (item: T) => ReactNode;
	label: string;
	className?: string;
}): JSX.Element {
	const nodes = new Map<string, TreeNode<T>>(
		items.map((item) => [slugOf(item), { item, children: [] }]),
	);
	const roots: TreeNode<T>[] = [];
	for (const node of nodes.values()) {
		const parent = dependenciesOf(node.item)
			.map((slug) => nodes.get(slug))
			.find((each) => each !== undefined && each !== node);
		(parent?.children ?? roots).push(node);
	}
	return (
		<ol aria-label={label} className={cn("flex flex-col gap-2", className)}>
			{roots.map((node) => (
				<Branch
					key={slugOf(node.item)}
					node={node}
					slugOf={slugOf}
					render={render}
					nested={false}
				/>
			))}
		</ol>
	);
}

interface TreeNode<T> {
	item: T;
	children: TreeNode<T>[];
}

function Branch<T>({
	node,
	slugOf,
	render,
	nested,
}: {
	node: TreeNode<T>;
	slugOf: (item: T) => string;
	render: (item: T) => ReactNode;
	nested: boolean;
}): JSX.Element {
	const slug = slugOf(node.item);
	return (
		<li
			aria-label={slug}
			className={cn(
				"relative flex flex-col gap-2",
				nested &&
					"before:absolute before:-left-4 before:top-6 before:h-px before:w-4 before:bg-border",
			)}
		>
			{render(node.item)}
			{node.children.length > 0 && (
				<ol
					aria-label={`${slug} dependents`}
					className="ml-4 flex flex-col gap-2 border-l pl-4"
				>
					{node.children.map((child) => (
						<Branch
							key={slugOf(child.item)}
							node={child}
							slugOf={slugOf}
							render={render}
							nested
						/>
					))}
				</ol>
			)}
		</li>
	);
}
