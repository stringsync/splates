import { describe, expect, it } from "bun:test";
import { render } from "./html";

describe("render", () => {
	it("renders a heading a couple of levels below the card around it", () => {
		expect(render("# alpha\n\n## Next")).toBe("<h3>alpha</h3>\n<h4>Next</h4>");
	});

	it("gives a checklist real checkboxes, ticked where the box was", () => {
		const html = render("- [x] done it\n- [ ] not yet\n");

		expect(html).toBe(
			'<ul><li class="box"><input type="checkbox" disabled checked> done it</li>' +
				'<li class="box"><input type="checkbox" disabled> not yet</li></ul>',
		);
	});

	it("leaves a plain bullet as a plain bullet", () => {
		expect(render("- where the code lives")).toBe(
			"<ul><li>where the code lives</li></ul>",
		);
	});

	it("keeps a wrapped item in its bullet rather than spilling it out", () => {
		expect(render("- one item\n  wrapped onto a second line\n- another")).toBe(
			"<ul><li>one item wrapped onto a second line</li><li>another</li></ul>",
		);
	});

	it("joins the lines of a paragraph and starts a new one at a blank line", () => {
		expect(render("one\ntwo\n\nthree")).toBe("<p>one two</p>\n<p>three</p>");
	});

	it("keeps a fenced block verbatim, markdown inside it included", () => {
		expect(render("```sh\n- [ ] not an item\n```")).toBe(
			"<pre><code>- [ ] not an item</code></pre>",
		);
	});

	it("closes a block someone left unfenced rather than dropping it", () => {
		expect(render("```\nbun test")).toBe("<pre><code>bun test</code></pre>");
	});

	it("marks up code, bold and italic inside a line", () => {
		expect(render("run `bin/wiz fix`, **then** *test*")).toBe(
			"<p>run <code>bin/wiz fix</code>, <strong>then</strong> <em>test</em></p>",
		);
	});

	it("links http and leaves any other scheme as text", () => {
		expect(render("[docs](https://example.com/a?b=1&c=2)")).toBe(
			'<p><a href="https://example.com/a?b=1&amp;c=2">docs</a></p>',
		);
		expect(render("[x](javascript:alert(1))")).toBe(
			"<p>[x](javascript:alert(1))</p>",
		);
	});

	it("escapes markup instead of passing it through", () => {
		expect(render("- [ ] drop <script>alert(1)</script>")).toContain(
			"&lt;script&gt;alert(1)&lt;/script&gt;",
		);
		expect(render('a "quoted" <b>word</b>')).toBe(
			"<p>a &quot;quoted&quot; &lt;b&gt;word&lt;/b&gt;</p>",
		);
	});
});
