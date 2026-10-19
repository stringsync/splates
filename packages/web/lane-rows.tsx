import type { Needing } from "@stringsync/splates-server/plans/browser";
import { KanbanIcon } from "lucide-react";
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
						className="my-1 rounded-lg bg-foreground/[0.04] pb-0.5 first:mt-0 last:mb-0"
					>
						<button
							type="button"
							onClick={() => onLane(lane)}
							title={`Open ${name} on the board`}
							className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-3 pt-1 pb-0.5 text-left font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
						>
							<KanbanIcon aria-hidden className="size-3 shrink-0" />
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
