import type { Setting } from "@stringsync/splates-server/conversations";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { type JSX, useId, useLayoutEffect, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#web/components/ui/dialog.tsx";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#web/components/ui/select.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { useWide } from "./app-nav";
import { AutoIcon } from "./auto-brand";
import type { AutoPickControl } from "./auto-pick-switch";

/** The Model picker's value for Auto pick, among the models. */
const AUTO = "\u0000auto-pick";

/**
 * A picker in the composer's bottom row: quiet until hovered, as in Zed, and
 * small, so the row holds them all on one line; under a finger, tall enough
 * to tap.
 */
export const IN_COMPOSER =
	"h-6 pointer-coarse:h-11 pointer-coarse:px-2 pointer-coarse:text-sm pointer-coarse:[&_svg:not([class*='size-'])]:size-4 min-w-0 shrink gap-0.5 border-transparent bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg:not([class*='size-'])]:size-3";

/**
 * A session's settings in the composer's bottom row: each inline where the
 * window is wide and the row has room for them all, else behind one button
 * that opens them in a dialog, since a phone's row, or a narrow one, has no
 * room for a model, a mode and an effort side by side.
 */
export function SettingControls({
	settings,
	current,
	onChange,
	agent,
	autoPick,
}: {
	settings: Setting[];
	current: (setting: Setting) => string;
	onChange: (setting: Setting, value: string) => void;
	/** The agent the settings are for, by its roster id, whose mark the settings button shows. */
	agent?: string | undefined;
	/** Auto pick's switch, for a conversation that offers it. */
	autoPick?: AutoPickControl | undefined;
}): JSX.Element | null {
	const wide = useWide();
	if (settings.length === 0) {
		// Auto pick, still to choose the agent, has its switch to show alone.
		return autoPick === undefined ? null : (
			<SettingsDialog
				settings={settings}
				current={current}
				onChange={onChange}
				autoPick={autoPick}
			/>
		);
	}
	if (!wide) {
		return (
			<SettingsDialog
				settings={settings}
				current={current}
				onChange={onChange}
				agent={agent}
				autoPick={autoPick}
			/>
		);
	}
	return (
		<InlineSettings
			settings={settings}
			current={current}
			onChange={onChange}
			agent={agent}
			autoPick={autoPick}
		/>
	);
}

/**
 * The settings across the composer's bottom row, while the window is wide:
 * inline where the row's room holds them all, else behind the same button and
 * dialog a phone uses, since squashed together they are unreadable. Their
 * whole width is measured against the row's, which gives way to the buttons
 * after it, so a setting stays inline only while it reads whole.
 */
function InlineSettings({
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
	const row = useRef<HTMLDivElement>(null);
	const whole = useRef<HTMLDivElement>(null);
	const [fits, setFits] = useState(true);
	const fitNow = useRef(() => {});
	fitNow.current = () => {
		const room = row.current;
		const settings = whole.current;
		if (room === null || settings === null) {
			return;
		}
		// The settings sit at their whole width, the row clipping what its
		// room cannot show: it fits only when the row holds that width. The
		// row's scrollWidth would count what overhangs a control, as a
		// switch's hidden input does, and fold settings that read whole.
		setFits(settings.offsetWidth <= room.clientWidth + 1);
	};
	useLayoutEffect(() => fitNow.current());
	useLayoutEffect(() => {
		const room = row.current;
		if (room === null) {
			return;
		}
		const resized = new ResizeObserver(() => fitNow.current());
		resized.observe(room);
		return () => resized.disconnect();
	}, []);
	const inline = settings.map((setting) => (
		<SettingControl
			key={setting.id}
			setting={setting}
			value={current(setting)}
			onChange={(value) => onChange(setting, value)}
			agent={agent}
			autoPick={autoPick}
		/>
	));
	return (
		<div
			ref={row}
			className="relative flex min-w-0 items-center overflow-hidden"
		>
			<div
				ref={whole}
				className={cn(
					"flex w-max flex-nowrap items-center",
					!fits && "invisible",
				)}
				aria-hidden={!fits || undefined}
				inert={!fits || undefined}
			>
				{inline}
			</div>
			{!fits && (
				<div className="absolute inset-y-0 left-0 flex items-center">
					<SettingsDialog
						settings={settings}
						current={current}
						onChange={onChange}
						agent={agent}
						autoPick={autoPick}
					/>
				</div>
			)}
		</div>
	);
}

/**
 * The settings behind one button that opens them in a dialog, as a phone's
 * row shows them; the button names the model, the setting that says the most
 * about how the next reply goes, beside Auto pick's sparkles while it picks,
 * else the agent's mark in its maker's colors. Auto pick's switch leads the
 * dialog.
 */
function SettingsDialog({
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
	return (
		<Dialog>
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
				{/* Who answers next in color: Auto pick, or the agent's maker. */}
				{auto ? (
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
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader className="pr-6">
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>Applies to your next message.</DialogDescription>
				</DialogHeader>
				<FieldGroup>
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
					{settings.map((setting) => (
						<SettingControl
							key={setting.id}
							setting={setting}
							value={current(setting)}
							onChange={(value) => onChange(setting, value)}
							autoPick={autoPick}
							inDialog
						/>
					))}
				</FieldGroup>
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}

/** One of a session's settings: a switch for a toggle, else a picker. */
function SettingControl({
	setting,
	value,
	onChange,
	agent,
	autoPick,
	inDialog = false,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
	agent?: string | undefined;
	autoPick?: AutoPickControl | undefined;
	inDialog?: boolean;
}): JSX.Element {
	const inlineModel = setting.category === "model" && !inDialog;
	// Inline, Auto pick is the first of the models; the sheet has its own switch.
	const withAuto = inlineModel ? autoPick : undefined;
	const id = useId();
	if (setting.type === "boolean" && inDialog) {
		return (
			<Field orientation="horizontal">
				<FieldLabel htmlFor={id}>{setting.name}</FieldLabel>
				<Switch
					id={id}
					checked={value === "on"}
					onCheckedChange={(checked) => onChange(checked ? "on" : "off")}
				/>
			</Field>
		);
	}
	if (setting.type === "boolean") {
		return (
			<span
				title={setting.name}
				className={cn(
					IN_COMPOSER,
					"inline-flex items-center gap-1.5 rounded-md",
				)}
			>
				<label htmlFor={id} className="cursor-pointer">
					{setting.name}
				</label>
				<Switch
					id={id}
					size="sm"
					checked={value === "on"}
					onCheckedChange={(checked) => onChange(checked ? "on" : "off")}
				/>
			</span>
		);
	}
	if (inDialog) {
		return (
			<Field
				data-invalid={
					!setting.options.some((option) => option.value === value) || undefined
				}
			>
				<FieldLabel htmlFor={id}>{setting.name}</FieldLabel>
				<SettingSelect
					id={id}
					setting={setting}
					value={value}
					onChange={onChange}
					autoPick={withAuto}
					inDialog
				/>
			</Field>
		);
	}
	return (
		<SettingSelect
			setting={setting}
			value={value}
			onChange={onChange}
			agent={inlineModel ? agent : undefined}
			autoPick={withAuto}
		/>
	);
}

/** The categories of setting a picker shows by value alone, effort among them. */
const UNLABELED = new Set(["mode", "model", "thought_level"]);

/** One of a session's settings, picked from what the agent offers. */
function SettingSelect({
	id,
	setting,
	value,
	onChange,
	agent,
	autoPick,
	inDialog = false,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
	/** The agent whose mark leads the picker, as it leads a phone's settings button. */
	agent?: string | undefined;
	/** Auto pick, offered first among the models. */
	autoPick?: AutoPickControl | undefined;
	inDialog?: boolean;
	id?: string;
}): JSX.Element {
	const known = setting.options.some((option) => option.value === value);
	const auto = autoPick?.on === true;
	return (
		<Select
			// Base UI keeps a picker's items once it has them, and shows a
			// value it cannot find as its text, "null" among them: a picker
			// reused for another agent's options must start over.
			key={JSON.stringify(setting.options)}
			items={[
				...(autoPick === undefined
					? []
					: [{ value: AUTO, label: "Auto pick" }]),
				...setting.options.map((option) => ({
					value: option.value,
					label: settingLabel(setting, option.value),
				})),
			]}
			value={auto ? AUTO : known ? value : null}
			onValueChange={(value) => {
				if (value === AUTO) {
					autoPick?.switch(true);
				} else if (value !== null) {
					onChange(String(value));
				}
			}}
		>
			<SelectTrigger
				id={id}
				size={inDialog ? "default" : "sm"}
				aria-label={setting.name.toLowerCase()}
				title={settingLabel(setting, value)}
				aria-invalid={!known || undefined}
				className={
					inDialog
						? "h-auto min-h-11 w-full min-w-0 whitespace-normal *:data-[slot=select-value]:line-clamp-none"
						: IN_COMPOSER
				}
			>
				{/* A mode, model, or effort says what it is by its value; "Off"
				    alone would not. The dialog names each beside it. */}
				{!inDialog && !UNLABELED.has(setting.category ?? "") && (
					<span className="text-muted-foreground/70">{setting.name}</span>
				)}
				{/* Who answers next in color: Auto pick, or the agent's maker. */}
				{auto ? (
					<AutoIcon colored className="shrink-0" />
				) : (
					agent !== undefined && <AgentMark agent={agent} className="size-3" />
				)}
				<SelectValue
					className={
						inDialog
							? "line-clamp-none break-words [overflow-wrap:anywhere]"
							: undefined
					}
				>
					{auto
						? `Auto · ${settingLabel(setting, value)}`
						: settingLabel(setting, value)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent
				side={inDialog ? "bottom" : "top"}
				align={inDialog ? "end" : "start"}
				alignItemWithTrigger={false}
				className="w-auto max-w-[calc(100vw-2rem)]"
			>
				<SelectGroup>
					{autoPick !== undefined && (
						<SelectItem className="min-h-9" value={AUTO}>
							<AutoIcon colored />
							Auto pick
						</SelectItem>
					)}
					{setting.options.map((option) => (
						<SelectItem
							key={option.value}
							className="min-h-9 [&>div]:min-w-0 [&>div]:shrink [&>div]:whitespace-normal [&>div]:[overflow-wrap:anywhere]"
							value={option.value}
							title={option.description ?? undefined}
						>
							{settingLabel(setting, option.value)}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

/** Keep provider identities visible even when different providers reuse a name. */
function settingLabel(setting: Setting, value: string): string {
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
