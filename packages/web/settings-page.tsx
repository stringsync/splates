import {
	BellIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	Code2Icon,
	HomeIcon,
	KeyboardIcon,
	type LucideIcon,
	MessageSquareIcon,
	PlayIcon,
	RefreshCwIcon,
	SearchIcon,
	SparklesIcon,
	SunIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Card } from "#web/components/ui/card.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { useTouch } from "#web/hooks/use-touch.ts";
import { cn } from "#web/lib/utils.ts";
import { AgentSettings, matchesAgentSettings } from "./agent-settings";
import { CannedEditor, matchesCanned } from "./canned-editor";
import {
	CATEGORIES,
	type Category,
	definitionOf,
	type Key,
	type Settings,
	search,
} from "./settings";
import { SettingsGroup, ThemeCardPicker } from "./settings-rows";

const CATEGORY_GROUPS: readonly {
	label: string;
	showLabel: boolean;
	categories: readonly Category[];
}[] = [
	{
		label: "General",
		showLabel: false,
		categories: ["Appearance", "Startup", "Editor", "Notifications"],
	},
	{
		label: "Workspace",
		showLabel: true,
		categories: ["Agents", "Updates", "Shortcuts", "Canned replies"],
	},
];

const CATEGORY_ICON: Record<Category, LucideIcon> = {
	Appearance: SunIcon,
	Startup: PlayIcon,
	Editor: Code2Icon,
	Notifications: BellIcon,
	Agents: SparklesIcon,
	Updates: RefreshCwIcon,
	Shortcuts: KeyboardIcon,
	"Canned replies": MessageSquareIcon,
};

/**
 * Full-page Settings: on desktop, swaps the main sidebar for a dedicated
 * `< Back` sidebar beside a centered content column; on phones, starts on a
 * grouped category index and drills into each section with `< Settings` back
 * navigation.
 */
export function SettingsPage({
	settings,
	wide,
	picked,
	onPick,
	onClose,
	onWelcome,
	project,
}: {
	settings: Settings;
	wide: boolean;
	/** The category currently shown on desktop, kept across visits. */
	picked: Category;
	onPick: (category: Category) => void;
	/** Returns to the page or conversation Settings was opened from. */
	onClose: () => void;
	/** Opens the Welcome page, leaving Settings. */
	onWelcome: () => void;
	/** The active project's display name, shown in server-saved sections. */
	project?: string;
}): JSX.Element {
	const [query, setQuery] = useState("");
	// On phones, null shows the grouped category index; a category drills into it.
	const [phoneSection, setPhoneSection] = useState<Category | null>(null);
	// A touch device has no keyboard to press shortcuts on.
	const touch = useTouch();
	const found = search(query).filter(
		(key) => !(touch && definitionOf(key).shortcut),
	);
	const shown = CATEGORIES.map((category) => ({
		category,
		keys: found.filter((key) => definitionOf(key).category === category),
	})).filter(
		({ category, keys }) =>
			keys.length > 0 ||
			matchesCanned(category, query) ||
			matchesAgentSettings(category, query),
	);
	const shownMap = new Map(shown.map((entry) => [entry.category, entry]));
	const searching = query !== "";

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			if (!wide && phoneSection !== null && !searching) {
				setPhoneSection(null);
			} else {
				onClose();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [wide, phoneSection, searching, onClose]);

	const activeCategory = wide ? picked : phoneSection;
	const pages = searching
		? shown
		: activeCategory === null
			? []
			: shown.filter(({ category }) => category === activeCategory);

	if (!wide) {
		return (
			<section
				aria-label="Settings"
				className="flex min-h-dvh flex-col bg-background"
			>
				{phoneSection !== null && !searching ? (
					<>
						<header className="sticky top-0 z-30 flex h-(--top-bar-height) items-center border-b bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
							<button
								type="button"
								onClick={() => setPhoneSection(null)}
								className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground"
							>
								<ChevronLeftIcon className="size-4" aria-hidden="true" />
								<span>Settings</span>
							</button>
						</header>
						<main className="mx-auto w-full max-w-[640px] flex-1 px-4 pt-5 pb-10">
							{pages.map(({ category, keys }) => (
								<CategoryContent
									key={category}
									category={category}
									keys={keys}
									settings={settings}
									query={query}
									project={project}
								/>
							))}
						</main>
					</>
				) : (
					<>
						<header className="sticky top-0 z-30 flex h-(--top-bar-height) items-center border-b bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
							<button
								type="button"
								onClick={onClose}
								className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground"
							>
								<ChevronLeftIcon className="size-4" aria-hidden="true" />
								<span>Back</span>
							</button>
						</header>
						<main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 pt-5 pb-10">
							<h1 className="font-semibold text-2xl tracking-tight">
								Settings
							</h1>
							<SettingsSearch query={query} onChange={setQuery} />
							{searching ? (
								<SearchResults
									pages={pages}
									query={query}
									settings={settings}
									project={project}
								/>
							) : (
								<nav
									aria-label="setting categories"
									className="flex flex-col gap-5"
								>
									{CATEGORY_GROUPS.map((group) => {
										const visible = group.categories.filter((cat) =>
											shownMap.has(cat),
										);
										if (visible.length === 0) {
											return null;
										}
										return (
											<div key={group.label} className="flex flex-col gap-2">
												<div className="px-1 font-medium text-muted-foreground text-xs">
													{group.label}
												</div>
												<Card className="rounded-2xl">
													<div className="divide-y">
														{visible.map((category) => {
															const Icon = CATEGORY_ICON[category];
															return (
																<button
																	key={category}
																	type="button"
																	onClick={() => {
																		onPick(category);
																		setPhoneSection(category);
																	}}
																	className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors hover:bg-muted/50"
																>
																	<Icon
																		className="size-4 shrink-0 text-muted-foreground"
																		aria-hidden="true"
																	/>
																	<span className="flex-1 font-medium">
																		{category}
																	</span>
																	<ChevronRightIcon
																		className="size-4 shrink-0 text-muted-foreground/70"
																		aria-hidden="true"
																	/>
																</button>
															);
														})}
													</div>
												</Card>
											</div>
										);
									})}
									<Card className="rounded-2xl">
										<button
											type="button"
											onClick={() => {
												onClose();
												onWelcome();
											}}
											className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors hover:bg-muted/50"
										>
											<HomeIcon
												className="size-4 shrink-0 text-muted-foreground"
												aria-hidden="true"
											/>
											<span className="flex-1 font-medium">Welcome page</span>
											<ChevronRightIcon
												className="size-4 shrink-0 text-muted-foreground/70"
												aria-hidden="true"
											/>
										</button>
									</Card>
								</nav>
							)}
						</main>
					</>
				)}
			</section>
		);
	}

	return (
		<section
			aria-label="Settings"
			className="flex h-dvh w-full overflow-hidden bg-sidebar p-2 pl-60"
		>
			<aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-sidebar px-3 py-3">
				<button
					type="button"
					onClick={onClose}
					className="flex items-center gap-1.5 self-start rounded-lg px-2.5 py-2 text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground"
				>
					<ChevronLeftIcon className="size-4" aria-hidden="true" />
					<span>Back</span>
				</button>
				<div className="mt-2 mb-3">
					<SettingsSearch query={query} onChange={setQuery} />
				</div>
				<nav
					aria-label="setting categories"
					className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4"
				>
					{CATEGORY_GROUPS.map((group) => {
						const visible = group.categories
							.map((cat) => shownMap.get(cat))
							.filter((entry) => entry !== undefined);
						if (visible.length === 0) {
							return null;
						}
						return (
							<div key={group.label} className="flex flex-col gap-1">
								{group.showLabel && (
									<div className="px-2.5 pb-1 font-medium text-muted-foreground text-xs">
										{group.label}
									</div>
								)}
								{visible.map(({ category, keys }) => {
									const Icon = CATEGORY_ICON[category];
									const active = category === picked;
									return (
										<button
											key={category}
											type="button"
											aria-current={active ? "true" : undefined}
											onClick={() => {
												onPick(category);
												if (searching) {
													document
														.getElementById(sectionId(category))
														?.scrollIntoView({ block: "start" });
												}
											}}
											className={cn(
												"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
												active
													? "bg-accent font-medium text-foreground"
													: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
											)}
										>
											<Icon className="size-4 shrink-0" aria-hidden="true" />
											<span className="flex-1 truncate">{category}</span>
											{searching && (
												<span className="text-muted-foreground text-xs tabular-nums">
													{keys.length}
												</span>
											)}
										</button>
									);
								})}
							</div>
						);
					})}
				</nav>
				<div className="border-t pt-2">
					<button
						type="button"
						onClick={() => {
							onClose();
							onWelcome();
						}}
						className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground"
					>
						<HomeIcon className="size-4 shrink-0" aria-hidden="true" />
						<span>Welcome page</span>
					</button>
				</div>
			</aside>
			<main className="min-w-0 flex-1 overflow-y-auto rounded-[14px] border border-foreground/[0.07] bg-background">
				<div className="mx-auto w-full max-w-[640px] px-8 py-10">
					{searching ? (
						<SearchResults
							pages={pages}
							query={query}
							settings={settings}
							project={project}
						/>
					) : (
						pages.map(({ category, keys }) => (
							<CategoryContent
								key={category}
								category={category}
								keys={keys}
								settings={settings}
								query={query}
								project={project}
							/>
						))
					)}
				</div>
			</main>
		</section>
	);
}

function SettingsSearch({
	query,
	onChange,
}: {
	query: string;
	onChange: (value: string) => void;
}): JSX.Element {
	return (
		<div className="relative">
			<SearchIcon
				className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				type="search"
				aria-label="Search settings"
				placeholder="Search settings"
				value={query}
				onChange={(event) => onChange(event.target.value)}
				className="pl-8"
			/>
		</div>
	);
}

function SearchResults({
	pages,
	query,
	settings,
	project,
}: {
	pages: readonly { category: Category; keys: Key[] }[];
	query: string;
	settings: Settings;
	project?: string;
}): JSX.Element {
	if (pages.length === 0) {
		return (
			<p className="py-12 text-center text-muted-foreground text-sm">
				No settings match “{query}”
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-8">
			{pages.map(({ category, keys }) => (
				<CategoryContent
					key={category}
					category={category}
					keys={keys}
					settings={settings}
					query={query}
					project={project}
				/>
			))}
		</div>
	);
}

function CategoryContent({
	category,
	keys,
	settings,
	query,
	project,
}: {
	category: Category;
	keys: readonly Key[];
	settings: Settings;
	query: string;
	project?: string;
}): JSX.Element {
	const hasTheme = keys.includes("appearance.theme");
	const otherKeys = hasTheme
		? keys.filter((key) => key !== "appearance.theme")
		: keys;

	return (
		<div id={sectionId(category)} className="flex flex-col gap-6">
			<h1 className="font-semibold text-2xl tracking-tight">{category}</h1>
			{category === "Canned replies" ? (
				<CannedEditor />
			) : category === "Agents" ? (
				<AgentSettings project={project} />
			) : (
				<div className="flex flex-col gap-6">
					{hasTheme && <ThemeCardPicker settings={settings} query={query} />}
					{otherKeys.length > 0 && (
						<SettingsGroup
							heading={
								category === "Appearance" ? "Conversation layout" : undefined
							}
							settings={settings}
							keys={otherKeys}
							query={query}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function sectionId(category: Category): string {
	return `settings-${category.toLowerCase().replaceAll(/\W+/g, "-")}`;
}
