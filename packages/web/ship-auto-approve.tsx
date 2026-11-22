import { CheckCheckIcon } from "lucide-react";
import type { JSX } from "react";
import { Switch } from "./components/ui/switch";

/**
 * The Auto-approve card: whether the server answers every Yes/No prompt of
 * the ship by itself. Sign-in links and typed values still wait for the user.
 */
export function ShipAutoApprove({
	on,
	onOn,
	disabled = false,
}: {
	on: boolean;
	onOn: (on: boolean) => void;
	disabled?: boolean;
}): JSX.Element {
	return (
		<section
			aria-label="Auto-approve"
			className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-3"
		>
			<div className="flex items-center gap-2">
				<span className="flex flex-1 items-center gap-1.5 font-semibold text-sm">
					<CheckCheckIcon aria-hidden className="size-3.5" />
					Auto-approve Yes/No
				</span>
				<Switch
					aria-label="Auto-approve"
					checked={on}
					disabled={disabled}
					onCheckedChange={onOn}
				/>
			</div>
			<p className="text-muted-foreground text-xs">
				Answers every Yes/No prompt itself and logs it. Sign-in links and typed
				codes still wait for you.
			</p>
		</section>
	);
}
