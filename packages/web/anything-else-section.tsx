import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { CardBox } from "./card-box";
import type { Files } from "./files";
import { Markdown } from "./markdown";

/**
 * Shared "Anything else?" note section used at the bottom of questions cards
 * and as the feedback/note box on markdown Plan cards.
 */
export function AnythingElseSection({
	number,
	value,
	frozen = "",
	placeholder,
	stop,
	live,
	roomy = false,
	ruled = true,
	files,
	dictationOwner,
	onValue,
	onSubmit,
}: {
	number?: number;
	value: string;
	frozen?: string;
	placeholder: string;
	stop: string;
	live: boolean;
	roomy?: boolean;
	ruled?: boolean;
	files: Files | null;
	dictationOwner?: string;
	onValue: (next: string) => void;
	onSubmit?: () => void;
}): JSX.Element {
	return (
		<div
			data-more
			className={cn(
				"relative flex gap-3 px-4 py-4",
				ruled && "rule-t",
				live &&
					"transition-colors duration-150 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary before:opacity-0 before:transition-opacity before:duration-150 focus-within:bg-muted/40 focus-within:before:opacity-100",
			)}
		>
			{number !== undefined && (
				<span
					aria-hidden
					className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[11px] text-muted-foreground tabular-nums"
				>
					{number}
				</span>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<p className="font-medium text-sm leading-snug">Anything else?</p>
				{live ? (
					<CardBox
						roomy={roomy}
						dictationOwner={dictationOwner}
						data-stop={stop}
						aria-label="Anything else"
						value={value}
						placeholder={placeholder}
						onValue={onValue}
						files={files}
						onKeyDown={
							onSubmit === undefined
								? undefined
								: (event) => {
										// Enter sends, as in the composer; Shift+Enter is a new line.
										if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											onSubmit();
										}
									}
						}
						className={roomy ? "min-h-28" : "min-h-9 pointer-coarse:min-h-11"}
					/>
				) : (
					// What else the person said, as it was sent: its box, frozen.
					<fieldset
						aria-label="Anything else"
						className="min-w-0 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm"
					>
						<Markdown text={frozen} className="min-w-0" />
					</fieldset>
				)}
			</div>
		</div>
	);
}
