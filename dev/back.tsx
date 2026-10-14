import { ChevronLeftIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";

/**
 * Back to a list: the conversations by default, where there is no sidebar.
 */
export function Back({
	onBack,
	label = "Back to conversations",
}: {
	onBack: () => void;
	label?: string;
}): JSX.Element {
	return (
		<Button size="icon-sm" variant="ghost" aria-label={label} onClick={onBack}>
			<ChevronLeftIcon />
		</Button>
	);
}
