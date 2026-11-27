import { Duration, SystemTimer, type Timer } from "core/time";
import { LoaderCircleIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { cn } from "#web/lib/utils.ts";

/** How long a write must be pending before the page shows it. */
export const PENDING_DELAY_MS = 150;

const SYSTEM_TIMER: Timer = new SystemTimer();

/** Timer `useShowPending` schedules its delay on; the system timer when unset. */
export const PendingTimerContext = createContext<Timer | null>(null);

/** Whether to show a pending write, once `pending` has held for `delay` ms. */
export function useShowPending(
	pending: boolean,
	delay: number = PENDING_DELAY_MS,
): boolean {
	const timer = useContext(PendingTimerContext) ?? SYSTEM_TIMER;
	const [shown, setShown] = useState(false);
	useEffect(() => {
		if (!pending) {
			setShown(false);
			return;
		}
		const waiting = timer.setTimeout(() => setShown(true), Duration.ms(delay));
		return () => waiting.dispose();
	}, [pending, delay, timer]);
	return pending && shown;
}

/**
 * Props for a row or card with a write pending: `aria-busy` at once, dimmed
 * and faded once `shown`; the row disables its own actions on `pending`, so
 * none repeats. Spread onto the row's root.
 */
export function pendingRow(
	pending: boolean,
	shown: boolean,
	className?: string,
): { "aria-busy": boolean; className: string } {
	return {
		"aria-busy": pending,
		className: cn(
			"transition-opacity duration-200",
			shown && "opacity-60",
			className,
		),
	};
}

/** A spinner for a button or menu item with a write pending, faded in with `shown`. */
export function PendingSpinner({
	shown,
	className,
}: {
	shown: boolean;
	className?: string;
}): JSX.Element {
	return (
		<LoaderCircleIcon
			aria-hidden
			className={cn(
				"animate-spin transition-opacity duration-200",
				shown ? "opacity-100" : "opacity-0",
				className,
			)}
		/>
	);
}

/**
 * Writes the page sends that no feed shows back, such as a button's request
 * to the server: each is pending under its `key` from the click until the
 * server answers. Callers disable the control on `pending(key)` so none
 * repeats; a refusal clears it, and rejects for the caller to say why.
 */
export function usePendingWrites(): {
	pending: (key?: string) => boolean;
	run: <T>(key: string, write: () => Promise<T>) => Promise<T>;
} {
	const [keys, setKeys] = useState<readonly string[]>([]);
	const run = useCallback(
		<T,>(key: string, write: () => Promise<T>): Promise<T> => {
			setKeys((held) => [...held, key]);
			return write().finally(() =>
				setKeys((held) => {
					const at = held.indexOf(key);
					return at < 0 ? held : held.toSpliced(at, 1);
				}),
			);
		},
		[],
	);
	const pending = (key?: string) =>
		key === undefined ? keys.length > 0 : keys.includes(key);
	return { pending, run };
}
