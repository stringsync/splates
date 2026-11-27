import { CircleCheckIcon } from "lucide-react";
import type { JSX } from "react";
import { useShipRecapReady } from "./use-ships-waiting";

export function ShipRecapIndicator(): JSX.Element | null {
	const ready = useShipRecapReady();
	return ready ? (
		<CircleCheckIcon
			role="status"
			aria-label="Ship succeeded, recap unread"
			className="size-4 !text-success"
		/>
	) : null;
}
