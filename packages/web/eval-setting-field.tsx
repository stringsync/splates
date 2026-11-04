import type { ComponentProps, JSX } from "react";

/** A labelled number input of the run card. */
export function SettingField({
	label,
	...input
}: { label: string } & ComponentProps<"input">): JSX.Element {
	return (
		<label className="flex flex-col gap-1 text-muted-foreground">
			{label}
			<input
				{...input}
				type="number"
				className="w-full rounded-md border bg-background px-2 py-1.5 text-foreground text-sm tabular-nums"
			/>
		</label>
	);
}
