import { expect, test } from "bun:test";
import { RecorderServer } from "./recorder";

const GRACE_MS = 150;

function connect(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.onopen = () => resolve(socket);
		socket.onerror = () => reject(new Error("connect failed"));
	});
}

test("a control panel closing while staged ends rec after the grace, unless it reconnects", async () => {
	const server = new RecorderServer({} as never, "/tmp/rec-test", {
		panelGraceMs: GRACE_MS,
	});
	try {
		const url = `${server.origin.replace("http", "ws")}/ws`;
		let ended = false;
		void server.closed.then(() => {
			ended = true;
		});
		const first = await connect(url);
		first.close();
		await new Promise((resolve) => setTimeout(resolve, 20));
		const second = await connect(url);
		await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3));
		expect(ended).toBe(false);
		second.close();
		await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3));
		expect(ended).toBe(true);
		expect(server.recordingNow).toBe(false);
	} finally {
		server.dispose();
	}
}, 15_000);

test("status has no lastOutcome before a recording has ended", async () => {
	const server = new RecorderServer({} as never, "/tmp/rec-test");
	try {
		const body = await (await fetch(`${server.origin}/__rec/status`)).json();
		expect(body).not.toHaveProperty("lastOutcome");
	} finally {
		server.dispose();
	}
});

test("salvage with no recording in progress does nothing", async () => {
	const server = new RecorderServer({} as never, "/tmp/rec-test");
	try {
		await server.salvage();
		expect(server.recordingNow).toBe(false);
	} finally {
		server.dispose();
	}
});
