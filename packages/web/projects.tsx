import type { ServerChoice } from "@stringsync/splates-server/server";
import { useReactive } from "@webappwiz/react";
import {
	CheckIcon,
	ChevronsUpDownIcon,
	HouseIcon,
	PlusIcon,
	SearchIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, use, useContext, useEffect, useState } from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { useShortcut, useShortcutLabel } from "#web/hooks/use-shortcut.ts";
import { cn } from "#web/lib/utils.ts";
import { AddProject } from "./add-project";
import { Leaving } from "./leaving";
import { NavigationContext } from "./navigation";
import { OpenerContext } from "./openers";
import { usePendingWrites } from "./pending";
import {
	forgetProject,
	type ProjectChoice,
	setProjectColor,
} from "./project-api";
import { ProjectBadge } from "./project-badge";
import { useProjectList } from "./project-list";
import { ProjectMenu } from "./project-menu";
import {
	placeOf,
	previousProject,
	projectUrl,
	rememberPlace,
	shownProject,
} from "./project-places";
import { Refusal, useRefusal } from "./refusal";
import { ShipApproval } from "./ship-approval";
import { ShipDialog } from "./ship-dialog";
import { shortPath } from "./short-path";
import { NAV_HEADING, TITLE } from "./top-bar";

/**
 * The project's name, and under it its path unless `path` is false, heading the page, as a picker of every
 * project on this machine in order of their names, each marked with how many
 * agents wait on you there: its shortcut, ⌥⌘O unless set otherwise, opens
 * it with the project this tab showed before marked, so the shortcut and
 * Enter go back there; typing narrows it, the arrows and Enter pick.
 * Below them, when this machine runs slots, every `splates server` it has a
 * host for, picked to open that one's page instead. Last, a way to add a
 * project by its path. Each project's menu opens it in the editor Settings
 * names, copies its path, ships it from its plan, or forgets it. Under the title of a phone's
 * conversation it is one small muted line, and a pick shows the same page of
 * the other project. Heading the
 * project's pages in a nav, it is as small as the nav's other headings.
 */
export function ProjectSwitcher({
	name,
	keyed = true,
	bar = false,
	heading = false,
	scope = false,
	hash,
	servers: slots = true,
	path = true,
	onPick,
	className,
}: {
	name: string;
	/** Whether its shortcut opens it: false for a second on the page, so one press opens one. */
	keyed?: boolean;
	/** Whether it is a small line under a bar's title, as a phone conversation's. */
	bar?: boolean;
	/** Whether it heads the project's pages in a nav, as small as its other headings. */
	heading?: boolean;
	/** Whether its badge uses the compact size for project scope. */
	scope?: boolean;
	/** Where a pick of another project lands, in place of where this tab last left it. */
	hash?: string;
	/** Whether it lists the slots' servers too, to open another one's page. */
	servers?: boolean;
	/** Whether its trigger shows the project's path under its name. */
	path?: boolean;
	/** Told of a pick of another project just before the page shows it. */
	onPick?: (project: ProjectChoice) => void;
	/** Classes for its trigger, as `flex-1` to take the head's width. */
	className?: string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	// Kept for the page and current already, so opening it asks nothing.
	const list = useProjectList();
	const { projects, servers } = useReactive(
		list,
		(list) => ({ projects: list.projects, servers: list.servers }),
		["changed"],
	);
	const [adding, setAdding] = useState(false);
	// The ship plan open, once picked from a project's menu.
	const [shipping, setShipping] = useState<ShipApproval | null>(null);
	// The server the page is on its way to, once picked: a new page takes
	// seconds to come under load, and the old one must not be used meanwhile.
	// Another project needs none, since it opens on this page.
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
	const _opener = use(OpenerContext);
	const { refusal, refuse: refused } = useRefusal();

	useEffect(
		() =>
			list.events.on("refused", (error) =>
				refused("Projects not listed", error),
			),
		[list, refused],
	);
	// Shown at once from what the page holds; asked again behind it only for
	// what the feed never says, as a project focused from another device.
	useEffect(() => {
		if (open) {
			void list.refresh();
		}
	}, [open, list]);
	useShortcut(
		"shortcuts.projects",
		() => {
			setOpen((was) => !was);
			setQuery("");
			setActive(previous());
		},
		keyed,
	);
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
	const otherServers = slots && servers.length > 1 ? servers : [];
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
	// Where it opens: on the project shown before, to go back with Enter.
	const previous = () => {
		const slug = previousProject();
		const at = matching.findIndex(
			(each) => each.slug === slug && !each.gone && !current(each),
		);
		return at === -1 ? 0 : at;
	};
	// The page focuses what it shows, on any device, however it came to show it.
	const go = (each: ProjectChoice | undefined) => {
		if (each === undefined || each.gone) {
			return;
		}
		setOpen(false);
		if (!current(each)) {
			// So coming back lands here, and the page names `each` while it opens.
			const leaving =
				shown ?? (projects ?? []).find((one) => one.focused)?.slug ?? "";
			rememberPlace(leaving, { hash: location.hash });
			if (placeOf(each.slug).name === undefined) {
				rememberPlace(each.slug, { name: each.slug });
			}
			onPick?.(each);
			const url = new URL(projectUrl(each, { stay: bar }));
			if (hash !== undefined) {
				url.hash = hash;
			}
			navigation.show(url.toString());
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

	const coloring = usePendingWrites();
	const changeColor = (
		each: ProjectChoice,
		color: Parameters<typeof setProjectColor>[1],
	) =>
		coloring
			.run(each.slug, () => setProjectColor(each.slug, color))
			.then(
				() => list.refresh(),
				(error: unknown) => refused(`${each.slug} appearance not saved`, error),
			);
	const forgetting = usePendingWrites();
	const forget = (each: ProjectChoice) =>
		forgetting
			.run(each.slug, () => forgetProject(each.slug))
			.then(
				(next) => {
					if (!current(each)) {
						return list.refresh();
					}
					// The page showed it: on to the one focused before it, or to
					// none left.
					setOpen(false);
					const url = new URL(location.href);
					url.searchParams.delete("project");
					url.hash = "";
					navigation.show(next === null ? url.toString() : projectUrl(next));
				},
				(error: unknown) => refused(`${each.slug} not forgotten`, error),
			);

	const copyPath = (each: ProjectChoice) =>
		navigator.clipboard
			.writeText(each.root)
			.catch((error: unknown) => refused("Path not copied", error));

	return (
		<>
			{leaving !== null && (
				<Leaving name={leaving} onStay={() => setLeaving(null)} />
			)}
			{shipping !== null && (
				<ShipDialog approval={shipping} onClose={() => setShipping(null)} />
			)}
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					setQuery("");
					setActive(previous());
					setAdding(false);
				}}
			>
				<PopoverTrigger
					render={
						<button
							type="button"
							aria-label="Switch project"
							title={`Switch project${shortcut === null ? "" : ` (${shortcut})`}`}
							className={cn(
								"-mx-1.5 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-muted max-md:hover:bg-transparent max-md:active:bg-muted",
								className,
							)}
						/>
					}
				>
					<ProjectBadge
						name={here?.slug ?? shown ?? name}
						color={here?.color}
						small={heading || bar || scope}
					/>
					{heading ? (
						<span className={cn(NAV_HEADING, "px-0")}>{name}</span>
					) : bar ? (
						<span className="truncate text-muted-foreground text-xs">
							{name}
						</span>
					) : (
						<span className="flex min-w-0 flex-col">
							<h1 className={cn(TITLE, "truncate leading-tight")}>{name}</h1>
							{path && here !== undefined && (
								<span className="truncate text-muted-foreground text-xs leading-tight">
									{shortPath(here.root)}
								</span>
							)}
						</span>
					)}
					<span className="ml-auto flex shrink-0 items-center gap-0.5">
						<ChevronsUpDownIcon
							className={cn(
								"size-3.5 text-muted-foreground",
								!bar && "max-md:size-4",
							)}
						/>
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
							{projects === null && (
								<li
									role="status"
									className="px-2 py-1.5 text-muted-foreground text-sm"
								>
									Loading projects…
								</li>
							)}
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
										<ProjectBadge name={each.slug} color={each.color} />
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
												<TriangleAlertIcon
													aria-hidden
													className="size-3 text-warning"
												/>
												{each.waiting}
											</span>
										)}
									</button>
									<ProjectMenu
										project={each}
										current={current(each)}
										colorPending={coloring.pending(each.slug)}
										onColor={(color) => void changeColor(each, color)}
										hidden={!each.gone && at !== active}
										onCopyPath={() => void copyPath(each)}
										onShip={() => {
											setOpen(false);
											setShipping(new ShipApproval(each.slug));
										}}
										pending={forgetting.pending(each.slug)}
										onForget={() => void forget(each)}
									/>
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
