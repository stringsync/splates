import { RotateCwIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import type { Behind, Release } from "../release";
import { short } from "./auto-restart";
import { useCheckpoint } from "./checkpoint";

/**
 * A button beside the project's name once a newer arbor is out, or once
 * commits have landed on the source `arbor dev` runs from, as Zed's Restart
 * to Update is, opening the Checkpoint dialog to checkpoint, restart onto it
 * and resume.
 */
export function ReleaseHint({
	release,
	behind,
}: {
	release: Release | null;
	behind: Behind | null;
}): JSX.Element {
	const { open } = useCheckpoint();
	return (
		<Button
			size="xs"
			variant="outline"
			title={
				behind !== null
					? `arbor's source is at ${short(behind.newest)} (this runs ${short(behind.running)})`
					: `arbor ${release?.newest} is out (this runs ${release?.running})`
			}
			onClick={() => open("resume")}
		>
			<RotateCwIcon data-icon="inline-start" />
			Restart to update
		</Button>
	);
}
