/** Choose a named badge color from this palette, or use `projectColor` for the automatic choice. */
export const PROJECT_COLORS = {
	blue: "#2563eb",
	teal: "#0f766e",
	green: "#15803d",
	amber: "#92400e",
	orange: "#c2410c",
	rose: "#be123c",
	purple: "#7e22ce",
	slate: "#475569",
} as const;

export type ProjectColor = keyof typeof PROJECT_COLORS;

/** Whether a saved or submitted color belongs to the project palette. */
export function isProjectColor(value: unknown): value is ProjectColor {
	return typeof value === "string" && Object.hasOwn(PROJECT_COLORS, value);
}

/** A project's explicit color, or a stable default from its slug, independent of list order. */
export function projectColor(slug: string, color?: ProjectColor): ProjectColor {
	if (isProjectColor(color)) {
		return color;
	}
	let hash = 0;
	for (const letter of slug) {
		hash = (Math.imul(hash, 31) + (letter.codePointAt(0) ?? 0)) >>> 0;
	}
	const colors = Object.keys(PROJECT_COLORS) as ProjectColor[];
	return colors[hash % colors.length] as ProjectColor;
}
