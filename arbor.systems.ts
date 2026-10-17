import type { SystemsFile } from "./systems";

export default {
	models: {
		description: "Choosing agents and models",
		globs: ["models.ts", "roster.ts", "dev/setting-controls.tsx"],
	},
	conversations: {
		description: "The agent conversations on the arbor dev page",
		aliases: ["conversation view"],
		globs: [
			"conversations*.ts",
			"dev/conversation*.ts*",
			"dev/work*.ts*",
			"dev/app-conversation*.test.tsx",
		],
	},
	composer: {
		description: "Writing a message, with its # and @ references",
		aliases: ["mentions"],
		globs: [
			"dev/composing.tsx",
			"dev/mentions.tsx",
			"dev/references.tsx",
			"dev/directives.tsx",
			"dev/app-mentions.test.tsx",
		],
	},
	checkpoint: {
		description: "Restarting arbor dev without losing agents' work",
		aliases: ["restart"],
		globs: ["dev/checkpoint.tsx", "dev/auto-restart*.ts*"],
	},
	board: {
		description: "Todos and the lanes they sit in",
		aliases: ["todos", "lanes"],
		globs: [
			"todo*.ts",
			"lane*.ts",
			"dev/todo*.ts*",
			"dev/lanes.tsx",
			"dev/board.ts",
			"dev/app-todo*.test.tsx",
			"dev/app-lanes.test.tsx",
		],
	},
	mobile: {
		description: "arbor dev's phone layout",
		aliases: ["phone"],
		globs: ["dev/phone-*.tsx", "dev/app-phone.test.tsx"],
	},
	annotation: {
		description: "Marking up a screenshot for an agent",
		globs: ["dev/annotation.ts", "dev/annotation.test.ts", "dev/annotate.tsx"],
	},
	dictate: {
		description: "Speaking a message instead of typing it",
		aliases: ["dictation"],
		globs: [
			"dev-dictation*.ts",
			"dev-transcriber.ts",
			"vocabulary*.ts",
			"dev/dictat*.ts*",
			"dev/take-under-way.ts",
			"dev/app-conversation-dictation.test.tsx",
		],
	},
	merge: {
		description: "Landing a task on trunk",
		globs: ["merge.ts", "merge.test.ts"],
	},
	skills: {
		description: "The skills agents read",
		globs: ["skills/**"],
	},
} satisfies SystemsFile;
