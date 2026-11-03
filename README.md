# Spinning Plates

Run many agents, land every change on trunk.

## Get started

In your repository, install the splates skill for your agents:

```sh
bunx @stringsync/splates init
```

Commit what it writes. Your agents now start each change with `splates add` and
land it with `splates merge`.

Optionally, start the server for a page that shows tasks, the queue and merges:

```sh
bunx @stringsync/splates server
```

See [`packages/splates`](packages/splates/README.md) for more.
