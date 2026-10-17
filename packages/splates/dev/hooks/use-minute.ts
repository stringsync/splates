import { useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";

/** The clock, as epoch ms, moving each minute. */
export function useMinute(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const tick = new SystemTimer().setInterval(
			() => setNow(Date.now()),
			Duration.mins(1),
		);
		return () => tick.dispose();
	}, []);
	return now;
}
