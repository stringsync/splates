import type { ReserveHold } from "@splates/server/auto-pick/browser";
import { type JSX, useEffect, useState } from "react";
import { readQuotaReserve } from "./api";

/** How often the page asks again which agent-queued tasks are held. */
const REFRESH_MS = 30_000;

/** The agent-queued tasks the queue holds for the quota reserve, by task id, kept fresh. */
export function useQuotaReserve(): Record<number, ReserveHold> {
	const [holds, setHolds] = useState<Record<number, ReserveHold>>({});
	useEffect(() => {
		let cancelled = false;
		const load = () =>
			void readQuotaReserve().then(
				(next) => {
					if (!cancelled) {
						setHolds(next);
					}
				},
				() => {},
			);
		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);
	return holds;
}

/** When the soonest window frees up, as "at 3:00 PM", or nothing when no window says. */
function freesAt(hold: ReserveHold): string {
	return hold.frees === null
		? ""
		: ` until a window resets at ${new Date(hold.frees).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** The hold line on a board card: "waiting: quota reserve". */
export function ReserveLine({ hold }: { hold: ReserveHold }): JSX.Element {
	return (
		<span
			className="text-warning"
			title={`Every agent it could go to has under ${Math.round(hold.reserve * 100)}% left in some plan window${freesAt(hold)}.`}
		>
			waiting: quota reserve
		</span>
	);
}

/** The banner on a held task's page: why it waits and what frees it. */
export function ReserveBanner({ hold }: { hold: ReserveHold }): JSX.Element {
	return (
		<section
			role="status"
			aria-label="Quota reserve"
			className="mb-3 flex flex-col gap-1.5 rounded-2xl border border-warning/40 px-4 py-3 text-sm"
		>
			<p>
				<span className="font-medium">Waiting: quota reserve.</span>{" "}
				<span className="text-muted-foreground">
					Every agent it could go to has under {Math.round(hold.reserve * 100)}%
					left in some plan window. It starts by itself once a window frees up
					{freesAt(hold)}.
				</span>
			</p>
			<ul aria-label="Agents" className="text-muted-foreground text-xs">
				{hold.agents.map((each) => (
					<li key={each.agent}>
						{each.agent}: {Math.round(each.left * 100)}% left in {each.window}
					</li>
				))}
			</ul>
		</section>
	);
}
