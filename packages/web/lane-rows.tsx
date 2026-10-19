import type { Needing } from "@stringsync/splates-server/plans/browser";
import { type JSX, type ReactNode, use } from "react";
import { Lanes } from "./conversation-names";
import { keyOfRow } from "./conversation-rows";
import type { LaneGroup } from "./lane-groups";
import { RowItem, Rows } from "./list-rows";

/**
 * The sidebar's rows as `Rows` lists them, but for those at work on one
 * lane's tasks, which sit together under the lane's title. The title opens
 * the lane on the board.
 */
export function LaneRows({
	label,
	groups,
	render,
	beneath,
	onLane,
}: {
	label: string;
	groups: LaneGroup[];
	render: (row: Needing, nested: boolean) => ReactNode;
	beneath?: (row: Needing) => ReactNode[];
	onLane: (lane: number) => void;
}): JSX.Element {
	const lanes = use(Lanes);
	return (
		<ul aria-label={label} className="flex flex-col">
			{groups.map(({ lane, trees }) => {
				if (lane === null) {
					return trees.map((tree) => (
						<RowItem
							key={keyOfRow(tree.row)}
							tree={tree}
							render={render}
							beneath={beneath}
						/>
					));
				}
				const name =
					lanes.find((each) => each.id === lane)?.name ?? `Lane ${lane}`;
				return (
					<li
						key={`lane:${lane}`}
						className="my-1.5 ml-1 border-primary/50 border-l first:mt-0"
					>
						<button
							type="button"
							onClick={() => onLane(lane)}
							title={`Open ${name} on the board`}
							className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 px-2.5 pt-0.5 pb-0.5 text-left font-medium text-foreground/80 text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
						>
							<span className="min-w-0 truncate">{name}</span>
						</button>
						<Rows
							label={`${name} lane`}
							rows={trees}
							render={render}
							beneath={beneath}
						/>
					</li>
				);
			})}
		</ul>
	);
}
