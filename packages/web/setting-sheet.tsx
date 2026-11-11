import type { Setting } from "@splates/server/conversations";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	SlidersHorizontalIcon,
} from "lucide-react";
import { type JSX, useId, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#web/components/ui/dialog.tsx";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { AutoAgentMark, AutoIcon } from "./auto-brand";
import type { AutoPickControl } from "./auto-pick-switch";
import { latestPerClass } from "./model-classes";

/** Classes for a picker in the composer's bottom row; pass them to its trigger. */
export const IN_COMPOSER =
	"h-6 pointer-coarse:h-11 pointer-coarse:px-2 pointer-coarse:text-sm pointer-coarse:[&_svg:not([class*='size-'])]:size-4 min-w-0 shrink gap-0.5 border-transparent bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg:not([class*='size-'])]:size-3";

/**
 * Shows a conversation's settings behind one button, for a row too narrow to
 * hold them inline. Pass the settings, each one's current value and a change
 * handler: the button names the model and opens a sheet of models, where a
 * tap switches and closes it, with effort and the rest a tap deeper.
 */
export function SettingsSheet({
	settings,
	current,
	onChange,
	agent,
	autoPick,
}: {
	settings: Setting[];
	current: (setting: Setting) => string;
	onChange: (setting: Setting, value: string) => void;
	agent?: string | undefined;
	autoPick?: AutoPickControl | undefined;
}): JSX.Element {
	const model = settings.find((setting) => setting.category === "model");
	const auto = autoPick?.on === true;
	const switchId = useId();
	const [open, setOpen] = useState(false);
	const [subId, setSub] = useState<string>();
	const [all, setAll] = useState(false);
	// The sheet opens on the models; everything else is a tap deeper.
	const details = settings.filter((setting) => setting !== model);
	// Only the newest of each class shows until asked for the rest.
	const latest =
		model === undefined ? [] : latestPerClass(current(model), model.options);
	const hidden = model === undefined ? 0 : model.options.length - latest.length;
	const sub = details.find((setting) => setting.id === subId);
	const changeOpen = (next: boolean) => {
		setOpen(next);
		setSub(undefined);
		setAll(false);
	};
	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogTrigger
				aria-label="settings"
				title={
					model === undefined ? "Settings" : settingLabel(model, current(model))
				}
				className={cn(
					IN_COMPOSER,
					"inline-flex max-w-48 items-center gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				)}
			>
				{/* Who answers next in color: the agent's maker, split with Auto pick while it picks. */}
				{auto && agent !== undefined ? (
					<AutoAgentMark
						agent={agent}
						className="size-3 pointer-coarse:size-4"
					/>
				) : auto ? (
					<AutoIcon colored className="shrink-0" />
				) : agent !== undefined ? (
					<AgentMark agent={agent} className="size-3 pointer-coarse:size-4" />
				) : (
					<SlidersHorizontalIcon className="shrink-0" />
				)}
				{/* The model says the most about how the next reply goes. */}
				{model !== undefined && (
					<span className="truncate">
						{model.options.find((option) => option.value === current(model))
							?.name ?? "Unavailable model"}
					</span>
				)}
				{model === undefined && <span>{auto ? "Auto pick" : "Settings"}</span>}
				<ChevronDownIcon className="shrink-0" />
			</DialogTrigger>
			<DialogContent
				showCloseButton={false}
				className="max-h-[85dvh] gap-3 overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:data-closed:slide-out-to-bottom max-sm:data-open:slide-in-from-bottom"
			>
				{sub === undefined ? (
					<>
						<DialogHeader>
							<DialogTitle className="text-center">
								{model === undefined
									? "Settings"
									: `Select ${model.name.toLowerCase()}`}
							</DialogTitle>
							<DialogDescription className="sr-only">
								Applies to your next message.
							</DialogDescription>
						</DialogHeader>
						{autoPick !== undefined && (
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={switchId}>
										<AutoIcon colored={auto} />
										Auto pick
									</FieldLabel>
									<FieldDescription>
										{autoPick.chooses ??
											"Chooses the model and effort from what you say. Picking either yourself turns it off."}
									</FieldDescription>
								</FieldContent>
								<Switch
									id={switchId}
									checked={auto}
									onCheckedChange={(checked) => autoPick.switch(checked)}
								/>
							</Field>
						)}
						{/* The model leads: one tap switches and closes. */}
						{model !== undefined && (
							<div
								role="radiogroup"
								aria-label="model"
								className="flex flex-col rounded-xl bg-muted/40 px-3"
							>
								{(all ? model.options : latest).map((option) => (
									<OptionRow
										key={option.value}
										name={settingLabel(model, option.value)}
										description={option.description}
										selected={option.value === current(model)}
										onSelect={() => {
											onChange(model, option.value);
											changeOpen(false);
										}}
									/>
								))}
								{(hidden > 0 || all) && (
									<button
										type="button"
										onClick={() => setAll(!all)}
										className="flex min-h-12 items-center justify-between gap-3 py-2 text-left text-sm text-muted-foreground"
									>
										{all
											? "Show fewer models"
											: `Show all models (${hidden} more)`}
										<ChevronDownIcon
											className={cn("size-4 shrink-0", all && "rotate-180")}
										/>
									</button>
								)}
							</div>
						)}
						{/* Effort, mode and the rest stay a tap deeper. */}
						{details.length > 0 && (
							<div className="flex flex-col rounded-xl bg-muted/40 px-3">
								{details.map((setting) => (
									<button
										type="button"
										key={setting.id}
										onClick={() => setSub(setting.id)}
										className="flex min-h-12 items-center justify-between gap-3 border-b py-2 text-left last:border-b-0"
									>
										<span className="text-sm">{setting.name}</span>
										<span className="flex min-w-0 items-center gap-1 text-muted-foreground">
											<span className="truncate">
												{setting.type === "boolean"
													? current(setting) === "on"
														? "On"
														: "Off"
													: settingLabel(setting, current(setting))}
											</span>
											<ChevronRightIcon className="size-4 shrink-0" />
										</span>
									</button>
								))}
							</div>
						)}
					</>
				) : (
					<>
						<DialogHeader className="relative items-center">
							<button
								type="button"
								aria-label="Back"
								onClick={() => setSub(undefined)}
								className="absolute top-1/2 left-0 flex size-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-muted"
							>
								<ChevronLeftIcon className="size-4" />
							</button>
							<DialogTitle>{sub.name}</DialogTitle>
							<DialogDescription className="sr-only">
								Applies to your next message.
							</DialogDescription>
						</DialogHeader>
						{sub.type === "boolean" ? (
							<Field orientation="horizontal">
								<FieldLabel htmlFor={switchId}>{sub.name}</FieldLabel>
								<Switch
									id={switchId}
									checked={current(sub) === "on"}
									onCheckedChange={(checked) =>
										onChange(sub, checked ? "on" : "off")
									}
								/>
							</Field>
						) : (
							<div
								role="radiogroup"
								aria-label={sub.name.toLowerCase()}
								className="flex flex-col rounded-xl bg-muted/40 px-3"
							>
								{sub.options.map((option) => (
									<OptionRow
										key={option.value}
										name={settingLabel(sub, option.value)}
										description={option.description}
										selected={option.value === current(sub)}
										onSelect={() => {
											onChange(sub, option.value);
											setSub(undefined);
										}}
									/>
								))}
							</div>
						)}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

/** One choice in the sheet: its name and note, a check on the one in force. */
function OptionRow({
	name,
	description,
	selected,
	onSelect,
}: {
	name: string;
	description: string | null;
	selected: boolean;
	onSelect: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className="flex min-h-14 items-center justify-between gap-3 border-b py-2 text-left last:border-b-0"
		>
			<span className="flex min-w-0 flex-col">
				<span className="text-base [overflow-wrap:anywhere]">{name}</span>
				{description !== null && description !== "" && (
					<span className="text-sm text-muted-foreground">{description}</span>
				)}
			</span>
			{selected && <CheckIcon className="size-5 shrink-0 text-primary" />}
		</button>
	);
}

/** A setting's option as the user reads it, with the provider id shown when providers reuse a name. */
export function settingLabel(setting: Setting, value: string): string {
	const option = setting.options.find((each) => each.value === value);
	if (option === undefined) {
		return `${value} (unavailable)`;
	}
	if (
		(setting.category === "model" || setting.id === "model") &&
		value.includes("/")
	) {
		const name = value.startsWith("opencode-go/")
			? `OpenCode Go · ${option.name}`
			: option.name;
		return `${name} (${value})`;
	}
	return option.name;
}
