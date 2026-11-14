import type { CredRequest } from "@splates/server/creds";
import type { SetupProgress } from "@splates/server/setup";
import { WindowBackgroundObserver } from "core/browser";
import {
	createContext,
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { UpdateDot } from "./release";
import { setup } from "./setup-api";
import { HeldJourneys } from "./setup-held";

/** This machine's setup as the page last read it, and how to read it again. */
export interface SetupState {
	/** Null before the first read answers. */
	progress: SetupProgress | null;
	/** The last progress this device read, to show at once while `progress` is still null; stale until it answers. */
	cached: SetupProgress | null;
	/** Whether a read is under way. */
	reading: boolean;
	/** Why the last read failed, as when it timed out, or null. */
	error: string | null;
	/** Reads it again, as after "I did it". */
	refresh: () => void;
	/** Takes what a write answered with, so the page shows it at once. */
	settle: (progress: SetupProgress) => void;
	/** The journeys begun, which outlive the Setup page. */
	held: HeldJourneys;
}

/** What the Setup page reads. */
export const SetupContext = createContext<SetupState>({
	progress: null,
	cached: null,
	reading: false,
	error: null,
	refresh: () => {},
	settle: () => {},
	held: new HeldJourneys(),
});

/** How long the first read of setup yields to the page's other opening requests. */
const FIRST_READ_DELAY_MS = 1500;

/**
 * This machine's setup, read on load, again whenever `changed` does, and
 * again back in front, since a step may have been done in a terminal
 * meanwhile.
 */
export function useSetupState(_changed: unknown): SetupState {
	const [progress, setProgress] = useState<SetupProgress | null>(null);
	const [cached] = useState(readCache);
	const [reading, setReading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Only the newest read counts, so one that gives up late cannot undo a later one.
	const reads = useRef(0);
	const refresh = useCallback(() => {
		const read = ++reads.current;
		setError(null);
		setReading(true);
		// A failed read keeps what the last one showed, to be read and copied.
		setup().then(
			(fresh) => {
				if (read === reads.current) {
					setProgress(fresh);
					setReading(false);
					writeCache(fresh);
				}
			},
			(failed: unknown) => {
				if (read === reads.current) {
					setError(failed instanceof Error ? failed.message : String(failed));
					setReading(false);
				}
			},
		);
	}, []);
	// The first read waits a moment when a kept one is on show, so the open
	// conversation's requests go out before this slow one.
	const first = useRef(true);
	useEffect(() => {
		const hold = first.current && cached !== null;
		first.current = false;
		if (!hold) {
			refresh();
			return;
		}
		const timer = setTimeout(refresh, FIRST_READ_DELAY_MS);
		return () => clearTimeout(timer);
	}, [refresh, cached]);
	useEffect(() => {
		const observer = new WindowBackgroundObserver();
		observer.events.on("change", () => {
			if (!observer.isBackgrounded()) {
				refresh();
			}
		});
		return () => observer.dispose();
	}, [refresh]);
	const [held] = useState(() => new HeldJourneys());
	return {
		progress,
		cached,
		reading,
		error,
		refresh,
		settle: setProgress,
		held,
	};
}

const CACHE_KEY = "splates.setup-progress";

/** The progress the device last read, or null when none was kept or it no longer parses. */
function readCache(): SetupProgress | null {
	try {
		const kept = localStorage.getItem(CACHE_KEY);
		return kept === null ? null : (JSON.parse(kept) as SetupProgress);
	} catch {
		return null;
	}
}

/** Keeps `progress` for the next load; a full or blocked store just goes without. */
function writeCache(progress: SetupProgress): void {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(progress));
	} catch {}
}

/**
 * Give `children` this machine's setup. It is read again when `creds` move,
 * as when a step's secret is saved.
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

/**
 * A dot on Setup's nav entry while a step it needs, not an optional one, is
 * neither done nor skipped.
 */
export function SetupDot({ ring }: { ring: string }): ReactNode {
	const { progress } = useContext(SetupContext);
	return progress?.required ? (
		<span role="img" aria-label="setup unfinished">
			<UpdateDot ring={ring} />
		</span>
	) : null;
}
