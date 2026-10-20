import type { TaskStage } from "@stringsync/splates-server/board";
import type { Hook, Trigger } from "@stringsync/splates-server/hooks";
import {
	TASK_EVENTS,
	type TaskEventName,
} from "@stringsync/splates-server/hooks/browser";
import { useReactive } from "@webappwiz/react";
import { type FormEvent, type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutomationDraft, type When } from "./automation-draft";
import { Lanes } from "./conversation-names";
import { AssigneeMenu } from "./dispatching";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusal } from "./refusal";

const STAGES: TaskStage[] = ["backlog", "ready", "queued", "running"];

/** The form that adds an automation, clearing what was typed once it is added. */
export function AddForm({
	onAdd,
}: {
	onAdd: (trigger: Trigger, hook: Hook) => Promise<boolean>;
}): JSX.Element {
	const [draft] = useState(() => new AutomationDraft());
	return (
		<AutomationForm
			draft={draft}
			title="Add an automation"
			submit="Add"
			onSubmit={(trigger, hook) =>
				void onAdd(trigger, hook).then((added) => {
					if (added) {
						draft.added();
					}
				})
			}
		/>
	);
}

/** The form that adds or edits an automation: its trigger, then what it runs. */
export function AutomationForm({
	draft,
	title,
	submit,
	onSubmit,
	onCancel,
}: {
	draft: AutomationDraft;
	title: string;
	submit: string;
	onSubmit: (trigger: Trigger, hook: Hook) => void;
	onCancel?: () => void;
}): JSX.Element {
	const lanes = useContext(Lanes);
	const { when, event, stage, lane, schedule, kind, pick, prompt, command } =
		useReactive(draft, (draft) => draft.fields, ["changed"]);
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
		onSubmit(made.trigger, made.hook);
	};
	return (
		<form
			aria-label={title.toLowerCase()}
			onSubmit={submitted}
			className="flex flex-col gap-3 rounded-xl border p-3"
		>
			<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
			<div className="flex flex-wrap items-center gap-2">
				<NativeSelect
					aria-label="When"
					value={when}
					onChange={(change) => draft.set("when", change.target.value as When)}
				>
					<NativeSelectOption value="event">On a task event</NativeSelectOption>
					<NativeSelectOption value="every">Every so often</NativeSelectOption>
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
					/>
				)}
			</div>
			{kind === "agent" ? (
				<Textarea
					aria-label="Prompt"
					required
					placeholder="What the agent is told, after what set it off"
					value={prompt}
					onChange={(change) => draft.set("prompt", change.target.value)}
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
			<div className="flex gap-2">
				<Button type="submit" size="sm">
					{submit}
				</Button>
				{onCancel !== undefined && (
					<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
