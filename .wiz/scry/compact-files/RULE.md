# Compact files

A file of logic holds fewer lines of code than a limit, 500 unless the
project sets `rules.compact-files.limit` in `scry.config.ts`. Past it, a
reader can no longer keep the whole file in mind, and it is usually doing more
than one thing.

Only lines of code count. A line that is blank, or holds nothing but a
comment, does not, so explaining the code never pushes a file over. A line
with code and a comment after it counts. Tests are not checked, nor are data
files like JSON or YAML: the rule reads JavaScript and TypeScript.

## Fixing a finding

Splitting is how to fix it, but only along a seam the code already has. Find
a responsibility the file holds, a class, a group of routes, a parser, a
component with its own state, and move it to a file of its own, named for
what it does. Its callers import it from there. Each file that comes out
should make sense read alone.

Never split just to get under the limit:

- no numbered parts, like `cart-1.ts` and `cart-2.ts`, or `cart-part-2.ts`;
- no `helpers`, `utils` or `misc` file gathering what did not fit;
- no moving a function out while everything it works with stays behind, so
  each file needs the other to be read.

When a file is long but does one thing, a lookup table, a generated schema,
one component whose parts only make sense together, excuse it rather than cut
it up, with the reason on the first line:

```ts
// scry-ignore-file compact-files: the whole grammar, one table the parser walks
```

Its cases are in `evals/`: each `.good.` file follows the rule, and each
`.bad.` file breaks it.
