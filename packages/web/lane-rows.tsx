import type { Needing } from "@stringsync/splates-server/plans/browser";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, type ReactNode, use, useState } from "react";
import { Lanes } from "./conversation-names";
import { keyOfRow } from "./conversation-rows";
import type { LaneGroup } from "./lane-groups";
import { RowItem, Rows } from "./list-rows";

/**
 * The sidebar's rows as `Rows` lists them, but for those at work on one
 * lane's tasks, which sit together under the lane's title. The title opens
 * the lane on the board, and a chevron beside it folds the lane's rows away.
 * Every lane starts open.
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
	const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
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
				const isFolded = folded.has(lane);
				return (
					<li
						key={`lane:${lane}`}
						className="my-1.5 ml-1 border-primary/50 border-l first:mt-0"
					>
						<div className="flex items-center">
							<button
								type="button"
								onClick={() =>
									setFolded((was) => {
										const next = new Set(was);
										if (!next.delete(lane)) {
											next.add(lane);
										}
										return next;
									})
								}
								aria-expanded={!isFolded}
								aria-label={`${isFolded ? "Expand" : "Collapse"} ${name} lane`}
								className="flex shrink-0 cursor-pointer items-center py-0.5 pl-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
							>
								{isFolded ? (
									<ChevronRightIcon className="size-3.5" />
								) : (
									<ChevronDownIcon className="size-3.5" />
								)}
							</button>
							<button
								type="button"
								onClick={() => onLane(lane)}
								title={`Open ${name} on the board`}
								className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-1.5 pt-0.5 pb-0.5 text-left font-medium text-foreground/80 text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
							>
								<span className="min-w-0 truncate">{name}</span>
							</button>
						</div>
						{isFolded ? null : (
							<Rows
								label={`${name} lane`}
								rows={trees}
								render={render}
								beneath={beneath}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}
