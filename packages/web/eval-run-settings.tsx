import type { JSX } from "react";
import type { RunChoice } from "./eval-plan-preview";
import { SettingField } from "./eval-setting-field";

/** Choose the repetitions and limits before reviewing an eval plan. */
export function EvalRunSettings({
	choice,
	onChange,
}: {
	choice: RunChoice;
	onChange: (choice: RunChoice) => void;
}): JSX.Element {
	return (
		<fieldset
			aria-label="run settings"
			className="grid grid-cols-3 gap-2 text-xs"
		>
			<SettingField
				label="Repetitions"
				aria-label="Run repetitions"
				min={1}
				step={1}
				value={choice.reps}
				onChange={(event) =>
					onChange({ ...choice, reps: Number(event.currentTarget.value) })
				}
			/>
			<SettingField
				label="Budget per conversation ($)"
				aria-label="Budget in dollars"
				min={0.01}
				step="any"
				value={choice.limits.usd}
				onChange={(event) =>
					onChange({
						...choice,
						limits: {
							...choice.limits,
							usd: Number(event.currentTarget.value),
						},
					})
				}
			/>
			<SettingField
				label="Max rounds"
				aria-label="Max rounds"
				min={1}
				step={1}
				value={choice.limits.rounds}
				onChange={(event) =>
					onChange({
						...choice,
						limits: {
							...choice.limits,
							rounds: Number(event.currentTarget.value),
						},
					})
				}
			/>
		</fieldset>
	);
}
