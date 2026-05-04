# create-nape-game

Scaffold a new game project using [@newkrok/nape-js](https://napejs.org).

```bash
npm create nape-game@latest my-game
```

You'll be prompted for a renderer (Canvas2D, Three.js, or PixiJS). The
generated project is a complete, runnable Vite starter — `cd my-game &&
npm install && npm run dev` and you're playing.

## Templates

| Template     | What's in it                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platformer` | Side-scroller with run / variable jump / double jump, coyote time + jump buffer, tilemap collision, moving platforms, stompable + spiky enemies, projectiles, destructible blocks (`fractureBody`), spike hazards, coins, goal flag, smooth-follow camera with shake, HUD, and a fixed-timestep accumulator |

## CLI options

```bash
npm create nape-game@latest [project-name] -- [options]

Options:
  --template <name>    one of: platformer
  --renderer <name>    one of: canvas2d (default), threejs, pixi
  --help               show help
```

Run without any args for a fully interactive prompt.

## What `--renderer` does

Each template ships with all three renderers under `src/render/`. The CLI
keeps the one you pick, deletes the others, rewrites the import in
`main.js`, and adds the renderer-specific dep to `package.json`:

| Renderer    | Extra dep added |
| ----------- | --------------- |
| `canvas2d`  | (none — uses the built-in browser API) |
| `threejs`   | `three`         |
| `pixi`      | `pixi.js`       |

If you skip the CLI and clone the template directly, all three renderers
are present — pick one by editing the import at the top of `src/main.js`.

## License

MIT
