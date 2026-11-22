import type { Hook, Trigger } from "@splates/server/hooks";
import { useReactive } from "core/react";
import type { FormEvent, JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { cn } from "#web/lib/utils.ts";
import type { AutomationDraft } from "./automation-draft";
import { AssigneeMenu } from "./dispatching";
import { Refusal, useRefusal } from "./refusal";
import { useSignals } from "./use-signals";

/**
 * The form to make or edit a subscription: choose the signal, then a prompt
 * for an agent, which starts a fresh conversation each firing, or a shell
 * command. Give it a draft already on a signal.
 */
export function SubscriptionForm({
	draft,
	submit,
	projects = [],
	project = "",
	onProject,
	onSubmit,
	onCancel,
}: {
	draft: AutomationDraft;
	submit: string;
	/** The projects it can belong to; the picker shows only with several. */
	projects?: string[];
	/** The project it belongs to. */
	project?: string;
	/** Picks the project; without it the project is fixed, as when editing. */
	onProject?: (project: string) => void;
	onSubmit: (trigger: Trigger, hook: Hook, name: string) => void;
	onCancel: () => void;
}): JSX.Element {
	const { signals } = useSignals();
	const { name, schedule, kind, pick, prompt, command } = useReactive(
		draft,
		(draft) => draft.fields,
		["changed"],
	);
	const { refusal, refuse } = useRefusal();
	const submitted = (form: FormEvent) => {
		form.preventDefault();
		try {
			const made = draft.made();
			onSubmit(made.trigger, made.hook, made.name);
		} catch (error) {
			refuse("Not saved", error);
		}
	};
	return (
		<form
			aria-label="subscription"
			onSubmit={submitted}
			className="flex flex-col gap-4"
		>
			<div className="flex flex-col gap-1.5">
				<label htmlFor="subscription-name" className="font-medium text-sm">
					Name
				</label>
				<Input
					id="subscription-name"
					placeholder="Name (optional)"
					value={name}
					onChange={(change) => draft.set("name", change.target.value)}
				/>
			</div>
			{projects.length > 1 && (
				<div className="flex flex-col gap-1.5">
					<label htmlFor="subscription-project" className="font-medium text-sm">
						Project
					</label>
					<select
						id="subscription-project"
						className="h-9 rounded-md border bg-background px-2 text-sm"
						value={project}
						disabled={onProject === undefined}
						onChange={(change) => onProject?.(change.target.value)}
					>
						{projects.map((each) => (
							<option key={each} value={each}>
								{each}
							</option>
						))}
					</select>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<label htmlFor="subscription-signal" className="font-medium text-sm">
					On signal
				</label>
				<Input
					id="subscription-signal"
					required
					list="subscription-signals"
					className="font-mono"
					placeholder='mdom.released or clock.in("2 days")'
					value={schedule}
					onChange={(change) => draft.set("schedule", change.target.value)}
				/>
			</div>
			<datalist id="subscription-signals">
				{signals.map((each) => (
					<option key={each.name} value={each.name} />
				))}
			</datalist>
			<fieldset className="flex flex-col gap-1.5">
				<legend className="mb-1.5 font-medium text-sm">Run</legend>
				<div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
					{(["agent", "run"] as const).map((each) => (
						<button
							key={each}
							type="button"
							aria-pressed={kind === each}
							className={cn(
								"h-9 rounded-md text-sm",
								kind === each && "bg-background shadow-sm",
							)}
							onClick={() => draft.set("kind", each)}
						>
							{each === "agent" ? "Prompt" : "Shell command"}
						</button>
					))}
				</div>
			</fieldset>
			{kind === "agent" ? (
				<>
					<Textarea
						aria-label="Prompt"
						required
						placeholder="What the agent is told, after what set it off"
						value={prompt}
						onChange={(change) => draft.set("prompt", change.target.value)}
					/>
					<div className="flex flex-col gap-1.5 text-sm">
						<span className="font-medium">Agent</span>
						<div>
							<AssigneeMenu
								assignee={pick}
								onPick={(picked) => draft.set("pick", picked)}
							/>
						</div>
					</div>
				</>
			) : (
				<Input
					aria-label="Command"
					required
					className="font-mono"
					placeholder="Run with sh -c in the project's main tree"
					value={command}
					onChange={(change) => draft.set("command", change.target.value)}
				/>
			)}
			<p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
				Each firing of a prompt starts a fresh conversation. If the signal's
				source is removed, this subscription pauses.
			</p>
			<Refusal refusal={refusal} />
			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit">{submit}</Button>
			</div>
		</form>
	);
}
