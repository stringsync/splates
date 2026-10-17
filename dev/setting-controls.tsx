import { SlidersHorizontalIcon } from "lucide-react";
import { type JSX, useId } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#dev/components/ui/dialog.tsx";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#dev/components/ui/select.tsx";
import { Switch } from "#dev/components/ui/switch.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Setting } from "../conversations";
import { useWide } from "./app-nav";

/**
 * A picker in the composer's bottom row: quiet until hovered, as in Zed, and
 * small, so the row holds them all on one line; under a finger, tall enough
 * to tap.
 */
const IN_COMPOSER =
	"h-6 pointer-coarse:h-11 pointer-coarse:px-2 pointer-coarse:text-sm pointer-coarse:[&_svg:not([class*='size-'])]:size-4 min-w-0 shrink gap-0.5 border-transparent bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg:not([class*='size-'])]:size-3";

/**
 * A session's settings in the composer's bottom row: each inline where the
 * window is wide, else behind one button that opens them in a dialog, since a
 * phone's row has no room for a model, a mode and an effort side by side.
 */
export function SettingControls({
	settings,
	current,
	onChange,
}: {
	settings: Setting[];
	current: (setting: Setting) => string;
	onChange: (setting: Setting, value: string) => void;
}): JSX.Element | null {
	const wide = useWide();
	if (settings.length === 0) {
		return null;
	}
	if (wide) {
		return (
			<>
				{settings.map((setting) => (
					<SettingControl
						key={setting.id}
						setting={setting}
						value={current(setting)}
						onChange={(value) => onChange(setting, value)}
					/>
				))}
			</>
		);
	}
	const model = settings.find((setting) => setting.category === "model");
	return (
		<Dialog>
			<DialogTrigger
				aria-label="settings"
				title="Settings"
				className={cn(IN_COMPOSER, "inline-flex items-center rounded-md")}
			>
				<SlidersHorizontalIcon />
				{/* The model says the most about how the next reply goes. */}
				{model !== undefined && (
					<span className="truncate">
						{settingLabel(model, current(model))}
					</span>
				)}
			</DialogTrigger>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					{settings.map((setting) => (
						<SettingControl
							key={setting.id}
							setting={setting}
							value={current(setting)}
							onChange={(value) => onChange(setting, value)}
							inDialog
						/>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * A setting in the dialog: its name on the left and its control on the right,
 * at full size, since it has the room the composer's row lacks.
 */
const IN_DIALOG_ROW = "flex items-center justify-between gap-3";

/** One of a session's settings: a switch for a toggle, else a picker. */
function SettingControl({
	setting,
	value,
	onChange,
	inDialog = false,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
	inDialog?: boolean;
}): JSX.Element {
	const id = useId();
	if (setting.type === "boolean" && inDialog) {
		return (
			<div className={IN_DIALOG_ROW}>
				<label htmlFor={id} className="cursor-pointer">
					{setting.name}
				</label>
				<Switch
					id={id}
					checked={value === "on"}
					onCheckedChange={(checked) => onChange(checked ? "on" : "off")}
				/>
			</div>
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
			<div className={IN_DIALOG_ROW}>
				<span>{setting.name}</span>
				<SettingSelect
					setting={setting}
					value={value}
					onChange={onChange}
					inDialog
				/>
			</div>
		);
	}
	return <SettingSelect setting={setting} value={value} onChange={onChange} />;
}

/** The categories of setting a picker shows by value alone, effort among them. */
const UNLABELED = new Set(["mode", "model", "thought_level"]);

/** One of a session's settings, picked from what the agent offers. */
function SettingSelect({
	setting,
	value,
	onChange,
	inDialog = false,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
	inDialog?: boolean;
}): JSX.Element {
	const known = setting.options.some((option) => option.value === value);
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
				className={inDialog ? "min-w-0 max-w-[60%]" : IN_COMPOSER}
			>
				{/* A mode, model, or effort says what it is by its value; "Off"
				    alone would not. The dialog names each beside it. */}
				{!inDialog && !UNLABELED.has(setting.category ?? "") && (
					<span className="text-muted-foreground/70">{setting.name}</span>
				)}
				<SelectValue>{settingLabel(setting, value)}</SelectValue>
			</SelectTrigger>
			<SelectContent
				side={inDialog ? "bottom" : "top"}
				align={inDialog ? "end" : "start"}
				alignItemWithTrigger={false}
				className="w-auto"
			>
				<SelectGroup>
					{setting.options.map((option) => (
						<SelectItem
							key={option.value}
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
