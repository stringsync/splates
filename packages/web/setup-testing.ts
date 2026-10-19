import type {
	SetupProgress,
	StepProgress,
} from "@stringsync/splates-server/setup";

/** Two areas, agents required and dictation optional, as the server reads them. */
export function setupProgress({
	next = "agents",
	required = true,
	fresh = false,
	agents = "ready",
	dictation = "ready",
}: {
	next?: string | null;
	required?: boolean;
	fresh?: boolean;
	agents?: StepProgress["status"];
	dictation?: StepProgress["status"];
} = {}): SetupProgress {
	const agentsStep: StepProgress = {
		id: "agents",
		title: "Choose the agents splates starts",
		why: "Only agents on the roster start.",
		user: "Say which agents you have.",
		agent: "Run `splates agents`.",
		optional: false,
		after: [],
		status: agents,
		problem: null,
		cred: null,
		fields: [],
		doing: null,
		detail: null,
		data: null,
	};
	const dictationStep: StepProgress = {
		id: "dictation",
		title: "Dictate prompts",
		why: "The mic transcribes on your key.",
		user: "Paste an OpenAI key.",
		agent: "Request the key.",
		optional: true,
		after: [],
		status: dictation,
		problem: null,
		cred: "OPENAI_API_KEY",
		fields: [
			{
				kind: "cred",
				name: "OPENAI_API_KEY",
				label: "OpenAI API key",
				help: null,
				saved: false,
			},
		],
		doing: null,
		detail: null,
		data: null,
	};
	const area = (id: string, title: string, step: StepProgress) => ({
		id,
		title,
		done: step.status === "done" ? 1 : 0,
		skipped: step.status === "skipped" ? 1 : 0,
		left: step.status === "ready" || step.status === "waiting" ? 1 : 0,
		steps: [step],
	});
	return {
		areas: [
			area("agents", "Agents", agentsStep),
			area("dictation", "Dictation", dictationStep),
		],
		next,
		fresh,
		required,
	};
}
