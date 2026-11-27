import type { TaskStage } from "@splates/server/board";
import type { Hook, Trigger } from "@splates/server/hooks";
import { TASK_EVENTS, type TaskEventName } from "@splates/server/hooks/browser";
import { useReactive } from "core/react";
import { type FormEvent, type JSX, useContext, useId } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { cn } from "#web/lib/utils.ts";
import type { AutomationDraft, When } from "./automation-draft";
import { Lanes } from "./conversation-names";
import { AssigneeMenu } from "./dispatching";
import { MarkdownEditor } from "./markdown-editor";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusal } from "./refusal";
import { useSignals } from "./use-signals";

const STAGES: TaskStage[] = ["available", "queued", "running"];

/**
 * The form that adds or edits a subscription: what sets it off (a signal,
 * a task event or a schedule), then what it runs. In a dialog, pass `bare`
 * for no border or heading of its own.
 */
export function AutomationForm({
	draft,
	title,
	submit,
	onSubmit,
	onCancel,
	signal,
	bare = false,
	projects = [],
	project = "",
	onProject,
}: {
	/** Set when the trigger is fixed to this signal: the form then has no "When" to choose. */
	signal?: string;
	draft: AutomationDraft;
	title: string;
	submit: string;
	onSubmit: (trigger: Trigger, hook: Hook, name: string) => void;
	onCancel?: () => void;
	/** Drawn without its own border and heading, as inside a dialog that has them. */
	bare?: boolean;
	/** The projects it can belong to; the picker shows only with several. */
	projects?: string[];
	/** The project it belongs to. */
	project?: string;
	/** Picks the project; without it the project is fixed, as when editing. */
	onProject?: (project: string) => void;
}): JSX.Element {
	const suggestions = useId();
	const lanes = useContext(Lanes);
	const { signals } = useSignals();
	const names = signals.map((each) => each.name);
	const {
		name,
		when,
		event,
		stage,
		lane,
		invokes,
		schedule,
		kind,
		pick,
		prompt,
		command,
	} = useReactive(draft, (draft) => draft.fields, ["changed"]);
	const { refusal, refuse } = useRefusal();
	const submitted = (form: FormEvent) => {
		form.preventDefault();
		let made: ReturnType<AutomationDraft["made"]>;
		try {
			made = draft.made();
		} catch (error) {
			refuse(`Not ${submit === "Add" ? "added" : "saved"}`, error);
			return;
		}
		onSubmit(made.trigger, made.hook, made.name);
	};
	return (
		<form
			aria-label={title.toLowerCase()}
			onSubmit={submitted}
			className={cn("flex flex-col gap-3", !bare && "rounded-xl border p-3")}
		>
			{!bare && (
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
			)}
			<Input
				aria-label="Name"
				placeholder="Name (optional)"
				value={name}
				onChange={(change) => draft.set("name", change.target.value)}
			/>
			{projects.length > 1 && (
				<NativeSelect
					aria-label="Project"
					value={project}
					disabled={onProject === undefined}
					onChange={(change) => onProject?.(change.target.value)}
				>
					{projects.map((each) => (
						<NativeSelectOption key={each} value={each}>
							Project {each}
						</NativeSelectOption>
					))}
				</NativeSelect>
			)}
			{signal !== undefined ? (
				<p className="text-muted-foreground text-sm">
					When <code className="font-mono">{signal}</code> is raised
				</p>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<NativeSelect
						aria-label="When"
						value={when}
						onChange={(change) =>
							draft.set("when", change.target.value as When)
						}
					>
						<NativeSelectOption value="event">
							On a task event
						</NativeSelectOption>
						<NativeSelectOption value="signal">On a signal</NativeSelectOption>
						<NativeSelectOption value="every">
							Every so often
						</NativeSelectOption>
						<NativeSelectOption value="cron">On a cron line</NativeSelectOption>
					</NativeSelect>
					{when === "event" ? (
						<>
							<NativeSelect
								aria-label="Event"
								value={event}
								onChange={(change) =>
									draft.set("event", change.target.value as TaskEventName)
								}
							>
								{TASK_EVENTS.map((each) => (
									<NativeSelectOption key={each} value={each}>
										{each}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<NativeSelect
								aria-label="Stage"
								value={stage}
								onChange={(change) => draft.set("stage", change.target.value)}
							>
								<NativeSelectOption value="">In any stage</NativeSelectOption>
								{stage.includes(",") && (
									<NativeSelectOption value={stage}>
										In {stage.split(",").join(" or ")}
									</NativeSelectOption>
								)}
								{STAGES.map((each) => (
									<NativeSelectOption key={each} value={each}>
										In {each}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<NativeSelect
								aria-label="Lane"
								value={lane}
								onChange={(change) => draft.set("lane", change.target.value)}
							>
								<NativeSelectOption value="">In any lane</NativeSelectOption>
								{lane.includes(",") && (
									<NativeSelectOption value={lane}>
										In lane {lane.split(",").join(" or ")}
									</NativeSelectOption>
								)}
								{lanes.map((each) => (
									<NativeSelectOption key={each.id} value={String(each.id)}>
										{each.id} {each.name}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<Input
								aria-label="Every Nth"
								type="number"
								min={1}
								step={1}
								className="w-60"
								placeholder="Run on every Nth match (blank: each)"
								title="Run on only every Nth time the event matches"
								value={invokes}
								onChange={(change) => draft.set("invokes", change.target.value)}
							/>
						</>
					) : when === "signal" ? (
						<>
							<Input
								aria-label="Signal"
								required
								list={suggestions}
								className="min-w-0 flex-1 basis-60 font-mono"
								placeholder='mdom.released or clock.in("2 days")'
								value={schedule}
								onChange={(change) =>
									draft.set("schedule", change.target.value)
								}
							/>
							<datalist id={suggestions}>
								{names.map((each) => (
									<option key={each} value={each} />
								))}
							</datalist>
						</>
					) : (
						<Input
							aria-label="Schedule"
							required
							className="w-48"
							placeholder={when === "every" ? "30m, 2h or 1d" : "0 9 * * 1-5"}
							value={schedule}
							onChange={(change) => draft.set("schedule", change.target.value)}
						/>
					)}
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<NativeSelect
					aria-label="Runs"
					value={kind}
					onChange={(change) =>
						draft.set("kind", change.target.value as Hook["kind"])
					}
				>
					<NativeSelectOption value="agent">Tell an agent</NativeSelectOption>
					<NativeSelectOption value="run">Run a command</NativeSelectOption>
				</NativeSelect>
				{kind === "agent" && (
					<AssigneeMenu
						assignee={pick}
						onPick={(picked) => draft.set("pick", picked)}
						auto
						label="Run as"
					/>
				)}
			</div>
			{kind === "agent" ? (
				<MarkdownEditor
					label="Prompt"
					required
					placeholder="What the agent is told, after what set it off"
					value={prompt}
					onChange={(value) => draft.set("prompt", value)}
				/>
			) : (
				<Input
					aria-label="Command"
					required
					placeholder="Run with sh -c in the main tree"
					value={command}
					onChange={(change) => draft.set("command", change.target.value)}
				/>
			)}
			<Refusal refusal={refusal} />
			<div
				className={cn("flex gap-2", bare && "flex-row-reverse justify-start")}
			>
				<Button type="submit" size="sm">
					{submit}
				</Button>
				{onCancel !== undefined && (
					<Button
						type="button"
						size="sm"
						variant={bare ? "outline" : "ghost"}
						onClick={onCancel}
					>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
