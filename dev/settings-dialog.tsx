import { useReactive } from "@webappwiz/react";
import { CheckIcon, SearchIcon } from "lucide-react";
import { type JSX, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { Switch } from "#dev/components/ui/switch.tsx";
import { cn } from "#dev/lib/utils.ts";
import { Refusal, useRefusal } from "./refusal";
import {
	CATEGORIES,
	type Category,
	type Choice,
	definitionOf,
	type Key,
	type Settings,
	search,
} from "./settings";

/**
 * The page's settings, the way an IDE lays out its options: categories down
 * the left, each one's settings on the right, and a search over all of them
 * that keeps only the settings, and the categories, it matches.
 */
export function SettingsDialog({
	settings,
	open,
	onOpenChange,
}: {
	settings: Settings;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element {
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<Category>(CATEGORIES[0]);
	const found = search(query);
	const shown = CATEGORIES.map((category) => ({
		category,
		keys: found.filter((key) => definitionOf(key).category === category),
	})).filter(({ keys }) => keys.length > 0);

	return (
		<Dialog
			open={open}
			onOpenChange={(open) => {
				onOpenChange(open);
				if (!open) {
					setQuery("");
				}
			}}
		>
			<DialogContent className="flex h-[min(36rem,85dvh)] flex-col gap-0 p-0 sm:max-w-3xl">
				<div className="flex items-center gap-4 border-b py-3 pr-12 pl-4">
					<DialogTitle className="shrink-0">Settings</DialogTitle>
					<div className="relative flex-1">
						<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							type="search"
							aria-label="Search settings"
							placeholder="Search settings"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							className="pl-8"
						/>
					</div>
				</div>
				<div className="flex min-h-0 flex-1">
					<nav
						aria-label="setting categories"
						className="hidden w-48 shrink-0 flex-col gap-0.5 border-r p-2 sm:flex"
					>
						{shown.map(({ category, keys }) => (
							<button
								key={category}
								type="button"
								aria-current={category === picked ? "true" : undefined}
								onClick={() => {
									setPicked(category);
									document
										.getElementById(sectionId(category))
										?.scrollIntoView({ block: "start" });
								}}
								className={cn(
									"flex items-center rounded-md px-3 py-1.5 text-left hover:bg-muted",
									category === picked &&
										"bg-accent font-medium hover:bg-accent",
								)}
							>
								<span className="flex-1">{category}</span>
								{query !== "" && (
									<span className="text-muted-foreground text-xs tabular-nums">
										{keys.length}
									</span>
								)}
							</button>
						))}
					</nav>
					<div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
						{shown.length === 0 ? (
							<p className="py-8 text-center text-muted-foreground">
								No settings match “{query}”
							</p>
						) : (
							shown.map(({ category, keys }) => (
								<section
									key={category}
									id={sectionId(category)}
									aria-label={category}
									className="mb-6"
								>
									<h3 className="mb-2 font-medium text-base">{category}</h3>
									<ul className="flex flex-col divide-y">
										{keys.map((key) => (
											<SettingRow
												key={key}
												settings={settings}
												name={key}
												query={query}
											/>
										))}
									</ul>
								</section>
							))
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function sectionId(category: Category): string {
	return `settings-${category.toLowerCase().replaceAll(/\W+/g, "-")}`;
}

/**
 * One setting: its title and what it does, with what the search matched
 * marked, and a switch, a number field, or its choices. One under a switch that is off is
 * greyed out, and so is one this browser cannot do.
 */
function SettingRow({
	settings,
	name,
	query,
}: {
	settings: Settings;
	name: Key;
	query: string;
}): JSX.Element {
	const definition = definitionOf(name);
	const { value, enabled } = useReactive(
		settings,
		(settings) => ({
			value: settings.get(name),
			enabled: under(settings, name),
		}),
		["changed"],
	);
	const supported = definition.browser?.supported() ?? true;
	const disabled = !enabled || !supported;
	const id = `setting-${name}`;
	const depth = depthOf(name);
	const { refusal, refuse } = useRefusal();

	return (
		<li
			className={cn("flex items-start gap-6 py-3", disabled && "opacity-60")}
			style={{ paddingLeft: `${depth * 1.25}rem` }}
		>
			<div className="min-w-0 flex-1">
				<label htmlFor={id} className="font-medium">
					<Marked text={definition.title} query={query} />
				</label>
				<p className="mt-0.5 text-muted-foreground text-xs">
					<Marked text={definition.description} query={query} />
					{!supported && " This browser cannot do it."}
				</p>
				<Refusal refusal={refusal} className="mt-1" />
			</div>
			{typeof value === "string" ? (
				<Choices
					id={id}
					label={definition.title}
					choices={definition.choices ?? []}
					swatches={definition.swatches ?? false}
					value={value}
					disabled={disabled}
					onChange={(next) => void settings.set(name, next)}
				/>
			) : typeof value === "boolean" ? (
				<Switch
					id={id}
					checked={value}
					disabled={disabled}
					onCheckedChange={async (checked) => {
						if (!(await settings.set(name, checked))) {
							refuse("Not switched", definition.browser?.refused ?? "refused");
						}
					}}
					className="mt-0.5"
				/>
			) : (
				<NumberField
					id={id}
					value={value}
					min={definition.min ?? 0}
					unit={definition.unit}
					disabled={disabled}
					onChange={(next) => void settings.set(name, next)}
				/>
			)}
		</li>
	);
}

/** Whether every switch `name` sits under is on. */
function under(settings: Settings, name: Key): boolean {
	const parent = definitionOf(name).under as Key | undefined;
	return parent === undefined
		? true
		: settings.get(parent) === true && under(settings, parent);
}

function depthOf(name: Key): number {
	const parent = definitionOf(name).under as Key | undefined;
	return parent === undefined ? 0 : 1 + depthOf(parent);
}

/**
 * A number, kept as typed while it is not one the setting takes, and set
 * once it is.
 */
function NumberField({
	id,
	value,
	min,
	unit,
	disabled,
	onChange,
}: {
	id: string;
	value: number;
	min: number;
	unit: string | undefined;
	disabled: boolean;
	onChange: (value: number) => void;
}): JSX.Element {
	const [typed, setTyped] = useState(String(value));
	return (
		<span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
			<Input
				id={id}
				type="number"
				inputMode="numeric"
				min={min}
				value={typed}
				disabled={disabled}
				aria-invalid={Number(typed) < min || typed === "" ? true : undefined}
				onChange={(event) => {
					setTyped(event.target.value);
					const next = Number(event.target.value);
					if (
						event.target.value !== "" &&
						Number.isFinite(next) &&
						next >= min
					) {
						onChange(next);
					}
				}}
				// Left on one it cannot take, it goes back to what is set.
				onBlur={() => setTyped(String(value))}
				className="w-20 text-right tabular-nums"
			/>
			{unit}
		</span>
	);
}

/**
 * A choice's values side by side as radios, the one set filled: a segmented
 * control of their labels, or for an accent, a swatch of each.
 */
function Choices({
	id,
	label,
	choices,
	swatches,
	value,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	choices: readonly Choice[];
	swatches: boolean;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}): JSX.Element {
	return (
		<fieldset
			id={id}
			aria-label={label}
			disabled={disabled}
			className={cn(
				"flex shrink-0",
				swatches ? "gap-1.5" : "rounded-md bg-muted p-0.5",
			)}
		>
			{choices.map((choice) => {
				const checked = choice.value === value;
				return (
					<label
						key={choice.value}
						title={swatches ? choice.label : undefined}
						data-accent={swatches ? choice.value : undefined}
						className={cn(
							"cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring",
							swatches
								? "flex size-6 items-center justify-center rounded-full bg-brand text-brand-foreground ring-offset-2 ring-offset-background"
								: "rounded-[calc(var(--radius)-4px)] px-3 py-1 text-muted-foreground text-xs hover:text-foreground",
							swatches && checked && "ring-2 ring-brand",
							!swatches && checked && "bg-card text-foreground shadow-sm",
						)}
					>
						<input
							type="radio"
							name={id}
							value={choice.value}
							checked={checked}
							aria-label={swatches ? choice.label : undefined}
							onChange={() => onChange(choice.value)}
							className="sr-only"
						/>
						{swatches
							? checked && <CheckIcon className="size-3.5" />
							: choice.label}
					</label>
				);
			})}
		</fieldset>
	);
}

/** `text`, with each word of `query` it holds marked. */
function Marked({ text, query }: { text: string; query: string }): JSX.Element {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => word.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	if (words.length === 0) {
		return <>{text}</>;
	}
	// Each piece keyed by where it starts in `text`.
	const pieces: JSX.Element[] = [];
	let from = 0;
	for (const found of text.matchAll(new RegExp(words.join("|"), "gi"))) {
		pieces.push(
			<span key={`text ${from}`}>{text.slice(from, found.index)}</span>,
			<mark
				key={`mark ${found.index}`}
				className="rounded-sm bg-yellow-200/70 text-inherit dark:bg-yellow-500/30"
			>
				{found[0]}
			</mark>,
		);
		from = found.index + found[0].length;
	}
	pieces.push(<span key={`text ${from}`}>{text.slice(from)}</span>);
	return <>{pieces}</>;
}
