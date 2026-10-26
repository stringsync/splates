import type { Needing } from "@stringsync/splates-server/plans";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";
import { RowIcon } from "./agent-icons";
import { Lanes, reportedAs, unnamed, useNameOf } from "./conversation-names";
import { keyOfRow } from "./conversation-rows";
import { RowItem, Rows } from "./list-rows";
import { Mark } from "./mark";
import { ProjectEmpty, RemoveProjectButton } from "./project-controls";
import { type Folder, type Folders, folderKey } from "./project-folders";
import { TaskIcon } from "./task-icon";

/** Draws a row of `folder`'s. */
export type RenderRow = (
	folder: Folder,
	row: Needing,
	nested: boolean,
) => ReactNode;

/**
 * The sidebar's agents, one project at a time: those waiting on you in every
 * project under Needs you, then the page's own project's, pinned, at work,
 * then the rest, its "+" starting a conversation in it, then every other
 * project with agents as one line, saying how many are at work, that
 * switches the page to it. Quiet: a name and its rows.
 */
export function ProjectList({
	folders,
	render,
	beneath,
	onNew,
	onSwitch,
}: {
	folders: Folders;
	render: RenderRow;
	beneath: (folder: Folder, row: Needing) => ReactNode[];
	onNew: () => void;
	/** Shows `folder`'s project's page. */
	onSwitch: (folder: Folder) => void;
}): JSX.Element {
	const { needsYou, here, others } = folders;
	return (
		<div className="flex flex-col gap-3">
			{needsYou.length > 0 && (
				<section aria-label="Needs you" className="flex flex-col">
					<h2 className={cn(HEADING, "text-warning")}>Needs you</h2>
					<ul aria-label="Needs you conversations" className="flex flex-col">
						{needsYou.map(({ folder, tree }) => (
							<InLanes
								key={`${folderKey(folder)} ${keyOfRow(tree.row)}`}
								folder={folder}
							>
								<RowItem
									tree={tree}
									render={(row, nested) => render(folder, row, nested)}
									beneath={(row) => beneath(folder, row)}
								/>
							</InLanes>
						))}
					</ul>
				</section>
			)}
			<section aria-label={here.name} className="group/head flex flex-col">
				<div className="flex items-center">
					<h2 className={cn(HEADING, "min-w-0 flex-1 truncate")}>
						{here.name}
					</h2>
					<button
						type="button"
						aria-label={`New conversation in ${here.name}`}
						title={`New conversation in ${here.name}`}
						onClick={onNew}
						className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/head:opacity-100 pointer-coarse:opacity-100"
					>
						<PlusIcon className="size-3.5" />
					</button>
					<RemoveProjectButton folder={here} />
				</div>
				{/* Its agents may all be in Needs you, which says so above. */}
				{here.trees.length === 0 && <ProjectEmpty />}
				{here.listed.length > 0 && (
					<InLanes folder={here}>
						<Rows
							label={`${here.name} conversations`}
							rows={here.listed}
							render={(row, nested) => render(here, row, nested)}
							beneath={(row) => beneath(here, row)}
						/>
					</InLanes>
				)}
			</section>
			{others.length > 0 && (
				<section aria-label="Other projects" className="flex flex-col">
					<h2 className={HEADING}>Other projects</h2>
					<ul aria-label="Other projects" className="flex flex-col">
						{others.map((folder) => (
							<li
								key={folderKey(folder)}
								className="group/head flex items-center"
							>
								<button
									type="button"
									data-row
									onClick={() => onSwitch(folder)}
									title={`Switch to ${folder.name}`}
									className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05] active:bg-foreground/[0.08]"
								>
									<span className="min-w-0 flex-1 truncate text-sm">
										{folder.name}
									</span>
									{folder.waiting.length > 0 && (
										<TriangleAlertIcon
											role="img"
											aria-label="waiting on you"
											className="size-3 shrink-0 text-warning"
										/>
									)}
									{folder.atWork > 0 && (
										<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
											{folder.atWork} at work
										</span>
									)}
								</button>
								<RemoveProjectButton folder={folder} />
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

/** A section's title, as quiet as the rows under it. */
const HEADING =
	"px-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide";

/**
 * A row of another project's, which this page holds no actions for: its
 * mark, its name and its project's, opening its project's page at it.
 */
export function ForeignItem({
	row,
	project,
	agent,
	hint,
	nested,
	onOpen,
}: {
	row: Needing;
	/** Its project's name. */
	project: string;
	/** Its agent's name; null for an external one. */
	agent: string | null;
	hint: string | null;
	nested: boolean;
	onOpen: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	const { conversation, task, need } = row;
	const name =
		conversation !== null ? nameOf(conversation) : (task?.task ?? "");
	return (
		<button
			type="button"
			data-row
			onClick={onOpen}
			title={conversation?.task ?? undefined}
			className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05] active:bg-foreground/[0.08]"
		>
			{conversation !== null && agent !== null ? (
				<RowIcon
					conversation={conversation}
					name={agent}
					className="size-3.5 text-foreground/70"
				/>
			) : (
				<TaskIcon className="size-3.5 shrink-0 text-foreground/70" />
			)}
			<span className="flex min-w-0 flex-1 items-center gap-1.5">
				<span
					className={cn(
						"min-w-0 truncate text-sm",
						(nested || (conversation !== null && unnamed(conversation))) &&
							"text-muted-foreground italic",
					)}
				>
					{name}
				</span>
			</span>
			<span className="max-w-20 shrink-0 truncate text-muted-foreground text-xs">
				{project}
			</span>
			{hint !== null ? (
				<Kbd aria-hidden>{hint}</Kbd>
			) : (
				<Mark
					starting={conversation?.status === "starting"}
					picking={conversation?.picking}
					queued={conversation?.queued != null}
					need={need}
					reported={conversation === null ? null : reportedAs(conversation)}
					unread={conversation?.unread ?? false}
					subagent={nested}
				/>
			)}
		</button>
	);
}

/** Names `folder`'s lane orchestrators after its lanes, the page's own as its snapshot does. */
export function InLanes({
	folder,
	children,
}: {
	folder: Folder;
	children: ReactNode;
}): ReactNode {
	return folder.laneNames === null ? (
		children
	) : (
		<Lanes value={folder.laneNames}>{children}</Lanes>
	);
}
