import { useEffect, useRef, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import type { Needing } from "../needs";
import { Notifier } from "./notifier";
import type { Settings } from "./settings";

/**
 * Notifies the person, as `settings` say (of nothing when null), of what `rows`, named by `name`,
 * did since the last look, each opening its row with `open`: looked at again
 * as they change, and every half minute for the ones that go quiet.
 */
export function useNotifier(
	settings: Settings | null,
	rows: Needing[],
	name: (row: Needing) => string,
	open: (row: Needing) => void,
): void {
	const [notifier] = useState(() => settings && new Notifier(settings));
	const look = useRef(() => {});
	look.current = () =>
		notifier?.show(notifier.look(rows, name, Date.now()), open);
	useEffect(() => look.current());
	useEffect(() => {
		const tick = new SystemTimer().setInterval(
			() => look.current(),
			Duration.secs(30),
		);
		return () => tick.dispose();
	}, []);
}
