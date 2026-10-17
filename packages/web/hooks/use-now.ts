import { useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";

/** The clock, as epoch ms, moving `every` second, or as given, while `ticking`. */
export function useNow(ticking = true, every = Duration.secs(1)): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) {
			return;
		}
		setNow(Date.now());
		const tick = new SystemTimer().setInterval(() => setNow(Date.now()), every);
		return () => tick.dispose();
	}, [ticking, every.ms]);
	return now;
}
