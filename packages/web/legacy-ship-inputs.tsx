import type { CommandInput, ShipInputs } from "@splates/server/legacy-ship";
import type { JSX } from "react";

/** The exact chosen values, also used when browsing a past ship. */
export function ShipInputSummary({
	inputs,
	values,
}: {
	inputs?: CommandInput[];
	values: ShipInputs;
}): JSX.Element {
	return (
		<dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-1 text-xs">
			{Object.entries(values).map(([name, value]) => (
				<div key={name} className="contents">
					<dt className="text-muted-foreground">
						{inputs?.find((input) => input.name === name)?.label ?? name}
					</dt>
					<dd className="whitespace-pre-wrap break-words text-right">
						{typeof value === "boolean"
							? value
								? "Yes"
								: "No"
							: value === ""
								? "(empty)"
								: value}
					</dd>
				</div>
			))}
		</dl>
	);
}
