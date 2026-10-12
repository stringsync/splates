import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import { cn } from "#dev/lib/utils.ts";
import { forgetProject, listProjects, type ProjectChoice } from "./api";
import { Refusal, useRefusal } from "./refusal";

/** The project the page shows: `?project=`, or none for the one started in. */
export function shownProject(): string | null {
	return new URLSearchParams(location.search).get("project") || null;
}

/**
 * Where the page goes to show `project`: the same page of it, and none of
 * the last project's conversations, which are its own.
 */
export function projectUrl(project: ProjectChoice): string {
	const url = new URL(location.href);
	if (project.here) {
		url.searchParams.delete("project");
	} else {
		url.searchParams.set("project", project.slug);
	}
	if (url.hash.startsWith("#conversations/")) {
		url.hash = "#conversations";
	}
	return url.toString();
}

/**
 * The project's name, heading the page, as a picker of every project on this
 * machine: ⌘K (Ctrl+K) opens it, typing narrows it, the arrows and Enter pick.
 */
export function ProjectSwitcher({ name }: { name: string }): JSX.Element {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [projects, setProjects] = useState<ProjectChoice[]>([]);
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
	useEffect(() => {
		const toggle = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((was) => !was);
			}
		};
		window.addEventListener("keydown", toggle);
		return () => window.removeEventListener("keydown", toggle);
	}, []);

	const words = query.trim().toLowerCase();
	const matching = projects.filter(
		(each) =>
			words === "" ||
			each.slug.toLowerCase().includes(words) ||
			each.root.toLowerCase().includes(words),
	);
	const current = (each: ProjectChoice) =>
		shown === null ? each.here : each.slug === shown;
	const go = (each: ProjectChoice | undefined) => {
		if (each === undefined || each.gone) {
			return;
		}
		setOpen(false);
		if (!current(each)) {
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
						aria-label="Switch project"
						title="Switch project (⌘K)"
						className="-mx-1.5 flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-left hover:bg-muted"
					/>
				}
			>
				<h1 className="truncate font-medium text-sm">{name}</h1>
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
					{matching.length === 0 && (
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
				<p className="px-2 text-muted-foreground text-xs">
					<Kbd>⌘K</Kbd> opens this anywhere
				</p>
			</PopoverContent>
		</Popover>
	);
}
