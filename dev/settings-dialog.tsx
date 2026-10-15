import { useReactive } from "@webappwiz/react";
import { CheckIcon, RotateCcwIcon, SearchIcon, XIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { Switch } from "#dev/components/ui/switch.tsx";
import { useTouch } from "#dev/hooks/use-touch.ts";
import { cn } from "#dev/lib/utils.ts";
import { Refusal, useRefusal } from "./refusal";
import {
	CATEGORIES,
	type Category,
	type Choice,
	definitionOf,
	type Key,
	type Settings,
	type ShortcutKey,
	search,
} from "./settings";
import { label, NONE, recorded, type Shortcut, valid } from "./shortcuts";

/**
 * The page's settings, the way an IDE lays out its options: categories down
 * the left (along the top on a phone), the picked one's settings on the right,
 * and a search over all of them that shows every setting it matches, under
 * its category. The category picked outlives the dialog closing.
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
	// A touch device has no keyboard to press them on.
	const touch = useTouch();
	const found = search(query).filter(
		(key) => !(touch && definitionOf(key).shortcut),
	);
	const shown = CATEGORIES.map((category) => ({
		category,
		keys: found.filter((key) => definitionOf(key).category === category),
	})).filter(({ keys }) => keys.length > 0);
	const searching = query !== "";
	const pages = searching
		? shown
		: shown.filter(({ category }) => category === picked);

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
				<div className="flex min-h-0 flex-1 flex-col sm:flex-row">
					<nav
						aria-label="setting categories"
						className="flex shrink-0 gap-0.5 overflow-x-auto border-b p-2 sm:w-48 sm:flex-col sm:overflow-x-visible sm:border-r sm:border-b-0"
					>
						{shown.map(({ category, keys }) => (
							<button
								key={category}
								type="button"
								aria-current={category === picked ? "true" : undefined}
								onClick={() => {
									setPicked(category);
									if (searching) {
										document
											.getElementById(sectionId(category))
											?.scrollIntoView({ block: "start" });
									}
								}}
								className={cn(
									"flex shrink-0 items-center rounded-md px-3 py-1.5 text-left hover:bg-muted",
									category === picked &&
										"bg-accent font-medium hover:bg-accent",
								)}
							>
								<span className="flex-1">{category}</span>
								{searching && (
									<span className="text-muted-foreground text-xs tabular-nums">
										{keys.length}
									</span>
								)}
							</button>
						))}
					</nav>
					<div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
						{pages.length === 0 ? (
							<p className="py-8 text-center text-muted-foreground">
								No settings match “{query}”
							</p>
						) : (
							pages.map(({ category, keys }) => (
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
 * marked, and a switch, a number field, or its choices, which on a phone go
 * under the words. One under a switch that is off is greyed out, and so is one
 * this browser cannot do.
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
	// Too wide to share a phone's width with the words, so it goes under them.
	const wide = definition.shortcut || typeof value === "string";

	return (
		<li
			className={cn(
				"flex items-start gap-6 py-3",
				wide && "max-sm:flex-col max-sm:gap-2",
				disabled && "opacity-60",
			)}
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
			{definition.shortcut ? (
				<ShortcutField
					id={id}
					title={definition.title}
					value={value as Shortcut}
					fallback={definition.default as Shortcut}
					refuse={refuse}
					onBind={(next) => settings.bind(name as ShortcutKey, next)}
				/>
			) : typeof value === "string" ? (
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
					// Off while it cannot take effect, its own value kept for when it can.
					checked={value && !disabled}
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

/**
 * A shortcut as it reads, which records the next one pressed once clicked,
 * Escape or leaving it giving up; and beside it, Reset to put back the one
 * the page starts with, and Unset to have none. A shortcut taken from another
 * says whose it was, under it.
 */
function ShortcutField({
	id,
	title,
	value,
	fallback,
	refuse,
	onBind,
}: {
	id: string;
	title: string;
	value: Shortcut;
	fallback: Shortcut;
	refuse: (title: string, error: unknown) => void;
	onBind: (shortcut: Shortcut) => Promise<ShortcutKey | null>;
}): JSX.Element {
	const [recording, setRecording] = useState(false);
	const [taken, setTaken] = useState<ShortcutKey | null>(null);
	const bind = async (next: Shortcut) => {
		setTaken(await onBind(next));
	};
	return (
		<span className="flex shrink-0 flex-col items-end gap-1 max-sm:items-start">
			<span className="flex items-center gap-1">
				<Button
					id={id}
					variant="outline"
					size="sm"
					aria-pressed={recording}
					aria-label={
						recording
							? `${title}: press a shortcut`
							: `${title}: ${value === NONE ? "none" : label(value)}`
					}
					onClick={() => setRecording(true)}
					onBlur={() => setRecording(false)}
					onKeyDown={(event) => {
						if (!recording) {
							return;
						}
						// Every key is the recording's, none the page's or the dialog's.
						event.preventDefault();
						event.stopPropagation();
						if (event.key === "Escape") {
							setRecording(false);
							return;
						}
						const pressed = recorded(event.nativeEvent);
						if (pressed === null) {
							return;
						}
						if (!valid(pressed)) {
							refuse("Not set", "hold ⌘, ⌃ or ⌥ with a key");
						} else if (/^Alt\+Mod\+Digit\d$/.test(pressed)) {
							refuse("Not set", `${label(pressed)} opens a conversation`);
						} else {
							setRecording(false);
							void bind(pressed);
						}
					}}
					className={cn("w-32 justify-center", recording && "ring-2 ring-ring")}
				>
					{recording ? (
						<span className="text-muted-foreground text-xs">
							Press a shortcut
						</span>
					) : value === NONE ? (
						<span className="text-muted-foreground text-xs">None</span>
					) : (
						<Kbd>{label(value)}</Kbd>
					)}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Reset ${title} to ${label(fallback)}`}
					title={`Reset to ${label(fallback)}`}
					disabled={value === fallback}
					onClick={() => void bind(fallback)}
				>
					<RotateCcwIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Unset ${title}`}
					title="Unset"
					disabled={value === NONE}
					onClick={() => void bind(NONE)}
				>
					<XIcon />
				</Button>
			</span>
			{taken !== null && (
				<span className="text-muted-foreground text-xs">
					Was {definitionOf(taken).title}'s
				</span>
			)}
		</span>
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
