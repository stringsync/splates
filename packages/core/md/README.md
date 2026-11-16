# core/md

A markdown document as a data source: frontmatter fields, sections by heading,
fenced code blocks. Accessors are strict: a missing field or section throws.

```ts
import { Markdown } from "core/md";

const doc = Markdown.parse(text);
doc.field("version"); // frontmatter value, or throws
doc.title; // first h1, or null
doc.section("Good").codeBlocks(); // [{ lang: "ts", code: "..." }]
doc.section("Good").lead; // prose before the first subsection
doc.section("Good").body; // everything, subsections included
```

`MarkdownWriter` is the write half: frontmatter always lands on top, and
fences stretch past any backticks in the code they hold:

```ts
import { MarkdownWriter } from "core/md";

const text = new MarkdownWriter()
	.field("files", "**/*.ts")
	.heading(1, "Single class per file")
	.text("Each file exports at most one class.")
	.heading(2, "Good")
	.code("ts", "class Foo {}")
	.checklist("split the second class out", "move its tests with it")
	.toString();
```
