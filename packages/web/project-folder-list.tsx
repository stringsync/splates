import type { Needing } from "@stringsync/splates-server/plans";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";
import { RowIcon } from "./agent-icons";
import { Lanes, reportedAs, unnamed, useNameOf } from "./conversation-names";
import { Rows } from "./list-rows";
import { Mark } from "./mark";
import { ProjectEmpty, RemoveProjectButton } from "./project-controls";
import { type Folder, folderKey } from "./project-folders";
import { TaskIcon } from "./task-icon";

/** Draws a row of `folder`'s. */
export type RenderRow = (
	folder: Folder,
	row: Needing,
	nested: boolean,
) => ReactNode;

/**
 * The sidebar's agents, a folder per project by name, the page's own
 * marked: each with those waiting on you on top, then its pinned agents,
 * then those at work, then the rest, every one of them. A
 * folder's header counts what waits on you there, folds it away as this
 * browser keeps it, and its "+" starts a conversation in it. Quiet: a name,
 * a count and its rows.
 */
export function ProjectList({
	folders,
	folded,
	onFold,
	render,
	beneath,
	onNew,
}: {
	folders: Folder[];
	folded: ReadonlySet<string>;
	onFold: (key: string, open: boolean) => void;
	render: RenderRow;
	beneath: (folder: Folder, row: Needing) => ReactNode[];
	/** Starts a conversation in `folder`'s project, showing it. */
	onNew: (folder: Folder) => void;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-3">
			{folders.map((folder) => {
				const key = folderKey(folder);
				return (
					<Collapsible
						key={key}
						open={!folded.has(key)}
						onOpenChange={(open) => onFold(key, open)}
						render={<section aria-label={folder.name} />}
						className="group/folder flex flex-col"
					>
						<div className="group/head relative flex items-center">
							<CollapsibleTrigger
								className={cn(
									HEADING,
									"flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md py-0.5 pl-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
									folder.here && "text-foreground",
								)}
							>
								<ChevronRightIcon
									aria-hidden
									className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[open]/folder:rotate-90"
								/>
								<span className="min-w-0 truncate">{folder.name}</span>
							</CollapsibleTrigger>
							{folder.here && <ShownBar />}
							<button
								type="button"
								aria-label={`New conversation in ${folder.name}`}
								title={`New conversation in ${folder.name}`}
								onClick={() => onNew(folder)}
								className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/head:opacity-100 pointer-coarse:opacity-100"
							>
								<PlusIcon className="size-3.5" />
							</button>
							<RemoveProjectButton folder={folder} />
						</div>
						<CollapsibleContent>
							{folder.trees.length === 0 && <ProjectEmpty />}
							{folder.listed.length > 0 && (
								<InLanes folder={folder}>
									<Rows
										label={`${folder.name} conversations`}
										rows={folder.listed}
										render={(row, nested) => render(folder, row, nested)}
										beneath={(row) => beneath(folder, row)}
									/>
								</InLanes>
							)}
						</CollapsibleContent>
					</Collapsible>
				);
			})}
		</div>
	);
}

/** Marks the folder of the project the page shows, which keeps its place by name. */
export function ShownDot(): JSX.Element {
	return (
		<span
			role="img"
			aria-label="shown"
			title="The project shown"
			className="size-1.5 shrink-0 rounded-full bg-primary"
		/>
	);
}

/** Marks the folder of the project the page shows with a bar beside its name only, not the rows under it. */
function ShownBar(): JSX.Element {
	return (
		<span
			role="img"
			aria-label="shown"
			title="The project shown"
			className="absolute inset-y-0.5 left-0 w-0.5 rounded-full bg-primary"
		/>
	);
}

/** A folder's title, as quiet as the rows under it. */
const HEADING =
	"px-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide";

/**
 * A row of another project's, which this page holds no actions for: its
 * mark and its name, opening its project's page at it.
 */
export function ForeignItem({
	row,
	agent,
	hint,
	nested,
	onOpen,
}: {
	row: Needing;
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
