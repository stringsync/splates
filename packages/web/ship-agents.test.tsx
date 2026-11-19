import { afterEach, expect, test } from "bun:test";
import { conversation, message } from "@splates/server/fixtures";
import { ConversationFeed } from "./conversation-feed";
import { ShipAgents, shipAgents } from "./ship-agents";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

test("finds approval references and exact agent links, including archived conversations", () => {
	const origin = conversation({
		id: "origin",
		archived: true,
		messages: [message("user", "[SPLATES SHIP STARTED run-1]")],
	});
	const mentioned = conversation({
		id: "mention",
		messages: [
			message("agent", "See [ship](https://example.test/#ships/run-1)"),
			message("agent", "#ships/run-1"),
		],
	});
	const other = conversation({
		id: "other",
		messages: [message("agent", "#ships/run-10")],
	});
	const user = conversation({
		id: "user",
		messages: [message("user", "#ships/run-1")],
	});
	expect(
		shipAgents("run-1", [origin, mentioned, other, user]).map(
			(each) => each.id,
		),
	).toEqual(["origin", "mention"]);
});

test("shows a conversation link and hides the row when no agent is known", () => {
	const talk = new ConversationFeed();
	talk.conversations = [
		conversation({
			id: "c1",
			name: "Release check",
			messages: [message("user", "[SPLATES SHIP STARTED run-1]")],
		}),
	];
	const view = render(<ShipAgents id="run-1" talk={talk} />);
	expect(
		view.getByRole("link", { name: /Release check/ }).getAttribute("href"),
	).toBe("#conversations/c1");
	view.rerender(<ShipAgents id="run-2" talk={talk} />);
	expect(
		view.queryByRole("navigation", { name: "Associated agents" }),
	).toBeNull();
});
