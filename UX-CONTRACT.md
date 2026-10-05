# GitHub publishing workflow

This contract covers the live GitHub workflow in `src/components/GitHubPublish.tsx`. Other workspace cards currently include demonstration data and do not establish evidence of a completed Git operation or deployment. Visual intent remains in [DESIGN.md](DESIGN.md).

## Source of decisions

- User requirement, 2026-10-04: the authenticated account and destination repository must be explicitly chosen; no arbitrary destination or silent repository creation.
- `server/github-agent.mjs`: server authorization, destination verification, preview tickets and confirmed mutations.
- GitHub repository permissions determine whether the authenticated account can push. Repository visibility comes from GitHub for an existing repository.

## Canonical UI owners

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | `GitHubPublish` native select | This contract | Platform keyboard and popup; empty initial selection; API pages with Load more | Browser keyboard/popup checks when available |
| Form | `GitHubPublish` labelled inputs and server preview | This contract and `server/github-agent.mjs` | Existing destination or explicit create | Backend authorization tests and build |
| Scrollbar | `src/styles.css` | `DESIGN.md` | Scrollable GitHub modal/file list | Static audit; browser checks when available |
| Toast | App `queueToast`; GitHub inline status/error owns critical feedback | This contract | Toast acknowledges success; error and success link stay inline | Source review; runtime checks when available |

GitHub confirmation shows authenticated login, exact destination, branch, visibility, commit message and any origin change. Target entry accepts full owner/repository or a canonical GitHub HTTPS URL.

## Destination and recovery

- Existing repository is the initial mode, with no selected target. Creating a repository is a separate user-selected mode and requires a literal name.
- List or type the repository explicitly. Confirm the full address in the server preview before pushing.
- Account switching signs out of the local session; no token is stored in browser storage or cloud events.
- A differing origin requires explicit consent and appears in preview. Origin changes only on confirmed push, never during selection or preview.
- A preview ticket binds account, repository and local Git state. Invalid or changed state requires a fresh preview.
- Push never uses force. Conflicts and incompatible histories remain errors to resolve explicitly.
- Success requires verification of the remote commit. A local commit, configured origin, OAuth login, or preview is not a successful push.
- Preserve inline failure feedback and offer Back to review a new preview; do not display a success event on failure.

## Verification limits

Backend tests cover destination authorization and confirmed effects with isolated fake providers. A passing static audit or build does not prove browser behavior or a real remote push. Report browser access limitations and live verification separately.
