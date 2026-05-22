# lotaru

local-first real-time task orchestration runtime.
crt/terminal ui · strict typescript · go-like code style.

## getting started

```bash
npm install
npm run build
npx lotaru
```

open http://127.0.0.1:4317

## dev

```bash
npm run dev          # server (4317) + vite (5173) in parallel
npm run typecheck
npm run lint         # strict — ?. ?? ?: are hard-banned
npm test
```

## style rules

- no `?.` optional chaining
- no `??` nullish coalescing
- no `?:` ternary expressions
- strict typescript, no `any`, no `!`

these are enforced by eslint with `no-restricted-syntax`.

## stack

- backend: fastify + ws + sqlite (better-sqlite3) + chokidar + node-cron + dockerode
- frontend: react + vite + tailwind (crt theme)
- packaged as `npx lotaru`
