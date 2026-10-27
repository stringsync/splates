import type { JSX } from "react";
import { useNow } from "./hooks/use-now";
import { span } from "./work";
import type { ReportTiming } from "./working-report-time";

/** The report header's clock. */
export function ReportAside({
	timing,
}: {
	timing: ReportTiming | undefined;
}): JSX.Element {
	return (
		<span className="inline-flex items-center gap-2">
			{timing !== undefined && <WorkingElapsed timing={timing} />}
		</span>
	);
}

/** Live until later agent words replace the working report. */
function WorkingElapsed({ timing }: { timing: ReportTiming }): JSX.Element {
	const now = useNow(timing.until === null);
	return (
		<span
			role="timer"
			aria-label="Elapsed time"
			title="Elapsed time"
			className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums"
		>
			{span(timing.at, timing.until ?? now)}
		</span>
	);
}
