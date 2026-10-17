import {
	CheckIcon,
	ChevronsUpDownIcon,
	CopyIcon,
	EllipsisIcon,
	ExternalLinkIcon,
	HouseIcon,
	PlusIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";
import {
	type JSX,
	use,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { useShortcut, useShortcutLabel } from "#web/hooks/use-shortcut.ts";
import { cn } from "#web/lib/utils.ts";
import type { ServerChoice } from "../dev-servers";
import { AddProject } from "./add-project";
import { Dot } from "./dot";
import { Leaving } from "./leaving";
import { NavigationContext } from "./navigation";
import { OpenerContext } from "./openers";
import {
	focusProject,
	forgetProject,
	listProjects,
	type ProjectChoice,
} from "./project-api";
import {
	placeOf,
	projectUrl,
	rememberPlace,
	shownProject,
} from "./project-places";
import { Refusal, useRefusal } from "./refusal";
import { shortPath } from "./short-path";
import { TITLE } from "./top-bar";

/**
 * How often the projects are asked again, while the tab shows, for the
 * switcher to say when another one has agents waiting on you.
 */
const LISTED = Duration.secs(15);

/**
 * The project's name and path, heading the page, as a picker of every
 * project on this machine in order of their names, each marked with how many
 * agents wait on you there: its shortcut, ⌃⌘P unless set otherwise, which no
 * browser takes, opens it, typing narrows it, the arrows and Enter pick.
 * Closed, it is marked while another project has agents waiting on you.
 * Below them, when this machine runs slots, every `splates server` it has a
 * host for, picked to open that one's page instead. Last, a way to add a
 * project by its path. Each project's menu opens it in the editor Settings
 * names, copies its path, or forgets it. In a page's bar it is one muted
 * line after the title, and a pick shows the same page of the other project.
 */
export function ProjectSwitcher({
	name,
	keyed = true,
	bar = false,
	className,
}: {
	name: string;
	/** Whether its shortcut opens it: false for a second on the page, so one press opens one. */
	keyed?: boolean;
	/** Whether it follows a page's title, picking which project the page shows. */
	bar?: boolean;
	/** Classes for its trigger, as `flex-1` to take the head's width. */
	className?: string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	// Null until first listed, so it never says none match before it knows.
	const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
	const [servers, setServers] = useState<ServerChoice[]>([]);
	const [adding, setAdding] = useState(false);
	// What the page is on its way to, once picked: a new page takes seconds
	// to come under load, and the old one must not be used meanwhile.
	const [leaving, setLeaving] = useState<string | null>(null);
	useEffect(() => {
		// Back to this page from the browser's cache, it is in use again.
		const back = (event: PageTransitionEvent) => {
			if (event.persisted) {
				setLeaving(null);
			}
		};
		addEventListener("pageshow", back);
		return () => removeEventListener("pageshow", back);
	}, []);
	const shown = shownProject();
	const navigation = useContext(NavigationContext);
	const opener = use(OpenerContext);
	const { refusal, refuse: refused } = useRefusal();

	const load = useCallback(
		() =>
			listProjects().then(
				(listed) => {
					setProjects(listed.projects);
					setServers(listed.servers);
				},
				(error: unknown) => refused("Projects not listed", error),
			),
		[refused],
	);
	useEffect(() => {
		if (open) {
			void load();
		}
	}, [open, load]);
	// Only the mark on the trigger hangs on these: one that fails says nothing,
	// and the next tries again.
	useEffect(() => {
		const list = () =>
			listProjects().then(
				(listed) => {
					setProjects(listed.projects);
					setServers(listed.servers);
				},
				() => {},
			);
		void list();
		const tick = new SystemTimer().setInterval(() => {
			if (!document.hidden) {
				void list();
			}
		}, LISTED);
		return () => tick.dispose();
	}, []);
	useShortcut("shortcuts.projects", () => setOpen((was) => !was), keyed);
	const shortcut = useShortcutLabel("shortcuts.projects");

	const words = query.trim().toLowerCase();
	const matching = (projects ?? [])
		.filter(
			(each) =>
				words === "" ||
				each.slug.toLowerCase().includes(words) ||
				each.root.toLowerCase().includes(words),
		)
		.sort((one, other) => one.slug.localeCompare(other.slug));
	// Only worth listing when there is another to go to.
	const otherServers = servers.length > 1 ? servers : [];
	const matchingServers = otherServers.filter(
		(each) =>
			words === "" ||
			serverName(each).toLowerCase().includes(words) ||
			(each.tree ?? "").toLowerCase().includes(words),
	);
	const picks = matching.length + matchingServers.length;
	const current = (each: ProjectChoice) =>
		shown === null ? each.focused : each.slug === shown;
	const here = (projects ?? []).find(current);
	// This one's own are on the page already.
	const elsewhere = (projects ?? []).filter(
		(each) => each.waiting > 0 && !current(each),
	);
	const waitingElsewhere = elsewhere
		.map((each) => `${each.waiting} waiting on you in ${each.slug}`)
		.join(", ");
	const go = (each: ProjectChoice | undefined) => {
		if (each === undefined || each.gone) {
			return;
		}
		setOpen(false);
		// What an address naming none shows next, on any device; going there
		// waits on it no more than on a refusal.
		void focusProject(each.slug).catch(() => {});
		if (!current(each)) {
			// So coming back lands here, and the page names `each` while it opens.
			const leaving =
				shown ?? (projects ?? []).find((one) => one.focused)?.slug ?? "";
			rememberPlace(leaving, { hash: location.hash });
			if (placeOf(each.slug).name === undefined) {
				rememberPlace(each.slug, { name: each.slug });
			}
			setLeaving(each.slug);
			navigation.go(projectUrl(each, { stay: bar }));
		}
	};

	const goServer = (each: ServerChoice | undefined) => {
		if (each === undefined) {
			return;
		}
		setOpen(false);
		if (!each.here) {
			setLeaving(serverName(each));
			navigation.go(each.url);
		}
	};

	const forget = (each: ProjectChoice) =>
		forgetProject(each.slug).then(
			(next) => {
				if (!current(each)) {
					return load();
				}
				// The page showed it: on to the one focused before it, or to
				// none left.
				setOpen(false);
				const url = new URL(location.href);
				url.searchParams.delete("project");
				url.hash = "";
				if (next !== null) {
					setLeaving(next.slug);
				}
				navigation.go(next === null ? url.toString() : projectUrl(next));
			},
			(error: unknown) => refused(`${each.slug} not forgotten`, error),
		);

	const copyPath = (each: ProjectChoice) =>
		navigator.clipboard
			.writeText(each.root)
			.catch((error: unknown) => refused("Path not copied", error));

	return (
		<>
			{leaving !== null && <Leaving name={leaving} />}
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					setQuery("");
					setActive(0);
					setAdding(false);
				}}
			>
				<PopoverTrigger
					render={
						<button
							type="button"
							aria-label={
								elsewhere.length > 0
									? `Switch project: ${waitingElsewhere}`
									: "Switch project"
							}
							title={`Switch project${shortcut === null ? "" : ` (${shortcut})`}${
								elsewhere.length > 0 ? `: ${waitingElsewhere}` : ""
							}`}
							className={cn(
								"-mx-1.5 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-muted max-md:hover:bg-transparent max-md:active:bg-muted",
								className,
							)}
						/>
					}
				>
					{bar ? (
						<span className="truncate text-muted-foreground text-sm max-md:text-base">
							{name}
						</span>
					) : (
						<span className="flex min-w-0 flex-col">
							<h1 className={cn(TITLE, "truncate leading-tight")}>{name}</h1>
							{here !== undefined && (
								<span className="truncate text-muted-foreground text-xs leading-tight">
									{shortPath(here.root)}
								</span>
							)}
						</span>
					)}
					<span className="ml-auto flex shrink-0 items-center gap-0.5">
						{elsewhere.length > 0 && <Dot aria-hidden color="bg-warning" />}
						<ChevronsUpDownIcon className="size-3.5 text-muted-foreground max-md:size-4" />
					</span>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80 gap-0 p-0">
					<div className="flex items-center gap-2 border-b px-3">
						<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
						<input
							aria-label="find a project"
							placeholder="Switch project…"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setActive(0);
							}}
							onKeyDown={(event) => {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									setActive((at) => Math.min(at + 1, picks - 1));
								} else if (event.key === "ArrowUp") {
									event.preventDefault();
									setActive((at) => Math.max(at - 1, 0));
								} else if (event.key === "Enter") {
									event.preventDefault();
									if (active < matching.length) {
										go(matching[active]);
									} else {
										goServer(matchingServers[active - matching.length]);
									}
								}
							}}
							className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
						/>
					</div>
					<div className="flex max-h-80 flex-col overflow-y-auto">
						<ul aria-label="projects" className="flex flex-col p-1.5">
							{projects !== null && matching.length === 0 && (
								<li className="px-2 py-1.5 text-muted-foreground text-sm">
									No project matches
								</li>
							)}
							{matching.map((each, at) => (
								<li
									key={each.slug}
									className={cn(
										"group/project flex items-center rounded-lg pr-1.5",
										at === active && !each.gone && "bg-muted",
									)}
								>
									<button
										type="button"
										disabled={each.gone}
										title={each.gone ? `${each.root} is gone` : each.root}
										onMouseEnter={() => setActive(at)}
										onClick={() => go(each)}
										className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-sm disabled:cursor-default disabled:opacity-50"
									>
										<span className="flex min-w-0 flex-1 flex-col">
											<span
												className={cn(
													"truncate font-medium",
													each.gone && "line-through",
												)}
											>
												{each.slug}
											</span>
											<span className="truncate text-muted-foreground text-xs">
												{shortPath(each.root)}
											</span>
										</span>
										{current(each) && (
											<span className="shrink-0 text-muted-foreground text-xs">
												current
											</span>
										)}
										{each.waiting > 0 && (
											<span
												role="status"
												aria-label={`${each.waiting} waiting on you`}
												title={`${each.waiting} waiting on you`}
												className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs tabular-nums"
											>
												<Dot aria-hidden color="bg-warning" />
												{each.waiting}
											</span>
										)}
									</button>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<Button
													size="icon-xs"
													variant="ghost"
													aria-label={`More for ${each.slug}`}
													title="More"
													className={cn(
														!each.gone &&
															at !== active &&
															"opacity-0 focus-visible:opacity-100 group-hover/project:opacity-100 data-popup-open:opacity-100",
													)}
												/>
											}
										>
											<EllipsisIcon />
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start" className="w-48">
											{!each.gone && (
												<DropdownMenuItem
													render={<a href={opener.url(each.root, null)} />}
												>
													<ExternalLinkIcon />
													Open in {opener.label}
												</DropdownMenuItem>
											)}
											<DropdownMenuItem onClick={() => void copyPath(each)}>
												<CopyIcon />
												Copy path
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												variant="destructive"
												title={
													each.gone
														? "Its repository is gone"
														: current(each)
															? "Going back to the project before it: adding it again brings it back"
															: "Adding it again brings it back"
												}
												onClick={() => void forget(each)}
											>
												<XIcon />
												Forget {each.slug}
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</li>
							))}
						</ul>
						{matchingServers.length > 0 && (
							<ul aria-label="slots" className="flex flex-col border-t p-1.5">
								<li
									aria-hidden
									className="px-2 pt-1 pb-0.5 font-medium text-muted-foreground text-xs"
								>
									Slots
								</li>
								{matchingServers.map((each, index) => {
									const at = matching.length + index;
									return (
										<li key={each.url} className="flex items-center">
											<button
												type="button"
												title={each.url}
												onMouseEnter={() => setActive(at)}
												onClick={() => goServer(each)}
												className={cn(
													"flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
													at === active && "bg-muted",
												)}
											>
												{each.slot === null ? (
													<HouseIcon
														aria-hidden
														className="size-4 shrink-0 text-muted-foreground"
													/>
												) : (
													<span
														aria-hidden
														className="flex size-4 shrink-0 items-center justify-center leading-none"
													>
														{each.slot.emoji}
													</span>
												)}
												<span className="flex min-w-0 flex-1 flex-col">
													<span className="truncate font-medium">
														{serverName(each)}
													</span>
													<span className="truncate text-muted-foreground text-xs">
														{each.tree === null
															? new URL(each.url).host
															: shortPath(each.tree)}
													</span>
												</span>
												{each.here && (
													<CheckIcon
														aria-label="this page"
														className="size-3.5 shrink-0 text-muted-foreground"
													/>
												)}
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
					<div className="border-t p-1.5">
						{adding ? (
							<AddProject autoFocus />
						) : (
							<button
								type="button"
								onClick={() => setAdding(true)}
								className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
							>
								<PlusIcon className="size-4 shrink-0" />
								Add a project
							</button>
						)}
					</div>
					<Refusal refusal={refusal} className="px-3 pb-2" />
					<div className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs max-md:hidden">
						<span>
							<Kbd>↑↓</Kbd> move
						</span>
						<span>
							<Kbd>↵</Kbd> open
						</span>
						{shortcut !== null && (
							<span className="ml-auto">
								<Kbd>{shortcut}</Kbd> anywhere
							</span>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}

/** What the switcher calls `server`: its slot's word, or the machine's own. */
function serverName(server: ServerChoice): string {
	return server.slot === null ? "this machine" : server.slot.word;
}
