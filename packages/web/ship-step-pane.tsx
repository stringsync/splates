import type { RunState, StepState } from "@splates/server/ship";
import { XIcon } from "lucide-react";
import { createContext, type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { BackgroundOutput } from "./background-output";
import { Output } from "./background-pane";
import { PANE_WIDTH } from "./changes";
import { SHIP_BUS } from "./ship-run-bus";

/** A step of a ship run, by its run, target and id. */
export type ShipStepRef = {
	run: string;
	target: string;
	step: string;
	/** The step as it stood when opened, until the run says more. */
	initial: StepState;
};

/** Opens what a ship step printed in the pane beside the page; null where the page has no pane. */
export type WatchShipStepFn = (step: ShipStepRef) => void;
export const WatchShipStep = createContext<WatchShipStepFn | null>(null);

/** What a ship step printed, in the pane beside the page (the whole screen on a phone), following it while it runs. */
export function ShipStepPane({
	step: ref,
	phone,
	onClose,
}: {
	step: ShipStepRef;
	phone: boolean;
	onClose: () => void;
}): JSX.Element {
	const [step, setStep] = useState<StepState>(ref.initial);
	const [output] = useState(() => new BackgroundOutput(null));
	useEffect(() => () => output.dispose(), [output]);
	useEffect(
		() =>
			SHIP_BUS.on("run", ({ id, state }) => {
				const next = id === ref.run ? find(state, ref) : null;
				if (next !== null) {
					setStep(next);
				}
			}),
		[ref],
	);
	useEffect(() => output.show(step.output.join("\n")), [output, step]);
	useEffect(() => {
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [onClose]);
	return (
		<aside
			aria-label="ship step output"
			className={cn(
				"fixed z-40 flex flex-col gap-2 bg-background p-3",
				phone ? "inset-0" : cn("inset-y-0 right-0 border-l", PANE_WIDTH),
			)}
		>
			<header className="flex min-h-8 items-center gap-2">
				<h2 className="min-w-0 flex-1 break-words font-medium text-sm">
					{step.does}
				</h2>
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Close"
					title="Close (Escape)"
					onClick={onClose}
				>
					<XIcon />
				</Button>
			</header>
			<Output
				output={output}
				className="min-h-0 flex-1 overflow-hidden rounded-lg bg-[#0a0a0a] p-2"
			/>
		</aside>
	);
}

function find(run: RunState, ref: ShipStepRef): StepState | null {
	return (
		run.targets
			.find((each) => each.name === ref.target)
			?.steps.find((each) => each.id === ref.step) ?? null
	);
}
