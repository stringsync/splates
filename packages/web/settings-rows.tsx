import { useReactive } from "core/react";
import { RotateCcwIcon, XIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Card, CardList } from "#web/components/ui/card.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { cn } from "#web/lib/utils.ts";
import { Refusal, useRefusal } from "./refusal";
import {
	type Choice,
	definitionOf,
	type Key,
	type Settings,
	type ShortcutKey,
} from "./settings";
import {
	label,
	modifierNames,
	NONE,
	recorded,
	type Shortcut,
	valid,
} from "./shortcuts";

/**
 * A softly rounded card holding a list of setting rows with hairline dividers,
 * optionally headed by a quiet group label above the card.
 */
export function SettingsGroup({
	heading,
	settings,
	keys,
	query,
}: {
	heading?: string;
	settings: Settings;
	keys: readonly Key[];
	query: string;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			{heading !== undefined && (
				<div className="px-1 text-muted-foreground text-xs font-medium">
					{heading}
				</div>
			)}
			<Card className="rounded-2xl">
				<CardList>
					{keys.map((key) => (
						<SettingRow
							key={key}
							settings={settings}
							name={key}
							query={query}
						/>
					))}
				</CardList>
			</Card>
		</div>
	);
}

/**
 * Visual Light, System, and Dark theme preview cards with an active accent
 * ring. Keeps standard radio group semantics for keyboard and screen readers.
 */
export function ThemeCardPicker({
	settings,
	query,
}: {
	settings: Settings;
	query: string;
}): JSX.Element {
	const definition = definitionOf("appearance.theme");
	const value = useReactive(
		settings,
		(store) => store.get("appearance.theme"),
		["changed"],
	);
	const choices = definition.choices ?? [];

	return (
		<div className="flex flex-col gap-2.5">
			<div className="px-1 text-muted-foreground text-xs font-medium">
				<Marked text={definition.title} query={query} />
			</div>
			<fieldset
				id="setting-appearance.theme"
				aria-label={definition.title}
				className="grid grid-cols-3 gap-3"
			>
				{choices.map((choice) => {
					const checked = choice.value === value;
					return (
						<label
							key={choice.value}
							className={cn(
								"group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card transition-all focus-within:ring-2 focus-within:ring-ring",
								checked
									? "border-primary ring-2 ring-primary/35"
									: "border-border hover:border-foreground/25",
							)}
						>
							<input
								type="radio"
								name="setting-appearance.theme"
								value={choice.value}
								checked={checked}
								onChange={() =>
									void settings.set("appearance.theme", choice.value)
								}
								className="sr-only"
							/>
							<ThemePreview mode={choice.value} />
							<span
								className={cn(
									"flex items-center justify-center border-t border-border/60 py-2 text-xs font-medium transition-colors",
									checked
										? "text-foreground"
										: "text-muted-foreground group-hover:text-foreground",
								)}
							>
								{choice.label}
							</span>
						</label>
					);
				})}
			</fieldset>
		</div>
	);
}

/** Miniature Light, System, or Dark surface preview inside a theme card. */
function ThemePreview({ mode }: { mode: string }): JSX.Element {
	if (mode === "light") {
		return (
			<span
				aria-hidden="true"
				className="flex h-20 w-full items-center justify-center bg-[#f4f4f6] text-[#18181b] sm:h-24"
			>
				<span className="font-semibold text-[11px] tracking-[0.14em]">
					SPLATES
				</span>
			</span>
		);
	}
	if (mode === "dark") {
		return (
			<span
				aria-hidden="true"
				className="flex h-20 w-full items-center justify-center bg-[#141416] text-[#f4f4f5] sm:h-24"
			>
				<span className="font-semibold text-[11px] tracking-[0.14em]">
					SPLATES
				</span>
			</span>
		);
	}
	return (
		<span
			aria-hidden="true"
			className="relative flex h-20 w-full items-center justify-center overflow-hidden sm:h-24"
		>
			<span className="absolute inset-y-0 left-0 w-1/2 bg-[#f4f4f6]" />
			<span className="absolute inset-y-0 right-0 w-1/2 bg-[#141416]" />
			<span className="relative flex items-center justify-center font-semibold text-[11px] tracking-[0.14em]">
				<span className="text-[#52525b]">SPL</span>
				<span className="text-[#a1a1aa]">ATES</span>
			</span>
		</span>
	);
}

/**
 * One setting: its title and what it does, with what the search matched
 * marked, and a switch, a number field, or its choices, which on a phone go
 * under the words. One under a switch that is off is greyed out, and so is one
 * this browser cannot do.
 */
export function SettingRow({
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
				"flex items-start gap-6 px-4 py-3.5 sm:px-5 sm:py-4",
				wide && "max-sm:flex-col max-sm:gap-2.5",
				disabled && "opacity-60",
			)}
			style={
				depth > 0 ? { paddingLeft: `${1.25 + depth * 1.25}rem` } : undefined
			}
		>
			<div className="min-w-0 flex-1">
				<label htmlFor={id} className="font-medium text-sm">
					<Marked text={definition.title} query={query} />
				</label>
				<p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
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
 * control of their labels.
 */
function Choices({
	id,
	label,
	choices,
	value,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	choices: readonly Choice[];
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}): JSX.Element {
	return (
		<fieldset
			id={id}
			aria-label={label}
			disabled={disabled}
			className="flex shrink-0 rounded-md bg-muted p-0.5"
		>
			{choices.map((choice) => {
				const checked = choice.value === value;
				return (
					<label
						key={choice.value}
						className={cn(
							"cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring rounded-[calc(var(--radius)-4px)] px-3 py-1 text-muted-foreground text-xs hover:text-foreground",
							checked && "bg-card text-foreground shadow-sm",
						)}
					>
						<input
							type="radio"
							name={id}
							value={choice.value}
							checked={checked}
							onChange={() => onChange(choice.value)}
							className="sr-only"
						/>
						{choice.label}
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
						// Every key is the recording's, none the page's or the view's.
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
							refuse("Not set", `hold ${modifierNames()} with a key`);
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
export function Marked({
	text,
	query,
}: {
	text: string;
	query: string;
}): JSX.Element {
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
