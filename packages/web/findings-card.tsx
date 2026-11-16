import { makeAssistantDataUI } from "@assistant-ui/react";
import type { Findings } from "@splates/server/plans/browser";
import { ChartNoAxesColumnIcon } from "lucide-react";
import type { JSX } from "react";
import { InMessage } from "./card-reply";
import { CardShell } from "./card-shell";
import { blocksOf } from "./findings-blocks";
import { BlockView } from "./readouts";

/** Renders a `data-findings` part: the agent's `## 📊 Report:` as a card of readouts. */
export const FindingsUI = makeAssistantDataUI<{ findings: Findings }>({
	name: "findings",
	render: ({ data }) => (
		<InMessage>
			<FindingsCard findings={data.findings} />
		</InMessage>
	),
});

export function FindingsCard({
	findings,
}: {
	findings: Findings;
}): JSX.Element {
	const blocks = blocksOf(findings.body);
	return (
		<CardShell
			label={`report ${findings.subject}`.trim()}
			Icon={ChartNoAxesColumnIcon}
			title={
				findings.subject === "" ? "Report" : `Report · ${findings.subject}`
			}
		>
			<div className="flex flex-col divide-y">
				{blocks.map((block, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: the blocks are static text
						key={i}
						className="px-4 py-3 @max-md:px-3"
					>
						<BlockView block={block} lead={i === 0} />
					</div>
				))}
			</div>
		</CardShell>
	);
}
