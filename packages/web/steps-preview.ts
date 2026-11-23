import { useState } from "react";

/** A preview belongs to this view and closes when checklist progress moves. */
export function useStepPreview(
	done: number,
	count: number,
): [preview: number | null, toggle: (step: number) => void] {
	const [selected, setSelected] = useState<{
		step: number;
		done: number;
	} | null>(null);
	if (selected !== null && (selected.done !== done || selected.step >= count)) {
		setSelected(null);
		return [null, toggle];
	}
	return [selected?.step ?? null, toggle];

	function toggle(step: number): void {
		setSelected((previous) =>
			previous?.step === step ? null : { step, done },
		);
	}
}
