English | [简体中文](https://github.com/Geequlim/voice-brief/blob/main/CONTRIBUTING.zh-CN.md)

# Contributing

Thanks for your interest in Voice Brief.

## Environment

- Node.js `>= 24`
- Yarn 4 (the repository pins the version via `yarnPath` in `.yarnrc.yml`; a system-wide yarn 1.x also works)
- GJS (`gjs`) for Cinnamon extension development and testing

```bash
git clone https://github.com/Geequlim/voice-brief.git
cd voice-brief
yarn install
yarn tiny list
```

## Commands

All checks, tests, builds, and packaging entry points are provided by the Tiny selector; do not call the underlying tools directly:

| Command | Purpose |
| --- | --- |
| `yarn tiny lint` | Oxlint / ESLint / zero-internal-dependency checks |
| `yarn tiny lint/fix` | Fix lint issues automatically |
| `yarn tiny lint/typecheck` | TypeScript type checking |
| `yarn tiny test` | Unit and integration tests |
| `yarn tiny test/cinnamon` | Cinnamon extension GJS tests |
| `yarn tiny compile` | Production build (CLI + Cinnamon) |
| `yarn tiny publish/package` | Compile and assemble npm staging |
| `yarn tiny test/package/cli` | Isolated install verification of the CLI tarball |
| `yarn tiny develop/cli` | Watch-mode build |

## Commit conventions

- Commit messages use the `type: summary` format with common types: `feat`, `fix`, `refactor`, `build`, `ci`, `docs`, `test`, `chore`.
- The pre-commit hook runs lockfile validation and automatic lint fixes; commit the files the hook has corrected as well.
- Make sure `yarn tiny lint` and `yarn tiny test` pass before every commit.

## Code style

- Indentation with tabs, LF line endings, single quotes, semicolons.
- Prefer named exports and `import type` (enforced by Oxlint / ESLint).
- CLI behavior (subcommands, arguments, help text, exit codes) is an external contract; changes must come with snapshot test updates.

## Compatibility promises

CLI help text, the `status --json` structure, the YAML configuration format, Hook protocol v2, and the Cinnamon UUID are compatibility promises. If you need to change any of them, please discuss the design in an issue first.
