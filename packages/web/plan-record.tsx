import { useReactive } from "core/react";
import { CircleDotIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { PlanRecordController } from "./plan-record-controller";

/** A control on the dark around the plan, in either theme, as the lightbox's. */
const LIGHT = "text-white hover:bg-white/15 hover:text-white";

/**
 * Records a review of the plan: opens its page in rec's Chrome for the user to
 * narrate over, then offers the saved session's `#rec:<name>` reference for
 * the answer. Shows nothing while `rec` is not on the server's machine; the
 * press is the user's consent to start it.
 */
export function PlanRecord({
	url,
	open,
	onReference,
}: {
	/** The plan's page, as the server serves it. */
	url: string;
	open: boolean;
	/** Adds the saved session's reference to the answer. */
	onReference: (reference: string) => void;
}): JSX.Element | null {
	const [controller] = useState(() => new PlanRecordController());
	useEffect(() => () => controller.dispose(), [controller]);
	useEffect(() => {
		if (open) {
			controller.check();
		}
	}, [controller, open]);
	const { available, phase } = useReactive(
		controller,
		(each) => ({ available: each.available, phase: each.phase }),
		["changed"],
	);

	if (!available) {
		return null;
	}
	if (phase.at === "recording") {
		return (
			<Button
				size="sm"
				variant="ghost"
				className={LIGHT}
				title={`Stop recording ${phase.name}`}
				onClick={() => void controller.stop()}
			>
				<SquareIcon data-icon="inline-start" />
				Stop
			</Button>
		);
	}
	if (phase.at === "stopping") {
		return (
			<Button
				size="sm"
				variant="ghost"
				className={LIGHT}
				disabled
				title={`Saving ${phase.name}`}
			>
				<LoaderCircleIcon
					data-icon="inline-start"
					className="motion-safe:animate-spin"
				/>
				Stopping…
			</Button>
		);
	}
	if (phase.at === "saved") {
		return (
			<Button
				size="sm"
				variant="ghost"
				className={LIGHT}
				onClick={() => {
					const reference = controller.take();
					if (reference !== null) {
						onReference(reference);
					}
				}}
			>
				Saved {phase.name}: add #rec:{phase.name} to the answer
			</Button>
		);
	}
	return (
		<Button
			size="sm"
			variant="ghost"
			className={LIGHT}
			disabled={phase.at === "starting"}
			title={phase.at === "failed" ? phase.reason : undefined}
			aria-label={
				phase.at === "failed" ? "Record failed, retry" : "Record a review"
			}
			onClick={() =>
				void controller.start(new URL(url, window.location.origin).href)
			}
		>
			<CircleDotIcon data-icon="inline-start" />
			<span className="hidden sm:inline">
				{phase.at === "failed" ? "Record failed, retry" : "Record a review"}
			</span>
		</Button>
	);
}
