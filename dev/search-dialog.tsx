import {
	GitBranchIcon,
	ListTodoIcon,
	type LucideIcon,
	MessageSquareIcon,
} from "lucide-react";
import {
	type JSX,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { useShortcut } from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";
import { type Found, type Kind, type Searched, search } from "./search";

const HEADINGS: Record<Kind, string> = {
	task: "Tasks",
	conversation: "Conversations",
	todo: "Todos",
};

const ICONS: Record<Kind, LucideIcon> = {
	task: GitBranchIcon,
	conversation: MessageSquareIcon,
	todo: ListTodoIcon,
};

/**
 * Its shortcut, ⌘K (Ctrl+K) unless set otherwise: one box over the shown project's tasks, conversations and
 * todos, grouped by kind, the best match first (see `search`). The arrows and
 * Enter pick.
 */
export function SearchDialog({
	searched,
	pick,
}: {
	searched: Searched;
	/** Opens what was found. */
	pick: (found: Found) => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const opened = useRef(open);
	opened.current = open;
	// Fresh as it opens, and left as it was while it fades out.
	const show = useCallback((next: boolean) => {
		if (next) {
			setQuery("");
			setActive(0);
		}
		setOpen(next);
	}, []);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const list = useRef<HTMLUListElement>(null);
	useShortcut("shortcuts.search", () => show(!opened.current));

	const { tasks, todos, conversations, lanes } = searched;
	// Kept while it closes too, so the list does not empty as it fades.
	const groups = useMemo(
		() => search(query, { tasks, todos, conversations, lanes }),
		[query, tasks, todos, conversations, lanes],
	);
	const rows = groups.flatMap((group) => group.found);
	const shown = Math.min(active, rows.length - 1);
	useEffect(() => {
		list.current
			?.querySelector(`[data-row="${shown}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [shown]);
	const choose = (found: Found | undefined) => {
		if (found === undefined) {
			return;
		}
		setOpen(false);
		pick(found);
	};

	let at = 0;
	return (
		<Dialog open={open} onOpenChange={show}>
			<DialogContent
				showCloseButton={false}
				className="top-[15%] translate-y-0 gap-2 p-2 sm:max-w-xl"
			>
				<DialogTitle className="sr-only">Search</DialogTitle>
				<Input
					autoFocus
					aria-label="search"
					placeholder="Search tasks, conversations, todos"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setActive(Math.min(shown + 1, rows.length - 1));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setActive(Math.max(shown - 1, 0));
						} else if (event.key === "Enter") {
							event.preventDefault();
							choose(rows[shown]);
						}
					}}
				/>
				<ul
					ref={list}
					aria-label="results"
					className="flex max-h-[60dvh] flex-col overflow-y-auto"
				>
					{groups.length === 0 && (
						<li className="px-2 py-1.5 text-muted-foreground text-sm">
							Nothing matches
						</li>
					)}
					{groups.map((group) => (
						<li key={group.kind} className="flex flex-col">
							<span className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs">
								{HEADINGS[group.kind]}
							</span>
							<ul className="flex flex-col">
								{group.found.map((found) => {
									const row = at++;
									const Icon = ICONS[found.kind];
									return (
										<li key={found.key}>
											<button
												type="button"
												data-row={row}
												onMouseMove={() => setActive(row)}
												onClick={() => choose(found)}
												className={cn(
													"flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
													row === shown && "bg-muted",
												)}
											>
												<Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
												<span className="flex min-w-0 flex-1 flex-col">
													<span className="truncate">{found.title}</span>
													{found.detail !== null && (
														<span className="truncate text-muted-foreground text-xs">
															{found.detail}
														</span>
													)}
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						</li>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	);
}
