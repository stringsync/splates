import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { type HiddenSignal, reviveSignal } from "./api/signals";
import { ago } from "./signal-of";

/**
 * The signals cleanup hid, folded under a "Hidden (n)" header, each with a
 * Revive that shows it again; `onRevived` runs after one is revived.
 */
export function HiddenSignals({
	hidden,
	onRevived,
	now = Date.now(),
}: {
	hidden: HiddenSignal[];
	onRevived: () => void;
	now?: number;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	if (hidden.length === 0) {
		return null;
	}
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
	return (
		<section
			aria-label="hidden signals"
			className="rounded-lg border bg-card text-card-foreground"
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex min-h-11 w-full items-center gap-2 px-4 text-left font-medium text-sm"
			>
				<Chevron className="size-4" />
				Hidden ({hidden.length})
				{open && (
					<span className="font-normal text-muted-foreground">
						revivable for 30 days
					</span>
				)}
			</button>
			{open && (
				<ul className="divide-y border-t">
					{hidden.map((each) => (
						<li
							key={each.name}
							className="flex items-center gap-3 px-4 py-2 text-sm"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate">{each.name}</span>
								<span className="block text-muted-foreground text-xs">
									hidden {ago(each.at, now)}
								</span>
							</span>
							<Button
								size="sm"
								variant="outline"
								className="h-11 sm:h-9"
								aria-label={`Revive ${each.name}`}
								onClick={() => {
									void reviveSignal(each.name).then(onRevived);
								}}
							>
								Revive
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
