import type { Resource } from "core/disposable";
import type { Child, Ps } from "core/system";
import { Duration, sleep } from "core/time";
import { parseStamp } from "./sources";

export interface Container {
	id: string;
	name: string;
	/** Its Compose project, when it has one. */
	project: string;
}

const FORMAT = '{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}';

/** The running containers, as `docker ps` lists them. */
export async function listContainers(ps: Ps): Promise<Container[]> {
	const result = await ps
		.spawnCapture(["docker", "ps", "--format", FORMAT])
		.catch(() => undefined);
	if (result?.exitCode !== 0) {
		throw new Error(
			`docker is not available: ${result?.stderr.trim() || "it could not run"}`,
		);
	}
	return parseContainers(result.stdout);
}

export function parseContainers(text: string): Container[] {
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [id = "", name = "", project = ""] = line.split("\t");
			return { id, name, project };
		});
}

/** The name Compose gives a project that lives in `cwd`. */
export function composeProject(cwd: string): string {
	return (cwd.split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/**
 * Which containers `--docker` means: those named by id prefix or name, or for
 * a bare flag the Compose project of the working directory, else every one.
 */
export function selectContainers(
	all: Container[],
	value: string,
	cwd: string,
): Container[] {
	if (value === "true" || value === "") {
		const project = composeProject(cwd);
		const mine = all.filter((box) => box.project === project);
		return mine.length > 0 ? mine : all;
	}
	const wanted = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	for (const want of wanted) {
		if (!all.some((box) => box.name === want || box.id.startsWith(want))) {
			throw new Error(`--docker: no running container ${want}`);
		}
	}
	return all.filter((box) =>
		wanted.some((want) => box.name === want || box.id.startsWith(want)),
	);
}

export type FollowState = "following" | "stopped" | "unavailable";

export interface FollowOptions {
	ps: Ps;
	container: Container;
	/** Arrival time for a line docker gave no time to. */
	now: () => number;
	onLine: (at: number, text: string) => void;
	/** Called whenever the container starts being followed, dies, or docker cannot be asked. */
	onState?: (state: FollowState) => void;
	/** How long to wait before looking at a gone container again. */
	retry?: Duration;
}

/** Whether a container is running, by name, so a recreated one under the same name counts. */
async function containerState(
	ps: Ps,
	name: string,
): Promise<"running" | FollowState> {
	try {
		const result = await ps.spawnCapture([
			"docker",
			"inspect",
			"-f",
			"{{.State.Running}}",
			name,
		]);
		if (result.exitCode === 0) {
			return result.stdout.trim() === "true" ? "running" : "stopped";
		}
		// A container that is gone is stopped; a daemon that does not answer is unavailable.
		return /no such/i.test(result.stderr) ? "stopped" : "unavailable";
	} catch {
		return "unavailable";
	}
}

/**
 * Follows one container with `docker logs -f --timestamps`, stdout and stderr
 * both. It never throws and never ends on its own: when the container dies, or
 * docker stops answering, it writes a marker line, waits, and picks up from the
 * last line seen once the container runs again.
 */
export function followContainer(options: FollowOptions): Resource {
	const { ps, container, now, onLine, onState } = options;
	const retry = options.retry ?? Duration.ms(2000);
	let disposed = false;
	let child: Child | undefined;
	let since = now();
	const pump = async (stream: ReadableStream<Uint8Array>) => {
		const decoder = new TextDecoder();
		let pending = "";
		try {
			for await (const chunk of stream) {
				const lines = (pending + decoder.decode(chunk, { stream: true })).split(
					"\n",
				);
				pending = lines.pop() ?? "";
				for (const line of lines) {
					if (line) {
						const stamp = parseStamp(line);
						const at = stamp?.at ?? now();
						since = Math.max(since, at + 1);
						onLine(at, stamp?.rest ?? line);
					}
				}
			}
		} catch {
			// The container went away.
		}
	};
	const note = (text: string) =>
		onLine(now(), `[rec] ${container.name} ${text}`);
	void (async () => {
		while (!disposed) {
			try {
				child = ps.start([
					"docker",
					"logs",
					"-f",
					"--timestamps",
					"--since",
					new Date(since).toISOString(),
					container.name,
				]);
				onState?.("following");
				await Promise.all([
					pump(child.stdout),
					pump(child.stderr),
					child.exited.catch(() => 0),
				]);
			} catch {
				// docker could not start; the state below says why.
			}
			if (disposed) {
				return;
			}
			let state = await containerState(ps, container.name);
			if (state === "running") {
				await sleep(retry);
				continue;
			}
			note(
				state === "stopped"
					? "stopped"
					: "is unavailable: docker did not answer",
			);
			onState?.(state);
			let reported = state;
			while (!disposed && state !== "running") {
				await sleep(retry);
				state = await containerState(ps, container.name);
				if (state !== "running" && state !== reported) {
					reported = state;
					onState?.(state);
				}
			}
			if (!disposed) {
				note("is running again");
			}
		}
	})();
	return {
		dispose: () => {
			disposed = true;
			child?.kill();
		},
	};
}
