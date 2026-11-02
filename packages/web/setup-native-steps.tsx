import type { StepProgress } from "@splates/server/setup";
import { type JSX, useEffect } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { useCopy } from "./card";
import type { SetupJourney } from "./setup-journey";
import type { StepBodies } from "./setup-steps";

/** The Claude, Codex and Kimi model pages: a checklist, every model ticked to start. */
export const NATIVE_STEPS: StepBodies = {
	"claude-signin": ({ step, journey }) => (
		<SignIn step={step} journey={journey} command="claude" />
	),
	"codex-signin": ({ step, journey }) => (
		<SignIn step={step} journey={journey} command="codex" />
	),
	"kimi-signin": ({ step, journey }) => (
		<SignIn step={step} journey={journey} command="kimi login" />
	),
	"claude-models": ({ step }) => <ModelChecklist step={step} />,
	"codex-models": ({ step }) => <ModelChecklist step={step} />,
	"kimi-models": ({ step }) => <ModelChecklist step={step} />,
};

function ModelChecklist({ step }: { step: StepProgress }): JSX.Element {
	return (
		<>
			{step.fields.map((field) => (
				<Field key={field.name} orientation="horizontal">
					<Switch id={field.name} name={field.name} defaultChecked />
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
				</Field>
			))}
		</>
	);
}

/** How often the sign-in page asks whether the person has signed in. */
const RECHECK_MS = 3_000;

/** The command to sign in with, to copy, with the page watching for the sign-in. */
function SignIn({
	step,
	journey,
	command,
}: {
	step: StepProgress;
	journey: SetupJourney;
	command: string;
}): JSX.Element {
	const { copied, copy } = useCopy();
	const done = step.status === "done";
	useEffect(() => {
		if (done) {
			return;
		}
		const timer = setInterval(() => void journey.recheck(), RECHECK_MS);
		return () => clearInterval(timer);
	}, [done, journey]);
	return (
		<>
			<p className="text-sm">
				Run this in a terminal and sign in. This page notices when you have.
			</p>
			<div className="flex items-center gap-2">
				<code className="rounded bg-muted px-2 py-1 text-sm">{command}</code>
				<Button type="button" variant="outline" onClick={() => copy(command)}>
					{copied.state === "copied" ? "Copied" : "Copy"}
				</Button>
			</div>
			{!done && (
				<p className="text-muted-foreground text-xs">Waiting for sign-in…</p>
			)}
		</>
	);
}
