import type { Rig, RigOption, RigPresets } from "@splates/server/rigs/browser";
import { useReactive, useResource } from "core/react";
import { ChevronDownIcon, PlayIcon, PlusIcon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { savePreset, startRun } from "./api/rigs";
import { Button } from "./components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "./components/ui/native-select";
import { Switch } from "./components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { cn } from "./lib/utils";
import { RigStartForm, type StartApi } from "./rig-start-form";

const SERVER: StartApi = { startRun, savePreset };

/**
 * The form that starts a run of `rig`: the tree it runs on, a saved preset
 * to start from, and each of its options. `busy` names the trees it already
 * runs on, which it cannot start on again.
 */
export function RigStartDialog({
	group,
	command,
	rig,
	trees,
	tree: opening,
	busy,
	presets,
	onPresets,
	onStarted,
	onClose,
	api = SERVER,
}: {
	group: string;
	command: string;
	rig: Rig;
	trees: string[];
	/** The tree it opens on; the first it is not running on when null. */
	tree: string | null;
	busy: string[];
	/** Every saved preset, by `<group>/<rig>`. */
	presets: RigPresets;
	onPresets: (presets: RigPresets) => void;
	onStarted: (id: string) => void;
	onClose: () => void;
	api?: StartApi;
}): JSX.Element {
	const form = useResource(
		() =>
			new RigStartForm(
				api,
				group,
				rig,
				opening ??
					trees.find((each) => !busy.includes(each)) ??
					trees[0] ??
					"main",
			),
		// The dialog is keyed by its rig, so one form serves it while open.
		[api],
	);
	const { tree, values, preset, naming, starting, refused } = useReactive(
		form,
		(each) => each.state,
		["changed"],
	);
	const saved = presets[`${group}/${rig.name}`] ?? {};
	const taken = busy.includes(tree);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className={SHEET}>
				<span
					aria-hidden
					className="mx-auto -mt-1 h-1.5 w-10 rounded-full bg-muted-foreground/25 sm:hidden"
				/>
				<DialogHeader className="gap-1">
					<DialogTitle className="text-lg">Start {rig.label}</DialogTitle>
					<DialogDescription className="font-mono text-xs">
						{command} start {rig.name}
					</DialogDescription>
				</DialogHeader>
				<div className="-mx-4 flex min-h-0 flex-col gap-5 overflow-y-auto px-4">
					<div className="flex flex-col gap-2">
						<span className="font-medium text-sm">Where</span>
						<div
							role="radiogroup"
							aria-label="Tree"
							className="flex flex-col gap-2"
						>
							{trees.map((each) => (
								<TreeChoice
									key={each}
									tree={each}
									on={each === tree}
									running={busy.includes(each)}
									onPick={() => form.tree(each)}
								/>
							))}
						</div>
					</div>
					{rig.options.length > 0 && (
						<Collapsible className="flex flex-col gap-4">
							<CollapsibleTrigger className="group flex min-h-10 items-center gap-2 text-left">
								<span className="flex-1 font-medium text-sm">Options</span>
								<span className="text-muted-foreground text-sm">
									{preset ?? "Defaults"}
								</span>
								<ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
							</CollapsibleTrigger>
							<CollapsibleContent className="flex flex-col gap-4">
								<Presets
									saved={saved}
									preset={preset}
									naming={naming}
									form={form}
									onPresets={onPresets}
								/>
								{rig.options.map((option) => (
									<OptionField
										key={option.name}
										option={option}
										value={values[option.name] ?? option.default}
										onChange={(value) => form.set(option.name, value)}
									/>
								))}
							</CollapsibleContent>
						</Collapsible>
					)}
				</div>
				{refused !== null && (
					<p className="text-destructive text-sm">{refused}</p>
				)}
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="outline" className="max-sm:hidden" onClick={onClose}>
						Cancel
					</Button>
					<Button
						block
						className="text-base sm:h-8 sm:w-auto sm:text-sm"
						disabled={starting || taken}
						onClick={() =>
							void form.start().then((id) => {
								if (id !== null) {
									onStarted(id);
								}
							})
						}
					>
						<PlayIcon />
						<span className="truncate">Start on {tree}</span>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * On a phone, a sheet that rises from the bottom edge to the thumb; from
 * `sm`, the centred dialog.
 */
const SHEET =
	"flex max-h-[90dvh] flex-col gap-4 sm:max-w-lg max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom-8 max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom-8";

/** A tree to start on, as a row a thumb can hit, saying what running there means. */
function TreeChoice({
	tree,
	on,
	running,
	onPick,
}: {
	tree: string;
	on: boolean;
	running: boolean;
	onPick: () => void;
}): JSX.Element {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a row of a radiogroup, styled as a card
		<button
			type="button"
			role="radio"
			aria-checked={on}
			disabled={running}
			onClick={onPick}
			className={cn(
				"flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left",
				on ? "border-foreground ring-1 ring-foreground" : "border-input",
				running && "opacity-55",
			)}
		>
			<span
				aria-hidden
				className={cn(
					"size-4.5 shrink-0 rounded-full border-2",
					on ? "border-[5px] border-foreground" : "border-muted-foreground/40",
				)}
			/>
			<span className="flex min-w-0 flex-col">
				<span className="truncate font-mono text-sm">{tree}</span>
				<span className="text-muted-foreground text-xs">
					{running
						? "Already running"
						: tree === "main"
							? "The main tree, as it is now"
							: "Stops when the task ends"}
				</span>
			</span>
		</button>
	);
}

/** The saved presets to start from, dropping one, and saving the values as a new one. */
function Presets({
	saved,
	preset,
	naming,
	form,
	onPresets,
}: {
	saved: RigPresets[string];
	preset: string | null;
	naming: string | null;
	form: RigStartForm;
	onPresets: (presets: RigPresets) => void;
}): JSX.Element {
	return (
		<Labelled label="Preset">
			<div className="flex flex-wrap items-center gap-1.5">
				<Chip on={preset === null} onClick={() => form.pick(null, saved)}>
					Defaults
				</Chip>
				{Object.keys(saved).map((name) => (
					<span key={name} className="inline-flex items-center">
						<Chip on={preset === name} onClick={() => form.pick(name, saved)}>
							{name}
						</Chip>
						<button
							type="button"
							aria-label={`Drop preset ${name}`}
							className="-ml-1 rounded-full p-2 text-muted-foreground hover:text-foreground"
							onClick={() => void form.drop(name).then(onPresets)}
						>
							<XIcon className="size-3.5" />
						</button>
					</span>
				))}
				{naming === null ? (
					<Chip dashed onClick={() => form.naming("")}>
						<PlusIcon className="size-3" />
						Save as preset
					</Chip>
				) : (
					<form
						className="flex items-center gap-1.5"
						onSubmit={(event) => {
							event.preventDefault();
							void form.save().then((saved) => {
								if (saved !== null) {
									onPresets(saved);
								}
							});
						}}
					>
						<Input
							autoFocus
							aria-label="Preset name"
							placeholder="Name"
							className="h-8 w-32"
							value={naming}
							onChange={(event) => form.naming(event.target.value)}
						/>
						<Button type="submit" variant="outline">
							Save
						</Button>
					</form>
				)}
			</div>
		</Labelled>
	);
}

/** One option's field, by its type. */
function OptionField({
	option,
	value,
	onChange,
}: {
	option: RigOption;
	value: boolean | string | number;
	onChange: (value: boolean | string | number) => void;
}): JSX.Element {
	const label =
		option.label ?? option.name.charAt(0).toUpperCase() + option.name.slice(1);
	if (option.type === "boolean") {
		return (
			<div className="flex items-center justify-between gap-4">
				<div className="flex flex-col gap-0.5">
					<span className="font-medium text-sm">{label}</span>
					{option.description !== undefined && (
						<span className="text-muted-foreground text-xs">
							{option.description}
						</span>
					)}
				</div>
				<Switch
					aria-label={label}
					checked={value === true}
					onCheckedChange={(checked) => onChange(checked)}
				/>
			</div>
		);
	}
	if (option.type === "enum") {
		return (
			<Labelled label={label} help={option.description}>
				{option.values.length <= 4 ? (
					<ToggleGroup
						aria-label={label}
						variant="outline"
						size="sm"
						spacing={0}
						value={[String(value)]}
						onValueChange={(picked: string[]) => {
							if (picked[0] !== undefined) {
								onChange(picked[0]);
							}
						}}
					>
						{option.values.map((each) => (
							<ToggleGroupItem
								key={each}
								value={each}
								className="data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background"
							>
								{each}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				) : (
					<NativeSelect
						aria-label={label}
						value={String(value)}
						onChange={(event) => onChange(event.target.value)}
						className="w-full"
					>
						{option.values.map((each) => (
							<NativeSelectOption key={each} value={each}>
								{each}
							</NativeSelectOption>
						))}
					</NativeSelect>
				)}
			</Labelled>
		);
	}
	return (
		<Labelled label={label} help={option.description}>
			<Input
				aria-label={label}
				type={option.type === "number" ? "number" : "text"}
				className="font-mono"
				value={String(value)}
				onChange={(event) =>
					onChange(
						option.type === "number"
							? Number(event.target.value)
							: event.target.value,
					)
				}
			/>
		</Labelled>
	);
}

function Labelled({
	label,
	help,
	children,
}: {
	label: string;
	help?: string;
	children: JSX.Element;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="font-medium text-sm">{label}</span>
			{children}
			{help !== undefined && (
				<span className="text-muted-foreground text-xs">{help}</span>
			)}
		</div>
	);
}

function Chip({
	on = false,
	dashed = false,
	onClick,
	children,
}: {
	on?: boolean;
	dashed?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs",
				on
					? "border-foreground bg-foreground text-background"
					: "border-input bg-background hover:bg-muted",
				dashed && "border-dashed",
			)}
		>
			{children}
		</button>
	);
}
