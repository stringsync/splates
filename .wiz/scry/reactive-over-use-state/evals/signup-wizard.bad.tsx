import { useState } from "react";

const steps = ["account", "profile", "confirm"] as const;

export function SignupWizard({ onDone }: { onDone: (form: SignupForm) => void }) {
	const [step, setStep] = useState(0);
	const [form, setForm] = useState<SignupForm>({ email: "", name: "" });
	const [errors, setErrors] = useState<string[]>([]);
	const [canAdvance, setCanAdvance] = useState(false);

	function update(next: SignupForm) {
		const problems = validate(steps[step], next);
		setForm(next);
		setErrors(problems);
		setCanAdvance(problems.length === 0);
	}

	function advance() {
		if (step === steps.length - 1) return onDone(form);
		setStep(step + 1);
		setCanAdvance(validate(steps[step + 1], form).length === 0);
	}

	return (
		<div>
			<StepFields step={steps[step]} form={form} onChange={update} />
			<ErrorList errors={errors} />
			<button disabled={!canAdvance} onClick={advance}>
				Next
			</button>
		</div>
	);
}
