import { Credentials } from "webappwiz/creds";
import { AutoPickStore, JUDGE_CREDS, judgeFrom } from "../auto-pick";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** Jev's one key, which the judge step asks for. */
const TYPESAFE_KEY = JUDGE_CREDS.jev[0];

/**
 * Auto pick on this machine: a decision model to classify tasks, and the
 * person's rules from a task's kind and difficulty to an agent, model and
 * thinking level, with a dry run on a task to see them work.
 */
export const AUTO_PICK_AREA: SetupArea = autoPickArea();

function autoPickArea(): SetupArea {
	const judgeStep: SetupStep = {
		id: "auto-pick-judge",
		title: "Give Auto pick a decision model",
		why: "Auto pick asks a small decision model what kind of work a task is and how hard, to start it on the agent, model and thinking level your rules give that. Without one, every Auto pick takes your rule for any kind and difficulty.",
		user: `Create a TypeSafe API key and paste it here, for Jev. Clef on Cloudflare works too, with ${JUDGE_CREDS.clef.join(" and ")} kept for this device.`,
		agent: `Request it with \`splates creds request ${TYPESAFE_KEY} --device\`, with how to get it; or, for Clef, ${JUDGE_CREDS.clef.map((name) => `\`${name}\``).join(" and ")} the same way.`,
		optional: true,
		after: [],
		fields: [
			{
				kind: "cred",
				name: TYPESAFE_KEY,
				label: "TypeSafe API key",
				help: `Make one in [TypeSafe](https://typesafe.ai) under API keys. To use Clef instead, keep ${JUDGE_CREDS.clef.map((name) => `\`${name}\``).join(" and ")} for this device on the Creds page and leave this empty.`,
				optional: true,
			},
		],
		check: async ({ device }) =>
			(await judgeFrom(new Credentials([device]))) !== null,
		notDone: `Paste a TypeSafe API key, or keep ${JUDGE_CREDS.clef.join(" and ")} for this device, then press Next.`,
	};

	const rulesStep: SetupStep = {
		id: "auto-pick-rules",
		title: "Map tasks to models",
		why: "Auto pick tries your rules from the top, and the first that matches a task's kind and difficulty picks its agent; a pick whose plan is nearly used up is passed over for the next on its row.",
		user: "Edit the rules, then press Next to save them. They are kept in `~/.splates/auto-pick.json`, which you can edit by hand too.",
		agent:
			"Have the user edit the rules on the page, or edit `~/.splates/auto-pick.json` with them; its last rule must stay kind `*` and difficulty `*`.",
		optional: true,
		after: [],
		check: async (machine) => machine.fs.exists(rulesPath(machine)),
		// The page saves what its editor holds first; this keeps the defaults
		// when nothing was saved, so Next leaves a file to edit by hand.
		submit: async (machine) => {
			const store = new AutoPickStore(rulesPath(machine), { fs: machine.fs });
			if (!(await machine.fs.exists(store.path))) {
				await store.save(await store.rules());
			}
		},
		doing: "Saving your rules…",
	};

	const tryStep: SetupStep = {
		id: "auto-pick-try",
		title: "Try it on a task",
		why: "See what Auto pick would start a task on, and why, without starting it.",
		user: "Pick a task to see what Auto pick would do with it.",
		agent:
			"Have the user pick a task on the page; trying starts nothing and changes no task.",
		optional: true,
		after: [rulesStep],
		// A look, which sets nothing up of its own: done once there are rules to try.
		check: async (machine) => machine.fs.exists(rulesPath(machine)),
	};

	return {
		id: "auto-pick",
		title: "Auto pick",
		steps: [rulesStep, judgeStep, tryStep],
	};
}

/** Where this machine keeps its rules. */
function rulesPath({ home }: SetupMachine): string {
	return `${home}/auto-pick.json`;
}
