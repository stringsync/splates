import { describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { Dispatcher } from "webappwiz/events";
import type {
	EverywhereFeedEvents,
	EverywhereSummary,
	InProject,
} from "./everywhere-feed";
import { project } from "./fixtures";
import type { Projects } from "./project-api";
import { ProjectList } from "./project-list";

describe("ProjectList", () => {
	it("lists as it starts, before anything opens it", async () => {
		const everywhere = feed();
		const server = route();
		const list = new ProjectList(everywhere, server.list);
		list.start();
		expect(server.asked).toHaveLength(1);
		server.asked[0]?.(listing("shop"));
		await Promise.resolve();
		expect(list.projects?.map((each) => each.slug)).toEqual(["shop"]);
	});

	it("lists again when a conversation's status moves, not on a streamed message", async () => {
		const everywhere = feed();
		const server = route();
		const list = new ProjectList(everywhere, server.list);
		list.start();
		server.asked[0]?.(listing("shop"));
		await Promise.resolve();

		const talking = {
			id: "c1",
			status: "running",
			project: "shop",
		} as unknown as InProject<ConversationState>;
		everywhere.conversations = [talking];
		everywhere.changed();
		expect(server.asked).toHaveLength(2);
		server.asked[1]?.(listing("shop"));
		await Promise.resolve();

		everywhere.conversations = [{ ...talking }];
		everywhere.changed();
		expect(server.asked).toHaveLength(2);

		everywhere.conversations = [{ ...talking, status: "idle" }];
		everywhere.changed();
		expect(server.asked).toHaveLength(3);
	});

	it("asks once more after a listing on its way when the feed moved meanwhile", async () => {
		const everywhere = feed();
		const server = route();
		const list = new ProjectList(everywhere, server.list);
		list.start();
		everywhere.projects = [{ project: "new" } as EverywhereSummary];
		everywhere.changed();
		everywhere.changed();
		expect(server.asked).toHaveLength(1);
		server.asked[0]?.(listing("shop"));
		await Bun.sleep(0);
		expect(server.asked).toHaveLength(2);
		server.asked[1]?.(listing("shop", "new"));
		await Bun.sleep(0);
		expect(list.projects?.map((each) => each.slug)).toEqual(["shop", "new"]);
	});
});

/** Every project's feed, as far as the list reads it. */
function feed() {
	const dispatcher = new Dispatcher<EverywhereFeedEvents>();
	return {
		events: dispatcher.events,
		hold: () => ({ dispose: () => {} }),
		projects: [] as EverywhereSummary[],
		tasks: [],
		conversations: [] as InProject<ConversationState>[],
		changed: () => dispatcher.dispatch("changed"),
	};
}

/** A listing route whose answers the test gives, one per ask. */
function route() {
	const asked: ((listed: Projects) => void)[] = [];
	return {
		asked,
		list: () =>
			new Promise<Projects>((resolve) => {
				asked.push(resolve);
			}),
	};
}

function listing(...slugs: string[]): Projects {
	return {
		projects: slugs.map((slug) => project(slug, [])),
		servers: [],
	} as unknown as Projects;
}
