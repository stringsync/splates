import { PackageIcon } from "lucide-react";
import type { JSX } from "react";
import { shipLine } from "./ship-activity";
import { useLiveShips } from "./use-live-ships";

/**
 * One line on where the ship stands, such as "webappwiz publishing" or
 * "waiting on your 2FA", for a ship card to show once allowed. Tapping it
 * opens that ship on the Ships page. Empty until the server first reports.
 */
export function ShipLine(): JSX.Element | null {
	const line = shipLine(useLiveShips());
	if (line === null) {
		return null;
	}
	return (
		<a
			href="#ships"
			title="Follow it on the Ships page"
			className="mx-4 mb-2 flex items-center gap-1.5 text-muted-foreground text-xs underline-offset-2 hover:underline"
		>
			<PackageIcon className="size-3.5" />
			<span role="status">{line}</span>
		</a>
	);
}
