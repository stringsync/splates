import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AutoQueuedBadge } from "./auto-queued-badge";

test("the badge names itself for assistive tech", () => {
	expect(renderToStaticMarkup(<AutoQueuedBadge />)).toContain(
		'aria-label="auto enqueued"',
	);
});
