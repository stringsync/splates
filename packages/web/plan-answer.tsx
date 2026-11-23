import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { Markdown } from "./markdown";

/** Keeps the plan visible until the person opens its question to answer. */
export function PlanAnswer({
	question,
	children,
	onBack,
}: {
	question: string;
	children: ReactNode;
	/** Closes the plan, back to the card's questions, which keep the answer. */
	onBack: () => void;
}) {
	return (
		<Collapsible>
			<CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<Markdown text={question} inline />
				<ChevronDownIcon className="size-4 shrink-0 transition-transform group-aria-expanded:rotate-180" />
			</CollapsibleTrigger>
			<CollapsibleContent>
				{children}
				<footer className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-card px-4 py-3">
					<Button
						size="sm"
						variant="default"
						onClick={onBack}
						// A block button on a phone, like the questions flow's Next.
						className="h-11 w-full md:h-8 md:w-auto"
					>
						<ArrowLeftIcon data-icon="inline-start" />
						Back to questions
					</Button>
				</footer>
			</CollapsibleContent>
		</Collapsible>
	);
}
