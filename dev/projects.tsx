import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import { useShortcut, useShortcutLabel } from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";
import { forgetProject, listProjects, type ProjectChoice } from "./api";
import { Dot } from "./dot";
import { Refusal, useRefusal } from "./refusal";

/** The project the page shows: `?project=`, or none for the one started in. */
export function shownProject(): string | null {
	return new URLSearchParams(location.search).get("project") || null;
}

/**
 * How often the projects are asked again, while the tab shows, for the
 * switcher to say when another one has agents waiting on you.
 */
const LISTED = Duration.secs(15);

/** Where this tab last was in each project, by slug, "" for the one started in. */
const PLACES = "arbor.places";

/** A project as this tab last showed it: its name, and the address's hash. */
interface Place {
	name?: string;
	hash?: string;
}

function places(): Record<string, Place> {
	try {
		const read: unknown = JSON.parse(sessionStorage.getItem(PLACES) ?? "{}");
		return typeof read === "object" && read !== null
			? (read as Record<string, Place>)
			: {};
	} catch {
		return {};
	}
}

/** Where `project`, a slug or "" for the one started in, was last left. */
export function placeOf(project: string): Place {
	return places()[project] ?? {};
}

/** Keeps `place` for `project`, over what was kept for it before. */
export function rememberPlace(project: string, place: Place): void {
	const all = places();
	all[project] = { ...all[project], ...place };
	sessionStorage.setItem(PLACES, JSON.stringify(all));
}

function keyOf(project: ProjectChoice): string {
	return project.here ? "" : project.slug;
}

/**
 * Where the page goes to show `project`: where this tab last left it, else
 * the same page of it, and none of the last project's conversations, which
 * are its own.
 */
export function projectUrl(project: ProjectChoice): string {
	const url = new URL(location.href);
	if (project.here) {
		url.searchParams.delete("project");
	} else {
		url.searchParams.set("project", project.slug);
	}
	const { hash } = placeOf(keyOf(project));
	if (hash !== undefined) {
		url.hash = hash;
	} else if (url.hash.startsWith("#conversations/")) {
		url.hash = "#conversations";
	}
	return url.toString();
}

/**
 * The project's name, heading the page, as a picker of every project on this
 * machine, each marked with how many agents wait on you there: its
 * shortcut, ⌃⌘P unless set otherwise, which no browser takes, opens it, typing narrows it, the arrows and Enter pick. Closed, it is marked
 * while another project has agents waiting on you.
 */
export function ProjectSwitcher({ name }: { name: string }): JSX.Element {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	// Null until first listed, so it never says none match before it knows.
	const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
	const shown = shownProject();
	const { refusal, refuse: refused } = useRefusal();

	const load = useCallback(
		() =>
			listProjects().then(
				(listed) => setProjects(listed.projects),
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
				(listed) => setProjects(listed.projects),
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
	useShortcut("shortcuts.projects", () => setOpen((was) => !was));
	const shortcut = useShortcutLabel("shortcuts.projects");

	const words = query.trim().toLowerCase();
	const matching = (projects ?? []).filter(
		(each) =>
			words === "" ||
			each.slug.toLowerCase().includes(words) ||
			each.root.toLowerCase().includes(words),
	);
	const current = (each: ProjectChoice) =>
		shown === null ? each.here : each.slug === shown;
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
		if (!current(each)) {
			// So coming back lands here, and the page names `each` while it opens.
			rememberPlace(shown ?? "", { hash: location.hash });
			if (placeOf(keyOf(each)).name === undefined) {
				rememberPlace(keyOf(each), { name: each.slug });
			}
			location.assign(projectUrl(each));
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				setQuery("");
				setActive(0);
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
						className="-mx-1.5 flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-left hover:bg-muted"
					/>
				}
			>
				<h1 className="truncate font-medium text-sm">{name}</h1>
				{elsewhere.length > 0 && <Dot aria-hidden color="bg-warning" />}
				<ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-2 p-2">
				<Input
					autoFocus
					aria-label="find a project"
					placeholder="Find a project"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setActive((at) => Math.min(at + 1, matching.length - 1));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setActive((at) => Math.max(at - 1, 0));
						} else if (event.key === "Enter") {
							event.preventDefault();
							go(matching[active]);
						}
					}}
				/>
				<ul className="flex max-h-72 flex-col overflow-y-auto">
					{projects !== null && matching.length === 0 && (
						<li className="px-2 py-1.5 text-muted-foreground text-sm">
							No project matches
						</li>
					)}
					{matching.map((each, at) => (
						<li key={each.slug} className="group/project flex items-center">
							<button
								type="button"
								disabled={each.gone}
								title={each.gone ? `${each.root} is gone` : each.root}
								onMouseEnter={() => setActive(at)}
								onClick={() => go(each)}
								className={cn(
									"flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm disabled:cursor-default disabled:opacity-50",
									at === active && !each.gone && "bg-muted",
								)}
							>
								<CheckIcon
									className={cn(
										"size-3.5 shrink-0",
										!current(each) && "invisible",
									)}
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className={cn("truncate", each.gone && "line-through")}>
										{each.slug}
									</span>
									<span className="truncate text-muted-foreground text-xs">
										{each.root}
									</span>
								</span>
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
							{!each.here && !current(each) && (
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label={`Forget ${each.slug}`}
									title={
										each.gone
											? "Forget it: its repository is gone"
											: "Forget it: `arbor init` there brings it back"
									}
									className={cn(
										!each.gone &&
											at !== active &&
											"opacity-0 focus-visible:opacity-100 group-hover/project:opacity-100",
									)}
									onClick={() =>
										forgetProject(each.slug).then(load, (error: unknown) =>
											refused(`${each.slug} not forgotten`, error),
										)
									}
								>
									<XIcon />
								</Button>
							)}
						</li>
					))}
				</ul>
				<Refusal refusal={refusal} className="px-2" />
				{shortcut !== null && (
					<p className="px-2 text-muted-foreground text-xs">
						<Kbd>{shortcut}</Kbd> opens this anywhere
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}
