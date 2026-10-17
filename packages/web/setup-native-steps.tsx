import type { StepProgress } from "@stringsync/splates/setup";
import type { JSX } from "react";
import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import type { StepBodies } from "./setup-steps";

/** The Claude and Codex model pages: a checklist, every model ticked to start. */
export const NATIVE_STEPS: StepBodies = {
	"claude-models": ({ step }) => <ModelChecklist step={step} />,
	"codex-models": ({ step }) => <ModelChecklist step={step} />,
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
