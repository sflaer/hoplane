# Hoplane

### You built it with AI. Now ship it with confidence.

Hoplane is a free-to-run local workspace for getting your code from your computer to GitHub, with a clear path toward checks and staging deployment. Built for solo developers, small teams, and people who would rather launch their project than learn a deployment stack.

**Your code. Your repository. Your next step, clearly explained.**

[Get started](#get-started) · [What works today](#what-works-today) · [Roadmap](#roadmap) · [Contribute](#contribute)

## Why Hoplane?

Writing code with AI is getting easier. Knowing which files will be published, where they will go, and what happens next still takes work.

Hoplane brings that handoff into a visible workflow:

**Review → check → commit → push → staging.**

- Start with the project you already have on your machine.
- See the GitHub account, repository, branch, and files before publishing.
- Keep control of actions that change your repository.
- Read the implementation, run it yourself, and help shape the product.
- Run the current app without a Hoplane subscription or license fee. External hosting, AI models, and other services can have their own charges.

## What works today

Hoplane is an early developer preview. The interface still uses the original **VibeDeploy** name in places.

The implemented local GitHub publishing workflow includes:

- GitHub sign-in through device authorization.
- Repository selection, manual repository entry, and repository creation.
- A publication preview showing the destination and files.
- Commit and push, including publication to a new branch.
- Explicit approval when changing a remote destination.
- A separate, confirmed workflow to publish a branch's file tree to `main`, with checks that the remote branches have not changed since preview.

**The workspace's sample projects, diff, AI responses, checks, and staging deployment are currently interface demonstrations.** They do not yet represent a working AI engine, real test execution, or an actual deployment integration. The working GitHub workflow operates on the repository containing this running app; arbitrary project selection is still planned.

## Get started

Install a current Node.js LTS release with npm, and Git.

```sh
git clone https://github.com/sflaer/hoplane.git
cd hoplane
npm ci
npm run dev -- --host 127.0.0.1
```

Open the localhost address printed by the server. Keep the terminal running while using the app.

For GitHub publishing, open **Connect GitHub** and enter the client ID of a GitHub OAuth app with device flow enabled. Complete authorization on GitHub, then review the account, destination, branch, and file preview before confirming publication.

The local GitHub service currently runs inside the development server. A static build or `npm run preview` does not provide those API operations. GitHub authentication is currently held in memory and is lost when the service restarts.

### Open the product board

From the repository root:

```sh
cd kanban-board
npm ci
npm run dev -- --host 127.0.0.1 --port 5175
```

The board includes Backlog and Ideas. Card moves are saved in the browser's local storage; they are not yet a shared team database.

## Roadmap

Our direction is a portable workspace that keeps the project's context across Mac, Windows, and a staging server.

- Real project state, diff, checks, and persistent operation history.
- A standalone local service and packaged application.
- MCP integration for coding agents such as Codex, Claude Code, and Cursor.
- Real deployment adapters, build logs, cancellation, and rollback.
- Pull requests, protected credentials, and custom domains.

These are planned capabilities, not features available in the current release. See [the product board source](kanban-board/src/backlog-cards.ts) for current planned work.

## For people building with AI

Hoplane is being built for the step after code generation: reviewing what will ship and taking the next action with a clear destination and visible result.

You can develop this repository with your preferred coding assistant today. Automatic agent access to Hoplane operations through MCP is planned and is not yet available.

## Contribute

Try the GitHub publishing workflow, report a reproducible issue, or propose a focused improvement through [GitHub Issues](https://github.com/sflaer/hoplane/issues).

Development checks:

```sh
npm run build
node --test server/github-agent.test.mjs
```

## License and open-source status

The goal is a free, open-source project. This repository does not yet contain an open-source license. Publicly readable source alone does not grant open-source reuse rights; a license must be added before advertising the project as licensed open source.
