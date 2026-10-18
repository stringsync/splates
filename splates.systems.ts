import type { SystemsFile } from "@stringsync/splates-server/systems";

export default {
	models: {
		description: "Choosing agents and models",
		globs: [
			"packages/server/models.ts",
			"packages/server/roster.ts",
			"packages/web/setting-controls.tsx",
		],
	},
	conversations: {
		description: "The agent conversations on the splates server page",
		aliases: ["conversation view", "sidebar"],
		globs: [
			"packages/server/conversations/**",
			"packages/web/conversation*.ts*",
			"packages/web/sidebar*.tsx",
			"packages/web/work*.ts*",
			"packages/web/app-conversation*.test.tsx",
		],
	},
	composer: {
		description: "Writing a message, with its # and @ references",
		aliases: ["mentions"],
		globs: [
			"packages/web/composing.tsx",
			"packages/web/mentions.tsx",
			"packages/web/references.tsx",
			"packages/web/directives.tsx",
			"packages/web/app-mentions.test.tsx",
		],
	},
	setup: {
		description: "Setting splates up on a machine",
		globs: [
			"packages/server/setup*.ts",
			"packages/server/dev-setup*.ts",
			"packages/splates/setup.ts",
			"packages/web/setup-*.ts*",
			"packages/web/app-setup.test.tsx",
			"packages/web/review/setup-forms*",
		],
	},
	checkpoint: {
		description: "Restarting splates server without losing agents' work",
		aliases: ["restart"],
		globs: ["packages/web/checkpoint.tsx", "packages/web/auto-restart*.ts*"],
	},
	board: {
		description: "Todos and the lanes they sit in",
		aliases: ["todos", "lanes"],
		globs: [
			"packages/server/todo*.ts",
			"packages/server/lane*.ts",
			"packages/web/todo*.ts*",
			"packages/web/lanes.tsx",
			"packages/web/board.ts",
			"packages/web/app-todo*.test.tsx",
			"packages/web/app-lanes.test.tsx",
		],
	},
	mobile: {
		description: "splates server's phone layout",
		aliases: ["phone"],
		globs: ["packages/web/phone-*.tsx", "packages/web/app-phone.test.tsx"],
	},
	annotation: {
		description: "Marking up a screenshot for an agent",
		globs: [
			"packages/web/annotation.ts",
			"packages/web/annotation.test.ts",
			"packages/web/annotate.tsx",
		],
	},
	dictate: {
		description: "Speaking a message instead of typing it",
		aliases: ["dictation"],
		globs: [
			"packages/server/dev-dictation*.ts",
			"packages/server/dev-transcriber.ts",
			"packages/server/vocabulary*.ts",
			"packages/web/dictat*.ts*",
			"packages/web/take-under-way.ts",
			"packages/web/app-conversation-dictation.test.tsx",
		],
	},
	merge: {
		description: "Landing a task on trunk",
		globs: ["packages/server/merge.ts", "packages/server/merge.test.ts"],
	},
	skills: {
		description: "The skills agents read",
		globs: ["skills/**"],
	},
	everywhere: {
		description: "Every project's work on one page",
		globs: [
			"packages/server/dev-everywhere*.ts",
			"packages/server/everywhere.ts",
			"packages/web/everywhere-*.ts",
			"packages/web/project-folder*.ts*",
		],
	},
	tasks: {
		description: "The Tasks page",
		globs: ["packages/web/tasks*.tsx", "packages/web/app-tasks*.test.tsx"],
	},
} satisfies SystemsFile;
