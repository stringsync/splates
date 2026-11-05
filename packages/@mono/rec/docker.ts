import type { Resource } from "core/disposable";
import type { Ps } from "core/system";
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

export interface FollowOptions {
	ps: Ps;
	container: Container;
	/** Arrival time for a line docker gave no time to. */
	now: () => number;
	onLine: (at: number, text: string) => void;
}

/** Follows one container with `docker logs -f --timestamps`, stdout and stderr both. */
export function followContainer(options: FollowOptions): Resource {
	const { ps, container, now, onLine } = options;
	const child = ps.start([
		"docker",
		"logs",
		"-f",
		"--timestamps",
		"--since",
		new Date(now()).toISOString(),
		container.id,
	]);
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
						onLine(stamp?.at ?? now(), stamp?.rest ?? line);
					}
				}
			}
		} catch {
			// The container went away.
		}
	};
	void pump(child.stdout);
	void pump(child.stderr);
	return { dispose: () => child.kill() };
}
