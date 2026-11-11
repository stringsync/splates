import { expect, it } from "bun:test";
import { groupSources } from "./rec-groups";

const box = (name: string, project?: string) => ({
	kind: "docker" as const,
	name,
	...(project ? { project } : {}),
});

it("groups containers by project: the server's folder first, none last", () => {
	const groups = groupSources(
		[box("z-1", "zed"), box("lone"), box("m-1", "mono"), box("a-1", "alpha")],
		"mono",
	);
	expect(groups.map((group) => group.project)).toEqual([
		"mono",
		"alpha",
		"zed",
		"",
	]);
	expect(groups[0]?.sources.map((source) => source.name)).toEqual(["m-1"]);
});
