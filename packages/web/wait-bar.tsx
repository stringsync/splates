import {
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { SignalBar } from "./signal-card";
import { ProbeCards, SignalSight, SignalWaits } from "./signal-contexts";
import { probeFor } from "./signal-of";

/**
 * Lets a thread's signal waits report which of them are on screen. Wrap the
 * thread and the wait bar in one; children render unchanged.
 * @internal
 */
export function WaitSight({ children }: { children: ReactNode }): JSX.Element {
	const [inView, setInView] = useState<ReadonlySet<string>>(new Set());
	const sight = useCallback((id: string, seen: boolean) => {
		setInView((was) => {
			if (was.has(id) === seen) {
				return was;
			}
			const next = new Set(was);
			if (seen) {
				next.add(id);
			} else {
				next.delete(id);
			}
			return next;
		});
	}, []);
	const value = useMemo(() => ({ inView, sight }), [inView, sight]);
	return <SignalSight value={value}>{children}</SignalSight>;
}

/**
 * The bar for the signal wait that ends first, placed above the composer.
 * Stays visible while waiting, including when its line shows in the thread.
 * @internal
 */
export function WaitBar(): JSX.Element | null {
	const { waits } = useContext(SignalWaits);
	const probes = useContext(ProbeCards);
	const out = waits
		.filter((each) => each.state === "waiting")
		.sort(
			(first, second) =>
				Date.parse(first.deadline) - Date.parse(second.deadline),
		);
	const [soonest] = out;
	if (soonest === undefined) {
		return null;
	}
	return (
		<aside aria-label="Waiting on a signal">
			<SignalBar
				more={out.length - 1}
				wait={soonest}
				probe={probeFor(soonest, probes)}
			/>
		</aside>
	);
}
