import type { Setting } from "@splates/server/conversations";
import { type JSX, useId, useLayoutEffect, useRef, useState } from "react";
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
import { AutoAgentMark, AutoIcon } from "./auto-brand";
import type { AutoPickControl } from "./auto-pick-switch";
import { IN_COMPOSER, SettingsSheet, settingLabel } from "./setting-sheet";

/** The agent's own suffix on its default model, too wide for the composer's trigger. */
const RECOMMENDED = / \(recommended\)$/i;

/**
 * A session's settings for the composer's bottom row. Use it where a
 * conversation sends messages: it shows each setting inline when the window
 * has room, and otherwise one button that opens a sheet.
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
			<SettingsSheet
				settings={settings}
				current={current}
				onChange={onChange}
				autoPick={autoPick}
			/>
		);
	}
	if (!wide) {
		return (
			<SettingsSheet
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
					<SettingsSheet
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

/** One of a session's settings, inline: a switch for a toggle, else a picker. */
function SettingControl({
	setting,
	value,
	onChange,
	agent,
	autoPick,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
	agent?: string | undefined;
	autoPick?: AutoPickControl | undefined;
}): JSX.Element {
	const inlineModel = setting.category === "model";
	const id = useId();
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
	// Inline, Auto pick's switch tops the model's dropdown.
	return (
		<SettingSelect
			setting={setting}
			value={value}
			onChange={onChange}
			agent={inlineModel ? agent : undefined}
			autoPick={inlineModel ? autoPick : undefined}
		/>
	);
}

/** The categories of setting a picker shows by value alone, effort among them. */
const UNLABELED = new Set(["mode", "model", "thought_level"]);

/** One of a session's settings, picked from what the agent offers. */
function SettingSelect({
	setting,
	value,
	onChange,
	agent,
	autoPick,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
	/** The agent whose mark leads the picker, as it leads a phone's settings button, split with Auto pick's while it picks. */
	agent?: string | undefined;
	/** Auto pick, whose mark shows while it picks. */
	autoPick?: AutoPickControl | undefined;
}): JSX.Element {
	const known = setting.options.some((option) => option.value === value);
	const auto = autoPick?.on === true;
	const autoId = useId();
	const withSwitch = autoPick !== undefined;
	return (
		<Select
			// Base UI keeps a picker's items once it has them, and shows a
			// value it cannot find as its text, "null" among them: a picker
			// reused for another agent's options must start over.
			key={JSON.stringify(setting.options)}
			items={setting.options.map((option) => ({
				value: option.value,
				label: settingLabel(setting, option.value),
			}))}
			value={known ? value : null}
			onValueChange={(value) => {
				if (value !== null) {
					onChange(String(value));
				}
			}}
		>
			<SelectTrigger
				size="sm"
				aria-label={setting.name.toLowerCase()}
				title={settingLabel(setting, value)}
				aria-invalid={!known || undefined}
				className={agent !== undefined ? `${IN_COMPOSER} gap-1.5` : IN_COMPOSER}
			>
				{/* A mode, model, or effort says what it is by its value; "Off"
				    alone would not. The sheet names each beside it. */}
				{!UNLABELED.has(setting.category ?? "") && (
					<span className="text-muted-foreground/70">{setting.name}</span>
				)}
				{/* Who answers next in color: the agent's maker, split with Auto pick while it picks. */}
				{auto && agent !== undefined ? (
					<AutoAgentMark agent={agent} className="size-3" />
				) : auto ? (
					<AutoIcon colored className="shrink-0" />
				) : (
					agent !== undefined && <AgentMark agent={agent} className="size-3" />
				)}
				<SelectValue>
					{auto
						? `Auto · ${settingLabel(setting, value)}`
						: setting.category === "mode" && value === "auto"
							? // Bare, it reads as Auto pick's "Auto · Opus" beside it.
								`Mode: ${settingLabel(setting, value)}`
							: settingLabel(setting, value).replace(RECOMMENDED, "")}
				</SelectValue>
			</SelectTrigger>
			<SelectContent
				side="top"
				align="start"
				alignItemWithTrigger={false}
				className="w-auto max-w-[calc(100vw-2rem)]"
			>
				{withSwitch && (
					<div className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs">
						<label
							htmlFor={autoId}
							className="flex cursor-pointer items-center gap-1.5"
						>
							<AutoIcon colored={auto} />
							Auto pick
						</label>
						<Switch
							id={autoId}
							size="sm"
							checked={auto}
							onCheckedChange={(checked) => autoPick.switch(checked)}
						/>
					</div>
				)}
				<SelectGroup>
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
