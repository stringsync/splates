/**
 * Names the areas of the code that `paths` touch, most paths first, for
 * chips beside a task's tags: `task-dialog.tsx` is `task dialog`, a file
 * in a package folder is that folder, a skill's files are `skill`, and
 * anything else is its top folder.
 */
export function areasOf(paths: readonly string[]): string[] {
	const counts = new Map<string, number>();
	for (const path of paths) {
		const area = areaOf(path);
		if (area !== null) {
			counts.set(area, (counts.get(area) ?? 0) + 1);
		}
	}
	return [...counts]
		.sort((one, two) => two[1] - one[1] || one[0].localeCompare(two[0]))
		.map(([area]) => area);
}

function areaOf(path: string): string | null {
	const parts = path.split("/").filter((part) => part !== "");
	if (parts.length === 0 || parts[parts.length - 1] === "SPLATES.md") {
		return null;
	}
	if (parts.length === 1) {
		return "root";
	}
	// <project>/skills/<skill>/...
	if (parts[1] === "skills") {
		return "skill";
	}
	// <project>/packages/<package>/<rest>
	if (parts[1] === "packages" && parts.length > 3) {
		const rest = parts.slice(3);
		return rest.length > 1 ? (rest[0] as string) : named(rest[0] as string);
	}
	return parts[0] as string;
}

/** `task-dialog.test.tsx` as `task dialog`. */
function named(file: string): string {
	return file.replace(/(\.test)?\.[^.]+$/, "").replace(/[-_]/g, " ");
}
