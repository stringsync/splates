import type { SetupProgress } from "@stringsync/splates-server/setup";
import { type JSX, useState } from "react";
import type { SetupOpen } from "./page-address";
import { HeldJourneys } from "./setup-held";
import { SetupPage } from "./setup-page";
import { SetupContext } from "./setup-state";

/**
 * The Setup page as the app wires it, the address held in state and the
 * journeys held beside it, for a test that reads `progress` as it settles.
 */
export function AppSetupPage({
	progress,
	settle,
}: {
	progress: SetupProgress;
	settle: (fresh: SetupProgress) => void;
}): JSX.Element {
	const [held] = useState(() => new HeldJourneys());
	const [open, setOpen] = useState<SetupOpen>({ area: null, step: null });
	return (
		<SetupContext
			value={{ progress, error: null, refresh: () => {}, settle, held }}
		>
			<SetupPage
				feed={null}
				onOpen={() => {}}
				todos={[]}
				open={open}
				onSetup={(area, step = null) => setOpen({ area, step })}
			/>
		</SetupContext>
	);
}
