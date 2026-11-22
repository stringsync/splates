import type { SignalProbe } from "@splates/server/signals";
import { type FormEvent, type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import {
	type CheckForm,
	type CheckTest,
	saveCheck,
	testCheck,
} from "./api/signals";
import { Refusal, useRefusal } from "./refusal";
import { RouteTrail } from "./route-trail";
import { everyOf } from "./signal-of";
import { TopBar } from "./top-bar";

/** The form a probe's settings fill, or a blank one for a new check. */
export function checkFormOf(
	probe: SignalProbe | null,
	name: string,
): CheckForm {
	if (probe === null) {
		return { name, description: "", script: "", every: "5m", timeout: "6h" };
	}
	return {
		name: probe.name,
		description: probe.description,
		script: probe.script,
		every: everyOf(probe.everyMs),
		timeout: everyOf(
			Math.max(
				60_000,
				Date.parse(probe.deadline) - Date.parse(probe.startedAt),
			),
		),
	};
}

/**
 * The page that writes a signal's check: the command to run, how often and
 * for how long, and a Test button that runs it once without raising
 * anything. Saving starts the check, replacing the last one on the signal.
 */
export function SignalCheckForm({
	initial,
	isNew,
	onBack,
}: {
	initial: CheckForm;
	/** Whether the signal's name is still to be typed. */
	isNew: boolean;
	/** Goes back to the Signals list. */
	onBack: () => void;
}): JSX.Element {
	const [form, setForm] = useState(initial);
	const [tested, setTested] = useState<CheckTest | "testing" | null>(null);
	const { refusal, attempt, refuse } = useRefusal();
	const set = (field: keyof CheckForm, value: string) =>
		setForm((was) => ({ ...was, [field]: value }));
	const submit = (event: FormEvent) => {
		event.preventDefault();
		void attempt(saveCheck(form).then(onBack), "Not saved");
	};
	const test = () => {
		setTested("testing");
		testCheck(form.name, form.script)
			.then(setTested)
			.catch((error: unknown) => {
				setTested(null);
				refuse("Not tested", error);
			});
	};
	return (
		<section
			aria-label="signal poll script"
			className="flex min-w-0 flex-col gap-6"
		>
			<TopBar
				title={
					<RouteTrail
						items={[
							{ label: "Signals", onClick: onBack },
							{ label: isNew ? "New poll script" : form.name },
						]}
					/>
				}
			/>
			<form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="check-signal">Signal</FieldLabel>
						<Input
							id="check-signal"
							required
							readOnly={!isNew}
							placeholder="aws/stack-ready"
							value={form.name}
							onChange={(change) => set("name", change.target.value)}
						/>
						<FieldDescription>
							The name agents and automations wait on, as{" "}
							<code>project/name</code>. The project is where the command runs.
						</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor="check-description">
							What it waits for
						</FieldLabel>
						<Input
							id="check-description"
							required
							placeholder="The CloudFormation stack is up"
							value={form.description}
							onChange={(change) => set("description", change.target.value)}
						/>
						<FieldDescription>
							One line, shown on the signal's card.
						</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor="check-command">Command</FieldLabel>
						<Textarea
							id="check-command"
							required
							rows={4}
							className="font-mono text-[13px]"
							placeholder="aws cloudformation describe-stacks | grep CREATE_COMPLETE"
							value={form.script}
							onChange={(change) => set("script", change.target.value)}
						/>
						<FieldDescription>
							Run with <code>sh -c</code> in the project's main tree. Exit 0
							means the condition holds; any other exit means not yet. What it
							prints is sent as the signal's payload.
						</FieldDescription>
					</Field>
					<div className="grid gap-6 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor="check-every">Poll every</FieldLabel>
							<Input
								id="check-every"
								required
								placeholder="5m"
								value={form.every}
								onChange={(change) => set("every", change.target.value)}
							/>
							<FieldDescription>
								Seconds, minutes or hours: 30s, 5m, 1h. Not under 30s.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="check-timeout">Give up after</FieldLabel>
							<Input
								id="check-timeout"
								required
								placeholder="6h"
								value={form.timeout}
								onChange={(change) => set("timeout", change.target.value)}
							/>
							<FieldDescription>
								How long to keep checking: 30m, 6h, 1d. Seven days at most.
							</FieldDescription>
						</Field>
					</div>
				</FieldGroup>
				<p className="text-muted-foreground text-sm">
					It checks only while an agent or an automation waits on the signal,
					and fires it the first time a run passes.
				</p>
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={form.script.trim() === "" || tested === "testing"}
							onClick={test}
						>
							{tested === "testing" ? "Testing…" : "Test now"}
						</Button>
						<Button type="submit">Save and start</Button>
						<Button type="button" variant="ghost" onClick={onBack}>
							Cancel
						</Button>
					</div>
					{tested !== null && tested !== "testing" && (
						<pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs">
							{`exit ${tested.exit} (${(tested.ms / 1000).toFixed(1)}s) · ${tested.exit === 0 ? "would pass" : "would fail"}${tested.output === "" ? "" : `\n${tested.output}`}`}
						</pre>
					)}
					<Refusal refusal={refusal} />
				</div>
			</form>
		</section>
	);
}
