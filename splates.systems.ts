import type { SystemsFile } from "@stringsync/splates/systems";

export default {
	models: {
		description: "Choosing agents and models",
		globs: [
			"packages/splates/models.ts",
			"packages/splates/roster.ts",
			"packages/splates/web/setting-controls.tsx",
		],
	},
	conversations: {
		description: "The agent conversations on the splates server page",
		aliases: ["conversation view"],
		globs: [
			"packages/splates/conversations*.ts",
			"packages/splates/web/conversation*.ts*",
			"packages/splates/web/work*.ts*",
			"packages/splates/web/app-conversation*.test.tsx",
		],
	},
	composer: {
		description: "Writing a message, with its # and @ references",
		aliases: ["mentions"],
		globs: [
			"packages/splates/web/composing.tsx",
			"packages/splates/web/mentions.tsx",
			"packages/splates/web/references.tsx",
			"packages/splates/web/directives.tsx",
			"packages/splates/web/app-mentions.test.tsx",
		],
	},
	setup: {
		description: "Setting splates up on a machine",
		globs: [
			"packages/splates/setup*.ts",
			"packages/splates/dev-setup*.ts",
			"packages/splates/splates-setup.ts",
			"packages/splates/web/setup-*.ts*",
			"packages/splates/web/app-setup.test.tsx",
			"packages/splates/review/setup-forms*",
		],
	},
	checkpoint: {
		description: "Restarting splates server without losing agents' work",
		aliases: ["restart"],
		globs: [
			"packages/splates/web/checkpoint.tsx",
			"packages/splates/web/auto-restart*.ts*",
		],
	},
	board: {
		description: "Todos and the lanes they sit in",
		aliases: ["todos", "lanes"],
		globs: [
			"packages/splates/todo*.ts",
			"packages/splates/lane*.ts",
			"packages/splates/web/todo*.ts*",
			"packages/splates/web/lanes.tsx",
			"packages/splates/web/board.ts",
			"packages/splates/web/app-todo*.test.tsx",
			"packages/splates/web/app-lanes.test.tsx",
		],
	},
	mobile: {
		description: "splates server's phone layout",
		aliases: ["phone"],
		globs: [
			"packages/splates/web/phone-*.tsx",
			"packages/splates/web/app-phone.test.tsx",
		],
	},
	annotation: {
		description: "Marking up a screenshot for an agent",
		globs: [
			"packages/splates/web/annotation.ts",
			"packages/splates/web/annotation.test.ts",
			"packages/splates/web/annotate.tsx",
		],
	},
	dictate: {
		description: "Speaking a message instead of typing it",
		aliases: ["dictation"],
		globs: [
			"packages/splates/dev-dictation*.ts",
			"packages/splates/dev-transcriber.ts",
			"packages/splates/vocabulary*.ts",
			"packages/splates/web/dictat*.ts*",
			"packages/splates/web/take-under-way.ts",
			"packages/splates/web/app-conversation-dictation.test.tsx",
		],
	},
	merge: {
		description: "Landing a task on trunk",
		globs: ["packages/splates/merge.ts", "packages/splates/merge.test.ts"],
	},
	skills: {
		description: "The skills agents read",
		globs: ["skills/**"],
	},
} satisfies SystemsFile;
