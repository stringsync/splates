import type { AutoRestartServer } from "./auto-restart";
import type { ProjectConversation, Projects } from "./project-api";

/** An `arbor dev` whose projects a test sets, which restarts when asked. */
export class FakeServer implements AutoRestartServer {
	listed: Projects = {
		projects: [here()],
		servers: [],
		restarting: null,
		restarted: null,
		run: "run-1",
		running: "0.0.43",
		newest: null,
		behind: { running: "a".repeat(40), newest: "b".repeat(40) },
		restartable: true,
		held: [],
	};
	restarts = 0;
	down = false;
	refuses = false;

	async list(): Promise<Projects> {
		if (this.down) {
			throw new TypeError("no server");
		}
		return this.listed;
	}

	async restart(): Promise<void> {
		if (this.refuses) {
			throw new Error("agents are at work");
		}
		this.restarts += 1;
		this.down = true;
	}

	/** Puts one agent at work, or none, one on a worker when it `survives` a restart. */
	working(on: boolean, survives = false): void {
		this.listed = {
			...this.listed,
			projects: [
				here(
					on
						? [
								{
									id: "c1",
									name: "c1",
									status: "running",
									checkpoint: null,
									survives,
								},
							]
						: [],
				),
			],
		};
	}
}

/** This project, with `conversations` live in it. */
const here = (conversations: ProjectConversation[] = []) => ({
	slug: "repo",
	root: "/repo",
	gone: false,
	focused: true,
	conversations,
	waiting: 0,
});
