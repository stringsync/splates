import { join, relative } from "node:path";
import type { Scenario } from "../scenario";

/** Whether a reply embeds an absolute image path outside fenced code. */
export function deliveredImages(text: string): string[] {
	return [
		...text
			.replace(/```[\s\S]*?```/g, "")
			.matchAll(/!\[[^\]]*\]\(<?(\/[^\n)>]+)>?\)/g),
	].map((match) => match[1] as string);
}

/** Delivery matters even when the agent already inspected the screenshot. */
export const scenarios: Scenario[] = [
	{
		id: "delivery/screenshot",
		aspect: "delivery",
		initialized: true,
		requirement:
			"Attach screenshots, embed the returned stored path in the reply, and keep the same image under task Verification. Tool previews and plain paths are insufficient.",
		async change(repo) {
			await repo.run([
				"splates",
				"add",
				"screenshot",
				"--goal",
				"Review the captured screenshot",
			]);
			const tree = (await repo.run(["splates", "path", "screenshot"])).trim();
			await repo.write(
				relative(repo.dir, join(tree, "capture.base64")),
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
			);
			await repo.run([
				"bun",
				"-e",
				`await Bun.write(${JSON.stringify(join(tree, "capture.png"))}, Buffer.from(await Bun.file(${JSON.stringify(join(tree, "capture.base64"))}).text(), "base64"))`,
			]);
		},
		message:
			"The screenshot task already has capture.png in its worktree. Show me that capture and keep it with the task evidence. Leave the task open for my review; do not merge or remove it.",
		checks: [
			{
				id: "attached-inline",
				about: "reply embeds a stored screenshot whose path attach returned",
				test: ({ reply, transcript }) =>
					deliveredImages(reply).some((path) =>
						transcript.some(
							(step) =>
								step.kind === "tool" &&
								/attached \d+ file/.test(step.output ?? "") &&
								step.output?.includes(path),
						),
					),
			},
			{
				id: "task-evidence",
				about:
					"task Verification embeds the same stored screenshot as the reply",
				async test({ repo, reply }) {
					const plan = await repo.run(["splates", "show", "screenshot"]);
					const verification =
						plan.split("## Verification")[1]?.split(/\n## /)[0] ?? "";
					return deliveredImages(reply).some((path) =>
						deliveredImages(verification).includes(path),
					);
				},
			},
		],
	},
];
