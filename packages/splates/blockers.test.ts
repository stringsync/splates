import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ElsewhereLinks } from "@stringsync/splates-server/board";
import { OpenBoards } from "@stringsync/splates-server/records";
import { Testing } from "@stringsync/splates-server/testing";
import { splates } from "./splates";

/** A task here blocked by one of another project on the same machine. */
describe("blockers in other projects", () => {
	let here: Testing;
	let there: Testing;
	let deps: Parameters<typeof splates.run>[0];
	let thereSlug: string;

	beforeEach(async () => {
		here = await Testing.open();
		there = await Testing.open({ alongside: here });
		await here.projects.register(there.root);
		const listed = await here.projects.list();
		const slug = (root: string) =>
			listed.find((each) => each.root === root)?.slug ?? "";
		thereSlug = slug(there.root);
		here.ps.cd(here.root);
		deps = {
			log: here.log,
			fs: here.fs,
			ps: here.ps,
			assets: here.assets,
			secrets: here.secrets,
		};
	});

	afterEach(async () => {
		await here.disposeAsync();
		await there.disposeAsync();
	});

	const said = () => String(here.log.entries.at(-1)?.message);

	it("links one, says where it stands from both sides, and unlinks it", async () => {
		const parser = await there.tasks.add("Export the parser", null);
		await splates.run(deps, [
			"task",
			"add",
			"Use the parser",
			"--slug",
			"use-parser",
			"--blocked-by",
			`${thereSlug}#${parser.id}`,
		]);
		expect(said()).toContain(`blocked by: ${thereSlug} #${parser.id}`);
		const [task] = await here.tasks.all();
		expect(task?.blockedElsewhere).toEqual([
			{ project: there.root, id: parser.id, subject: "Export the parser" },
		]);

		await splates.run(deps, ["task", "show", String(task?.id)]);
		expect(said()).toContain(
			`blocked by: ${thereSlug} #${parser.id} Export the parser (backlog)`,
		);

		const hereSlug = (await here.projects.list()).find(
			(each) => each.root === here.root,
		)?.slug;
		here.ps.cd(there.root);
		await splates.run(deps, ["task", "show", String(parser.id)]);
		expect(said()).toContain(
			`blocking:  ${hereSlug} #${task?.id} Use the parser (ready, in another project)`,
		);

		here.ps.cd(here.root);
		await splates.run(deps, [
			"task",
			"update",
			String(task?.id),
			"--remove-blocked-by",
			`${thereSlug} #${parser.id}`,
		]);
		expect((await here.tasks.find(task?.id ?? 0)).blockedElsewhere).toEqual([]);
	});

	it("refuses a task of another project that is not there", async () => {
		await splates.run(deps, [
			"task",
			"add",
			"Use the parser",
			"--slug",
			"use-parser",
			"--blocked-by",
			`${thereSlug}#9`,
		]);

		expect(here.out()).toContain('"reason":"not_found"');
		expect(await here.tasks.all()).toEqual([]);
	});

	it("notes one merged there with the commit it landed as", async () => {
		const parser = await there.tasks.add("Export the parser", null);
		const task = await here.tasks.add("Use the parser", null, {
			blockedElsewhere: [
				{ project: there.root, id: parser.id, subject: parser.subject },
			],
		});
		await parser.remove("abc123");
		await there.service.finished.record({
			id: parser.id,
			task: "parser-export",
			subject: parser.subject,
			ended: "merged",
			reason: null,
			base: "main",
			commit: "abc123",
			startedAt: new Date().toISOString(),
			endedAt: new Date().toISOString(),
			conversation: null,
			took: [{ id: parser.id, subject: parser.subject }],
			plan: "",
		});

		using boards = new OpenBoards(here, here.projects);
		await new ElsewhereLinks(here.tasks).settle(boards);

		expect((await here.tasks.find(task.id)).blockedElsewhere).toEqual([
			{
				project: there.root,
				id: parser.id,
				subject: parser.subject,
				landed: "abc123",
			},
		]);
	});
});
