import { ChevronLeftIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";

/** Back to the list of conversations, where there is no sidebar. */
export function Back({ onBack }: { onBack: () => void }): JSX.Element {
	return (
		<Button
			size="icon-sm"
			variant="ghost"
			aria-label="Back to conversations"
			onClick={onBack}
		>
			<ChevronLeftIcon />
		</Button>
	);
}
