import { CopyIcon } from "lucide-react";
import { Fragment, type JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { copiedLabel, useCopy } from "./card";
import { namespaceOf } from "./signal-summary";

/**
 * A signal's name as a one-line heading: its last part always whole, the
 * namespace before it shrinking to an ellipsis when the line is short, and a
 * tap opening the full name to read or copy.
 */
export function SignalTitle({ name }: { name: string }): JSX.Element {
	const { namespace, leaf } = namespaceOf(name);
	const { copied, copy } = useCopy();
	return (
		<Popover>
			<h2 className="flex min-w-0 font-mono font-semibold text-lg">
				<PopoverTrigger
					aria-label={`signal ${name}, show full name`}
					className="flex min-w-0 cursor-pointer items-baseline rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{namespace !== leaf && (
						<span className="min-w-0 truncate font-medium text-muted-foreground">
							{namespace}.
						</span>
					)}
					<span className="shrink-0">{leaf}</span>
				</PopoverTrigger>
			</h2>
			<PopoverContent
				align="start"
				className="flex w-auto max-w-[min(32rem,calc(100vw-2rem))] flex-row items-start gap-3"
			>
				<code className="min-w-0 py-1 font-mono text-sm">
					<DotBreaks text={name} />
				</code>
				<Button
					size="sm"
					variant="outline"
					className="shrink-0"
					onClick={() => copy(name)}
				>
					<CopyIcon /> {copiedLabel(copied, "Copy")}
				</Button>
			</PopoverContent>
		</Popover>
	);
}

/** `text` allowed to wrap only before a dot, never inside a part. */
function DotBreaks({ text }: { text: string }): JSX.Element {
	const parts = text.split(".");
	return (
		<>
			{parts.map((part, at) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: parts repeat and never reorder
				<Fragment key={at}>
					{at > 0 && <wbr />}
					<span className="inline-block max-w-full break-words">
						{at > 0 && "."}
						{part}
					</span>
				</Fragment>
			))}
		</>
	);
}
