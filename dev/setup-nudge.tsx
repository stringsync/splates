import { ListChecksIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { seeSetup } from "./api";
import { SetupContext } from "./setup-state";

/**
 * A card at the foot of the nav pointing to Setup, on a machine no one has
 * opened it on yet, until it is opened or put off with Not now. Null
 * otherwise.
 */
export function SetupNudge({
	onOpen,
}: {
	onOpen: () => void;
}): JSX.Element | null {
	const { progress, settle } = useContext(SetupContext);
	if (progress === null || !progress.fresh || progress.next === null) {
		return null;
	}
	return (
		<aside
			aria-label="set up arbor"
			className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm"
		>
			<p className="flex items-center gap-2 font-medium">
				<ListChecksIcon className="size-4 text-primary" />
				Set up arbor on this machine
			</p>
			<p className="text-muted-foreground text-xs">
				A few steps, one at a time, each with why it matters.
			</p>
			<div className="flex gap-2">
				<Button size="sm" onClick={onOpen}>
					Open Setup
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="text-muted-foreground"
					onClick={() => seeSetup().then(settle, () => {})}
				>
					Not now
				</Button>
			</div>
		</aside>
	);
}
