import {
	createContext,
	type JSX,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import { WindowBackgroundObserver } from "webappwiz/browser";
import type { CredRequest } from "../creds";
import type { SetupProgress } from "../setup";
import { setup } from "./api";

/** This machine's setup as the page last read it, and how to read it again. */
export interface SetupState {
	/** Null before the first read, and while the server does not answer. */
	progress: SetupProgress | null;
	/** Reads it again, as after "I did it". */
	refresh: () => void;
	/** Takes what a write answered with, so the page shows it at once. */
	settle: (progress: SetupProgress) => void;
}

/** What the nav's dot, the nudge and the Setup page read. */
export const SetupContext = createContext<SetupState>({
	progress: null,
	refresh: () => {},
	settle: () => {},
});

/**
 * This machine's setup, read on load, again whenever `changed` does, and
 * again back in front, since a step may have been done in a terminal
 * meanwhile.
 */
export function useSetupState(changed: unknown): SetupState {
	const [progress, setProgress] = useState<SetupProgress | null>(null);
	const refresh = useCallback(() => {
		setup().then(setProgress, () => setProgress(null));
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: read again whenever `changed` moves
	useEffect(refresh, [refresh, changed]);
	useEffect(() => {
		const observer = new WindowBackgroundObserver();
		observer.events.on("change", () => {
			if (!observer.isBackgrounded()) {
				refresh();
			}
		});
		return () => observer.dispose();
	}, [refresh]);
	return { progress, refresh, settle: setProgress };
}

/**
 * Gives `children` this machine's setup, read again as `creds` move, as when
 * one a step needs is saved, rather than on every snapshot, since each read
 * checks the device's store.
 */
export function SetupProvider({
	creds,
	children,
}: {
	creds: CredRequest[] | null;
	children: ReactNode;
}): JSX.Element {
	const state = useSetupState(JSON.stringify(creds));
	return <SetupContext value={state}>{children}</SetupContext>;
}
