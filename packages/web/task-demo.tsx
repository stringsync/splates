import type { DemoPoint } from "@stringsync/splates-server/plans/browser";
import { PlayIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { DialogClose } from "#web/components/ui/dialog.tsx";
import { Dispatching } from "./dispatching";
import { HEADING } from "./markdown";

/** The points a demo shows a task at, as its buttons name them. */
const POINTS: { point: DemoPoint; label: string }[] = [
	{ point: "before", label: "Before" },
	{ point: "after", label: "After" },
	{ point: "main", label: "Main" },
];

/**
 * Before, After and Main: each starts a conversation that demos `task` at
 * that point and opens it, closing the dialog. None while the page holds no
 * conversations.
 */
export function DemoButtons({ task }: { task: string }): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	const show = (point: DemoPoint) => {
		void context.dispatch.demo(task, point).then(context.open);
	};
	return (
		<section aria-label="demo" className="flex min-w-0 flex-col gap-1">
			<h2 className={HEADING}>Demo</h2>
			<div className="flex flex-wrap gap-1.5">
				{POINTS.map(({ point, label }) => (
					<DialogClose
						key={point}
						render={
							<Button
								size="sm"
								variant="outline"
								aria-label={`Demo ${label.toLowerCase()}`}
								onClick={() => show(point)}
							/>
						}
					>
						<PlayIcon />
						{label}
					</DialogClose>
				))}
			</div>
		</section>
	);
}
