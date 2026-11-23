#!/usr/bin/env bun
/**
 * A rig command for tests, as `docs/rigs.md` describes one: `describe`
 * prints its rigs; `start echo` serves `/healthz` on `PORT`, printing its
 * options and a line a second until it is stopped; `start fail` exits 3.
 */
const [verb, rig, ...flags] = process.argv.slice(2);

if (verb === "describe") {
	console.log(
		JSON.stringify({
			name: "fixture",
			label: "Fixture",
			rigs: [
				{
					name: "echo",
					label: "Echo server",
					health: { http: "/healthz" },
					options: [
						{ name: "greeting", type: "string", default: "hello" },
						{ name: "loud", type: "boolean", default: false },
						{ name: "mode", type: "enum", values: ["a", "b"], default: "a" },
					],
				},
				{ name: "fail", label: "Fails at once" },
				{
					name: "local",
					label: "Local only",
					exposure: "none",
					health: { http: "/healthz" },
				},
				{
					name: "self",
					label: "Self exposed",
					exposure: "self",
					ports: ["web", "api"],
					health: { http: "/healthz" },
					options: [
						{
							name: "url",
							type: "string",
							default: "https://self.example.test",
						},
						{ name: "api-url", type: "string", default: "" },
					],
				},
			],
		}),
	);
} else if (verb === "start" && (rig === "echo" || rig === "local")) {
	const port = Number(process.env.PORT);
	Bun.serve({
		port,
		fetch: (request) =>
			new URL(request.url).pathname === "/healthz"
				? new Response("ok")
				: new Response(`${rig} ${flags.join(" ")}`),
	});
	console.log(`listening on ${port} with ${flags.join(" ")}`);
	setInterval(() => console.log("tick"), 1000);
} else if (verb === "start" && rig === "self") {
	const port = Number(process.env.PORT);
	const apiPort = Number(process.env.PORT_API);
	Bun.serve({
		port,
		fetch: (request) =>
			new URL(request.url).pathname === "/healthz"
				? new Response("ok")
				: new Response(`self ${flags.join(" ")}`),
	});
	Bun.serve({
		port: apiPort,
		fetch: () => new Response("api"),
	});
	const flag = (name: string) =>
		flags.find((each) => each.startsWith(`--${name}=`))?.slice(name.length + 3);
	const webUrl = flag("url");
	const apiUrl = flag("api-url");
	if (webUrl) {
		console.log(`splates:url ${webUrl}`);
	}
	if (apiUrl) {
		console.log(`splates:url api ${apiUrl}`);
	}
	setInterval(() => console.log("tick"), 1000);
} else if (verb === "start" && rig === "fail") {
	process.stderr.write("fail: nothing to serve\n");
	process.exit(3);
} else {
	console.error(`usage: rig describe | rig start <echo|fail> [--opt=value]`);
	process.exit(2);
}
