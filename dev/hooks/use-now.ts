import { useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";

/** The clock, as epoch ms, moving each second while `ticking`. */
export function useNow(ticking = true): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) {
			return;
		}
		setNow(Date.now());
		const tick = new SystemTimer().setInterval(
			() => setNow(Date.now()),
			Duration.secs(1),
		);
		return () => tick.dispose();
	}, [ticking]);
	return now;
}
