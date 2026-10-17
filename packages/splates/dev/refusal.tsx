import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "#dev/lib/utils.ts";

/** How long a refused write says so beside the control that made it. */
const REFUSED_MS = 4000;

/** What to say of a write the server refused: what did not happen, and why. */
export function refusalOf(title: string, error: unknown): string {
	return `${title}: ${error instanceof Error ? error.message : String(error)}`;
}

/** Says, beside the control that made it, that a write was refused. */
export type Refuse = (title: string, error: unknown) => void;

/**
 * Refusals keyed by what was refused, each said for a moment beside it, so a
 * control that is gone by then, a card dropped or a menu closed, can still
 * say so on what it acted on.
 */
export function useRefusals<K>(): {
	refusals: ReadonlyMap<K, string>;
	refuse: (key: K, title: string, error: unknown) => void;
} {
	const [refusals, setRefusals] = useState<ReadonlyMap<K, string>>(
		() => new Map(),
	);
	const timers = useRef(new Map<K, ReturnType<typeof setTimeout>>());
	useEffect(() => {
		const all = timers.current;
		return () => {
			for (const timer of all.values()) {
				clearTimeout(timer);
			}
		};
	}, []);
	const refuse = useCallback((key: K, title: string, error: unknown) => {
		clearTimeout(timers.current.get(key));
		setRefusals((shown) => new Map(shown).set(key, refusalOf(title, error)));
		timers.current.set(
			key,
			setTimeout(() => {
				timers.current.delete(key);
				setRefusals((shown) => {
					const left = new Map(shown);
					left.delete(key);
					return left;
				});
			}, REFUSED_MS),
		);
	}, []);
	return { refusals, refuse };
}

/**
 * One control's refusal, said for a moment; `attempt` makes a write and says
 * whether it landed, refusing it as `failed` when it did not.
 */
export function useRefusal(): {
	refusal: string | null;
	refuse: Refuse;
	attempt: (write: Promise<void>, failed: string) => Promise<boolean>;
} {
	const { refusals, refuse: refuseKey } = useRefusals<null>();
	const refuse = useCallback(
		(title: string, error: unknown) => refuseKey(null, title, error),
		[refuseKey],
	);
	const attempt = useCallback(
		(write: Promise<void>, failed: string) =>
			write.then(
				() => true,
				(error: unknown) => {
					refuse(failed, error);
					return false;
				},
			),
		[refuse],
	);
	return { refusal: refusals.get(null) ?? null, refuse, attempt };
}

/** A refusal in a quiet line of its own, or nothing while there is none. */
export function Refusal({
	refusal,
	className,
}: {
	refusal: string | null | undefined;
	className?: string;
}): JSX.Element | null {
	if (!refusal) {
		return null;
	}
	return (
		<p role="alert" className={cn("text-destructive text-xs", className)}>
			{refusal}
		</p>
	);
}
