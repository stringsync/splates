import type { Check } from "@evals/evals/scenario";
import { deliveredImages } from "./delivery";
import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

const aspect = "proposing";

/** Whether a run holds its final answer: a proposal block, not a line about what comes next. */
const proposed = (run: { reply: string }) =>
	/^## 💡 Proposed\b/m.test(run.reply);

const titled: Check = {
	id: "proposed",
	about: "the reply is a `## 💡 Proposed` block",
	test: ({ reply }) => /^## 💡 Proposed\b/m.test(reply),
};

const attached: Check = {
	id: "attached",
	about: "ran `splates attach` and embedded an attached image in the reply",
	test: ({ commands, reply }) =>
		commands.some((command) => /\bsplates["']?\s+attach\b/.test(command)) &&
		deliveredImages(reply).length > 0,
};

const notBuilt: Check = {
	id: "not-built",
	about: "never ran `splates merge`",
	test: ({ commands }) =>
		!commands.some((command) => /\bsplates\s+merge\b/.test(command)),
};

const uploadService = `export async function upload(file: Uint8Array): Promise<string> {
	const id = crypto.randomUUID();
	await store.put(id, file);
	await db.insert("uploads", { id, status: "stored" });
	await queue.send({ id });
	return id;
}
`;

const settingsPage = `<!doctype html>
<html>
	<body>
		<h1>Settings</h1>
		<label>Name <input name="name" /></label>
		<label>Email <input name="email" /></label>
		<button>Save</button>
	</body>
</html>
`;

/** A proposal shows its change in a picture, as the skill's Showing the change asks. */
export const scenarios: Scenario[] = [
	{
		id: `${aspect}/backend-diagram`,
		aspect,
		initialized: true,
		requirement:
			"A proposal for a backend change touching more than one service, table or flow carries a D2 diagram, rendered to SVG, screenshotted to a PNG and attached, as a before and after.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", uploadService);
			await repo.write(
				"src/worker.ts",
				"export async function work(job: { id: string }) {\n\tawait scan(job.id);\n\tawait db.update('uploads', job.id, { status: 'clean' });\n}\n",
			);
		},
		message:
			"What do you think about retrying failed upload scans, with a dead-letter queue and a new failures table the support team can read? Propose it, don't build it.",
		checks: [
			titled,
			{
				id: "d2-source",
				about: "wrote and rendered D2 source",
				test: ({ commands }) =>
					commands.some((command) => /\bd2\b|render-d2/.test(command)),
			},
			attached,
			notBuilt,
		],
		judge:
			"Does the proposal show the change as a diagram, with a Before of today's upload flow and an After of the proposed one, each labelled? Answer yes or no.",
		limits: { turns: 40, minutes: 20 },
		followUp: { turns: 3, done: proposed },
	},
	{
		id: `${aspect}/frontend-mockup`,
		aspect,
		initialized: true,
		requirement:
			"A proposal for a visible frontend change carries a lo-fi mock screenshot, built in a scratch directory, attached, with a real screenshot of today's screen as the before.",
		seed: async (repo) => {
			await repo.write("settings.html", settingsPage);
		},
		message:
			"What do you think about adding a theme picker with light, dark and system options to the settings screen? Propose it, don't build it.",
		checks: [
			titled,
			attached,
			{
				id: "kept-clean",
				about: "left the repo's files unchanged",
				test: async ({ repo }) =>
					(await repo.run(["git", "status", "--porcelain"])).trim() === "",
			},
			notBuilt,
		],
		judge:
			"Does the proposal carry two images, a Before of the current settings screen and an After that is a labelled mock of the theme picker? A screenshot of settings.html rendered in a browser counts as the Before, and an After mock of the whole page with the picker in it counts. Answer yes when both images are there, no when either is missing, and let your reason agree with that answer.",
		limits: { turns: 40, minutes: 20 },
		followUp: { turns: 3, done: proposed },
	},
	{
		id: `${aspect}/small-change-no-picture`,
		aspect,
		initialized: true,
		requirement:
			"A small change needs no picture: the proposal stays text and attaches nothing.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", uploadService);
		},
		message:
			"What do you think about renaming the `id` local in upload() to `uploadId`? Propose it, don't do it.",
		checks: [
			titled,
			{
				id: "no-image",
				about: "attached nothing and embedded no image",
				test: ({ commands, reply }) =>
					!commands.some((command) =>
						/\bsplates["']?\s+attach\b/.test(command),
					) && deliveredImages(reply).length === 0,
			},
			notBuilt,
		],
		limits: { turns: 20, minutes: 10 },
		followUp: { turns: 3, done: proposed },
	},
];

export const sandbox = splatesSandbox(scenarios);
