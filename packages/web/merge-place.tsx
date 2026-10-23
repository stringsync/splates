/**
 * A queued merge's place in line for the premerge lock, as the page says it:
 * `next` for the first, else `2nd in line`, `3rd in line`, and so on.
 */
export function placeInLine(place: number): string {
	if (place <= 1) {
		return "next";
	}
	const tens = place % 100;
	const suffix =
		tens >= 11 && tens <= 13
			? "th"
			: place % 10 === 1
				? "st"
				: place % 10 === 2
					? "nd"
					: place % 10 === 3
						? "rd"
						: "th";
	return `${place}${suffix} in line`;
}
