import { AutoRunStore } from "../queue";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** The queue queuing each ready task itself, which only the person turns on. */
export const AUTO_RUN_AREA: SetupArea = autoRunArea();

function autoRunArea(): SetupArea {
	const step: SetupStep = {
		id: "auto-run",
		title: "Queue ready tasks automatically",
		why: "With auto-run on, each ready task nothing blocks goes into the queue by itself, and a worker starts it within `splates budget`. A task you take out of the queue stays in ready. Off until you turn it on.",
		user: "Say yes to have ready tasks queued for you, or skip to keep queuing them by hand.",
		agent:
			"Only the person turns this on: have them answer on the page, and never run `splates queue auto-run` yourself.",
		optional: true,
		after: [],
		fields: [
			{
				kind: "yes-no",
				name: "on",
				label: "Queue each ready task by itself",
			},
		],
		check: async (machine) => store(machine).on(),
		submit: async (machine, answers) => {
			await store(machine).set(answers.on === true);
		},
		notDone: "Say yes to turn auto-run on, or skip this step.",
		undo: {
			removes: async () => ["Your auto-run choice in `auto-run.json`"],
			run: (machine) => store(machine).remove(),
		},
	};
	return { id: "auto-run", title: "Auto-run", steps: [step] };
}

function store({ home, fs }: SetupMachine): AutoRunStore {
	return new AutoRunStore(`${home}/auto-run.json`, { fs });
}
