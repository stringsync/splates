import type { Stage, StageKey } from "@splates/server/ship";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { spentOn } from "./ship-slow";
import { span } from "./ship-stages";

/** A stage that has run past its expected time, as an agent is told of it. */
export type SlowStage = {
	id: string;
	project: string;
	stage: StageKey;
	spent: number;
	expected: number;
};

/** Says which step of a project is past its expected time, with a button that sends it to an agent while the ship goes on. */
export function SlowBar({
	cascade,
	project,
	slow,
	now,
	send,
}: {
	cascade: string;
	project: string;
	slow: Stage;
	now: number;
	send: (slow: SlowStage) => void;
}): JSX.Element {
	return (
		<div className="flex flex-wrap items-center gap-2 text-sm">
			<span className="text-amber-600 dark:text-amber-400">
				{slow.name} is past its {span(slow.expected)}
			</span>
			<Button
				size="xs"
				variant="outline"
				className="pointer-coarse:min-h-11"
				onClick={() =>
					send({
						id: cascade,
						project,
						stage: slow.key,
						spent: spentOn(slow, now) ?? slow.expected,
						expected: slow.expected,
					})
				}
			>
				Send to agent
			</Button>
		</div>
	);
}
