import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGithubAgent, isExcludedPath, parseRemote } from './github-agent.mjs'

function fakeGit() {
  return {
    async exists() { return false }, async branch() { return null }, async head() { return null }, async remote() { return null }, async status() { return '' },
    async config() { return { name: 'Test User', email: 'test@example.com' } }, async init() {}, async setInitialBranch() {}, async add() {}, async commit() {}, async addRemote() {}, async setRemote() {}, async push() {}, async remoteHead() { return null },
  }
}

test('publish allowlist excludes project references, dependencies, build output and secrets', () => {
  assert.equal(isExcludedPath('sources/brief.md'), true)
  assert.equal(isExcludedPath('AGENTS.md'), true)
  assert.equal(isExcludedPath('node_modules/react/index.js'), true)
  assert.equal(isExcludedPath('dist/assets/app.js'), true)
  assert.equal(isExcludedPath('.env.local'), true)
  assert.equal(isExcludedPath('.npmrc'), true)
  assert.equal(isExcludedPath('.git-credentials'), true)
  assert.equal(isExcludedPath('kanban-board/.DS_Store'), true)
  assert.equal(isExcludedPath('src/app.tsx'), false)
})

test('remote parser accepts only canonical HTTPS GitHub remotes', () => {
  assert.equal(parseRemote('https://github.com/sergey/vibedeploy.git').canonical, 'https://github.com/sergey/vibedeploy.git')
  assert.equal(parseRemote('git@github.com:sergey/vibedeploy.git'), null)
  assert.equal(parseRemote('https://token@github.com/sergey/vibedeploy.git'), null)
})

test('preview stores a server ticket and does not expose a device code or fingerprint', async () => {
  const github = { async repository() { return { status: 404, body: {} } } }
  const agent = createGithubAgent({ root: process.cwd(), github, git: fakeGit() })
  agent.state.token = 'test-token'; agent.state.user = { login: 'sergey' }
  const req = { method: 'POST', url: '/api/github/publish/preview', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield JSON.stringify({ mode: 'create', repoName: 'vibedeploy-test', commitMessage: 'feat: test' }) } }
  let payload
  const res = { setHeader() {}, end(body) { payload = JSON.parse(body) } }
  await agent.middleware(req, res, () => {})
  assert.equal(typeof payload.ticket, 'string')
  assert.equal('fingerprint' in payload, false)
  assert.equal(agent.state.tickets.size, 1)
})

test('device flow keeps the device code server-side and accepts only the session id', async () => {
  let polledCode
  const github = {
    async deviceStart() { return { status: 200, body: { device_code: 'server-only-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 } } },
    async devicePoll(_clientId, deviceCode) { polledCode = deviceCode; return { status: 200, body: { access_token: 'server-only-token' } } },
    async user() { return { status: 200, body: { login: 'sergey', avatar_url: 'https://example.test/avatar.png' } } },
  }
  const agent = createGithubAgent({ root: process.cwd(), github, git: fakeGit() })
  async function call(payload) {
    let output
    const req = { method: 'POST', url: '/api/github/device/start', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield JSON.stringify(payload) } }
    const res = { setHeader() {}, end(body) { output = JSON.parse(body) } }
    await agent.middleware(req, res, () => {})
    return output
  }
  const start = await call({ clientId: 'client_id_123456' })
  assert.equal('device_code' in start, false)
  assert.equal(typeof start.sessionId, 'string')
  let pollOutput
  const req = { method: 'POST', url: '/api/github/device/poll', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield JSON.stringify({ sessionId: start.sessionId }) } }
  const res = { setHeader() {}, end(body) { pollOutput = JSON.parse(body) } }
  await agent.middleware(req, res, () => {})
  assert.equal(polledCode, 'server-only-device-code')
  assert.equal(pollOutput.user.login, 'sergey')
  assert.equal('access_token' in pollOutput, false)
})

test('cross-origin JSON requests are rejected without CORS headers', async () => {
  const agent = createGithubAgent({ root: process.cwd(), git: fakeGit(), github: {} })
  let payload
  const req = { method: 'POST', url: '/api/github/logout', headers: { host: 'localhost:5175', origin: 'https://evil.example', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield '{}' } }
  const res = { setHeader() {}, end(body) { payload = JSON.parse(body) } }
  await agent.middleware(req, res, () => {})
  assert.equal(payload.error, 'Cross-origin requests are not allowed')
})

test('preview requires consent to replace a different origin before accepting a ticket', async () => {
  let repositoryChecked = false
  const github = { async repository() { repositoryChecked = true; return { status: 404, body: {} } } }
  const git = { ...fakeGit(), async exists() { return true }, async branch() { return 'main' }, async head() { return 'abc123' }, async remote() { return 'https://github.com/another-owner/another-repo.git' } }
  const agent = createGithubAgent({ root: process.cwd(), github, git })
  agent.state.token = 'test-token'; agent.state.user = { login: 'sergey' }
  let status
  const req = { method: 'POST', url: '/api/github/publish/preview', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield JSON.stringify({ mode: 'create', repoName: 'vibedeploy-test', commitMessage: 'feat: test' }) } }
  const res = { setHeader() {}, end(body) { status = JSON.parse(body) } }
  await agent.middleware(req, res, () => {})
  assert.match(status.error, /requires explicit consent/)
  assert.equal(repositoryChecked, false)
})

async function call(agent, url, input, method = 'POST') {
  let payload
  const req = { method, url, headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield JSON.stringify(input ?? {}) } }
  const res = { setHeader() {}, end(body) { payload = JSON.parse(body) } }
  await agent.middleware(req, res, () => {})
  return { status: res.statusCode, payload }
}

const writableRepo = (overrides = {}) => ({ full_name: 'team/chosen', permissions: { push: true }, private: false, archived: false, disabled: false, ...overrides })
const existingInput = { mode: 'existing', repositoryFullName: 'team/chosen', commitMessage: 'feat: explicit destination' }

async function fixture(t, { remote = null, repository = writableRepo(), status = 200 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'github-agent-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'app.js'), 'export const app = true\n')
  await writeFile(join(root, '.gitignore'), 'node_modules/\n')
  const calls = []; let currentRemote = remote; let head = 'before-commit'
  const git = {
    ...fakeGit(), async exists() { return true }, async branch() { return 'main' }, async head() { return head }, async remote() { return currentRemote },
    async init() { calls.push(['init']) }, async add(paths) { calls.push(['add', paths]) }, async commit(message) { calls.push(['commit', message]); head = 'after-commit' },
    async addRemote(url) { calls.push(['addRemote', url]); currentRemote = url }, async setRemote(url) { calls.push(['setRemote', url]); currentRemote = url },
    async push(branch, _env, url) { calls.push(['push', branch, url]) }, async remoteHead(branch, _env, url) { calls.push(['remoteHead', branch, url]); return head },
  }
  const github = {
    async repository(_token, owner, repo) { calls.push(['repository', owner, repo]); return { status, body: repository } },
    async branch(_token, owner, repo, branch) { calls.push(['branch', owner, repo, branch]); return { status: 404, body: {} } },
    async createRepository(_token, name, privateRepo) { calls.push(['createRepository', name, privateRepo]); return { status: 201, body: { private: privateRepo } } },
  }
  const agent = createGithubAgent({ root, github, git })
  agent.state.token = 'fake-token'; agent.state.user = { login: 'sergey' }
  return { agent, calls, github, git, changeRemote(value) { currentRemote = value } }
}

test('preview requires a target mode and an explicit literal name; it never supplies a default', async (t) => {
  const { agent, calls } = await fixture(t)
  for (const input of [{}, { repoName: 'chosen' }, { mode: 'create' }, { mode: 'create', repoName: 'name with spaces' }, { mode: 'existing' }]) {
    assert.equal((await call(agent, '/api/github/publish/preview', input)).status, 400)
  }
  assert.deepEqual(calls, [])
  assert.equal(agent.state.tickets.size, 0)
})

test('repository listing returns only writable enabled repositories with pagination and real privacy', async (t) => {
  const { agent, github } = await fixture(t)
  let requestedPage
  github.repositories = async (_token, page) => { requestedPage = page; return { status: 200, hasMore: true, body: [
    writableRepo(), writableRepo({ full_name: 'sergey/private', private: true }), writableRepo({ permissions: { push: false } }), writableRepo({ archived: true }), writableRepo({ disabled: true }),
  ] } }
  assert.deepEqual((await call(agent, '/api/github/repositories?page=2', undefined, 'GET')).payload, { repositories: [{ fullName: 'team/chosen', privateRepo: false }, { fullName: 'sergey/private', privateRepo: true }], hasMore: true })
  assert.equal(requestedPage, 2)
  assert.equal((await call(agent, '/api/github/repositories?page=0', undefined, 'GET')).status, 400)
  agent.state.token = null
  assert.equal((await call(agent, '/api/github/repositories', undefined, 'GET')).status, 401)
})

test('missing existing repository cannot become an implicit creation', async (t) => {
  const { agent, calls } = await fixture(t, { status: 404, repository: {} })
  assert.equal((await call(agent, '/api/github/publish/preview', existingInput)).status, 404)
  assert.deepEqual(calls, [['repository', 'team', 'chosen']])
  assert.equal(agent.state.tickets.size, 0)
})

test('existing repository requires push permission and rejects archived or disabled targets', async (t) => {
  for (const overrides of [{ permissions: { push: false } }, { permissions: {} }, { archived: true }, { disabled: true }]) {
    const { agent } = await fixture(t, { repository: writableRepo(overrides) })
    assert.equal((await call(agent, '/api/github/publish/preview', existingInput)).status, 403)
  }
})

test('existing repository preview uses its actual privacy and separates account from repository owner', async (t) => {
  const { agent } = await fixture(t, { repository: writableRepo({ private: true }) })
  const { status, payload } = await call(agent, '/api/github/publish/preview', { ...existingInput, privateRepo: false })
  assert.equal(status, 200)
  assert.equal(payload.privateRepo, true)
  assert.equal(payload.authenticatedLogin, 'sergey')
  assert.equal(payload.owner, 'team')
  assert.equal(payload.repositoryFullName, 'team/chosen')
  assert.equal(payload.repository, 'https://github.com/team/chosen')
})

test('confirmed existing push uses the ticket target and cannot be redirected by request fields', async (t) => {
  const { agent, calls } = await fixture(t)
  const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
  const result = await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true, repositoryFullName: 'attacker/other', repoName: 'other' })
  assert.equal(result.status, 200)
  assert.equal(result.payload.repository, 'https://github.com/team/chosen')
  assert.deepEqual(calls.filter(([name]) => name === 'repository'), [['repository', 'team', 'chosen'], ['repository', 'team', 'chosen']])
  assert.deepEqual(calls.filter(([name]) => name === 'push' || name === 'remoteHead'), [['push', 'main', 'https://github.com/team/chosen.git'], ['remoteHead', 'main', 'https://github.com/team/chosen.git']])
  assert.equal(calls.some(([name]) => name === 'createRepository'), false)
})

test('remote replacement requires preview consent and only occurs after confirmed push', async (t) => {
  const previousRemote = 'git@github.com:old-owner/old-repo.git'
  const { agent, calls } = await fixture(t, { remote: previousRemote })
  assert.equal((await call(agent, '/api/github/publish/preview', existingInput)).status, 409)
  const preview = (await call(agent, '/api/github/publish/preview', { ...existingInput, allowRemoteChange: true })).payload
  assert.equal(preview.requiresRemoteChange, true)
  assert.equal(preview.previousRemote, previousRemote)
  assert.equal(calls.some(([name]) => name === 'setRemote'), false)
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket })).status, 400)
  assert.equal(calls.some(([name]) => name === 'setRemote'), false)
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 200)
  assert.deepEqual(calls.find(([name]) => name === 'setRemote'), ['setRemote', 'https://github.com/team/chosen.git'])
})

test('push compares the raw origin recorded by preview before any mutation', async (t) => {
  const { agent, calls, changeRemote } = await fixture(t, { remote: 'https://github.com/team/chosen' })
  const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
  assert.equal(preview.requiresRemoteChange, false)
  changeRemote('https://github.com/team/chosen.git')
  const result = await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })
  assert.equal(result.status, 409)
  assert.match(result.payload.error, /origin changed/)
  assert.deepEqual(calls, [['repository', 'team', 'chosen']])
})

test('push ticket belongs to the authenticated account even for organization targets', async (t) => {
  const { agent, calls } = await fixture(t)
  const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
  agent.state.user = { login: 'someone-else' }
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 409)
  assert.deepEqual(calls, [['repository', 'team', 'chosen']])
})

test('an existing repository deleted after preview never triggers creation or local mutation', async (t) => {
  const { agent, calls, github } = await fixture(t)
  const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
  github.repository = async () => ({ status: 404, body: {} })
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 404)
  assert.deepEqual(calls, [['repository', 'team', 'chosen']])
})

test('create mode only creates the explicitly named personal repository on confirmation', async (t) => {
  const { agent, calls } = await fixture(t, { status: 404, repository: {} })
  const preview = (await call(agent, '/api/github/publish/preview', { mode: 'create', repoName: 'explicit-new', privateRepo: true })).payload
  assert.equal(preview.owner, 'sergey')
  assert.equal(preview.repositoryFullName, 'sergey/explicit-new')
  assert.equal(calls.some(([name]) => name === 'createRepository'), false)
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 200)
  assert.deepEqual(calls.find(([name]) => name === 'createRepository'), ['createRepository', 'explicit-new', true])
  assert.deepEqual(calls.find(([name]) => name === 'push'), ['push', 'main', 'https://github.com/sergey/explicit-new.git'])
})

test('create mode rejects existing names, including a repository appearing after preview', async (t) => {
  const { agent, calls, github } = await fixture(t)
  assert.equal((await call(agent, '/api/github/publish/preview', { mode: 'create', repoName: 'chosen' })).status, 409)
  github.repository = async () => ({ status: 404, body: {} })
  const preview = (await call(agent, '/api/github/publish/preview', { mode: 'create', repoName: 'new-name' })).payload
  github.repository = async () => ({ status: 200, body: writableRepo() })
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 409)
  assert.equal(calls.some(([name]) => name === 'createRepository' || name === 'push'), false)
})

test('push rechecks write rights and visibility before touching the local repository', async (t) => {
  for (const changedRepository of [writableRepo({ permissions: { push: false } }), writableRepo({ private: true })]) {
    const { agent, calls, github } = await fixture(t)
    const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
    github.repository = async () => ({ status: 200, body: changedRepository })
    const result = await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })
    assert.equal(result.status, changedRepository.private ? 409 : 403)
    assert.deepEqual(calls, [['repository', 'team', 'chosen']])
  }
})

test('create race conflict cannot silently push to a pre-existing repository', async (t) => {
  const { agent, calls, github } = await fixture(t, { status: 404, repository: {} })
  const preview = (await call(agent, '/api/github/publish/preview', { mode: 'create', repoName: 'new-name' })).payload
  github.createRepository = async () => ({ status: 422, body: {} })
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 422)
  assert.deepEqual(calls, [['repository', 'sergey', 'new-name'], ['repository', 'sergey', 'new-name']])
})

test('new remote branch keeps the local source and pins the preview destination through confirmation', async (t) => {
  const { agent, calls, git } = await fixture(t)
  const targetBranch = 'publish/recovery-2026'
  git.push = async (source, _env, remote, target) => { calls.push(['push', source, remote, target]) }
  const preview = await call(agent, '/api/github/publish/preview', { ...existingInput, targetBranch, createNewBranch: true })
  assert.equal(preview.status, 200)
  assert.equal(preview.payload.branch, 'main')
  assert.equal(preview.payload.targetBranch, targetBranch)
  assert.equal(preview.payload.createNewBranch, true)
  assert.deepEqual(calls, [['repository', 'team', 'chosen'], ['branch', 'team', 'chosen', targetBranch]])
  const result = await call(agent, '/api/github/push', { ticket: preview.payload.ticket, confirmed: true, targetBranch: 'main', createNewBranch: false })
  assert.equal(result.status, 200)
  assert.equal(await git.branch(), 'main')
  assert.equal(result.payload.branch, targetBranch)
  assert.equal(result.payload.sourceBranch, 'main')
  assert.equal(result.payload.branchUrl, 'https://github.com/team/chosen/tree/publish%2Frecovery-2026')
  assert.deepEqual(calls.filter(([name]) => name === 'push' || name === 'remoteHead'), [
    ['push', 'main', 'https://github.com/team/chosen.git', targetBranch],
    ['remoteHead', targetBranch, 'https://github.com/team/chosen.git'],
  ])
  assert.equal(calls.filter(([name]) => name === 'branch').length, 2)
  assert.deepEqual(calls.slice(0, 5), [
    ['repository', 'team', 'chosen'], ['branch', 'team', 'chosen', targetBranch],
    ['repository', 'team', 'chosen'], ['branch', 'team', 'chosen', targetBranch],
    ['addRemote', 'https://github.com/team/chosen.git'],
  ])
})

test('omitted branch selection preserves the current-branch publishing contract', async (t) => {
  const { agent, calls } = await fixture(t)
  const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
  assert.equal(preview.branch, 'main')
  assert.equal(preview.targetBranch, 'main')
  assert.equal(preview.createNewBranch, false)
  assert.equal(calls.some(([name]) => name === 'branch'), false)
})

test('new branch must have an explicit valid Git branch name before repository lookups', async (t) => {
  const { agent, calls } = await fixture(t)
  const invalidNames = [undefined, '', '@', '-branch', '.hidden', 'feature/.hidden', 'branch.lock', 'feature.lock/child', 'branch/', 'branch.', 'feature//child', 'branch..name', 'branch~1', 'branch^', 'branch:name', 'branch\\name', 'branch name', ' branch', 'branch ', 'branch\n', 'branch?', 'branch*', 'branch[0]', 'branch@{1}', 123]
  for (const targetBranch of invalidNames) {
    const result = await call(agent, '/api/github/publish/preview', { ...existingInput, targetBranch, createNewBranch: true })
    assert.equal(result.status, 400, `Should reject ${JSON.stringify(targetBranch)}`)
  }
  assert.equal((await call(agent, '/api/github/publish/preview', { ...existingInput, targetBranch: 'valid', createNewBranch: 'true' })).status, 400)
  assert.deepEqual(calls, [])
  assert.equal(agent.state.tickets.size, 0)
})

test('branch collision is rejected during preview and if it appears before confirmation', async (t) => {
  const { agent, calls, github } = await fixture(t)
  const input = { ...existingInput, targetBranch: 'publish/new', createNewBranch: true }
  github.branch = async () => ({ status: 200, body: { name: 'publish/new' } })
  const collision = await call(agent, '/api/github/publish/preview', input)
  assert.equal(collision.status, 409)
  assert.match(collision.payload.error, /already exists/)
  assert.equal(agent.state.tickets.size, 0)
  github.branch = async () => ({ status: 404, body: {} })
  const preview = (await call(agent, '/api/github/publish/preview', input)).payload
  github.branch = async () => ({ status: 200, body: {} })
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 409)
  assert.equal(calls.some(([name]) => ['init', 'addRemote', 'setRemote', 'add', 'commit', 'push'].includes(name)), false)
})

test('branch availability errors stop preview and confirmed publishing before local mutations', async (t) => {
  for (const status of [403, 429, 500]) {
    const { agent, calls, github } = await fixture(t)
    const input = { ...existingInput, targetBranch: 'publish/new', createNewBranch: true }
    github.branch = async () => ({ status, body: {} })
    assert.equal((await call(agent, '/api/github/publish/preview', input)).status, status)
    github.branch = async () => ({ status: 404, body: {} })
    const preview = (await call(agent, '/api/github/publish/preview', input)).payload
    github.branch = async () => ({ status, body: {} })
    assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, status)
    assert.equal(calls.some(([name]) => ['init', 'addRemote', 'setRemote', 'add', 'commit', 'push'].includes(name)), false)
  }
})

test('new branch publishing still checks repository permissions before branch lookup or mutation', async (t) => {
  const { agent, calls, github } = await fixture(t)
  const input = { ...existingInput, targetBranch: 'publish/new', createNewBranch: true }
  const preview = (await call(agent, '/api/github/publish/preview', input)).payload
  github.repository = async () => ({ status: 200, body: writableRepo({ permissions: { push: false } }) })
  assert.equal((await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })).status, 403)
  assert.deepEqual(calls, [['repository', 'team', 'chosen'], ['branch', 'team', 'chosen', 'publish/new']])
  assert.equal((await call(agent, '/api/github/publish/preview', input)).status, 403)
  assert.deepEqual(calls, [['repository', 'team', 'chosen'], ['branch', 'team', 'chosen', 'publish/new']])
})

test('new personal repository supports an explicit target without looking up a nonexistent branch', async (t) => {
  const { agent, calls, git } = await fixture(t, { status: 404, repository: {} })
  git.push = async (source, _env, remote, target) => { calls.push(['push', source, remote, target]) }
  const preview = (await call(agent, '/api/github/publish/preview', { mode: 'create', repoName: 'new-repo', targetBranch: 'publish/start', createNewBranch: true })).payload
  const result = await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })
  assert.equal(result.status, 200)
  assert.deepEqual(calls.find(([name]) => name === 'push'), ['push', 'main', 'https://github.com/sergey/new-repo.git', 'publish/start'])
  assert.equal(calls.some(([name]) => name === 'branch'), false)
})

test('successful push is verified against the target branch and never reports success on a mismatched commit', async (t) => {
  const { agent, git } = await fixture(t)
  let verifiedBranch
  git.remoteHead = async (branch) => { verifiedBranch = branch; return 'different-remote-commit' }
  const preview = (await call(agent, '/api/github/publish/preview', { ...existingInput, targetBranch: 'publish/new', createNewBranch: true })).payload
  const result = await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })
  assert.equal(verifiedBranch, 'publish/new')
  assert.equal(result.status, 500)
  assert.equal(result.payload.ok, undefined)
  assert.match(result.payload.error, /could not be verified/)
})

test('non-fast-forward and fetch-first failures return a structured recovery error', async (t) => {
  for (const stderr of ['! [rejected] main -> main (fetch first)', '! [rejected] main -> main (non-fast-forward)', 'Updates were rejected because the remote contains work that you do not have locally.']) {
    const { agent, git } = await fixture(t)
    git.push = async () => { throw Object.assign(new Error('Command failed: git push raw-secret-shell-details'), { stderr }) }
    const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
    const result = await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })
    assert.equal(result.status, 409)
    assert.equal(result.payload.code, 'NON_FAST_FORWARD')
    assert.match(result.payload.error, /Back.*new branch/)
    assert.doesNotMatch(result.payload.error, /raw-secret-shell-details|Command failed/)
    assert.equal(result.payload.ok, undefined)
  }
})

test('permission failures during push are not misclassified as non-fast-forward recovery', async (t) => {
  const { agent, git } = await fixture(t)
  git.push = async () => { throw Object.assign(new Error('GitHub denied write permission'), { stderr: 'remote: Permission denied (403)' }) }
  const preview = (await call(agent, '/api/github/publish/preview', existingInput)).payload
  const result = await call(agent, '/api/github/push', { ticket: preview.ticket, confirmed: true })
  assert.equal(result.status, 500)
  assert.equal(result.payload.code, undefined)
  assert.match(result.payload.error, /denied write permission/)
})

const mainInput = { repositoryFullName: 'team/chosen', sourceBranch: 'publish/new' }
const treeEntry = (path, sha, mode = '100644') => ({ path, sha, mode, type: 'blob' })

async function mainFixture(t, overrides = {}) {
  const fixtureState = await fixture(t, { repository: writableRepo({ default_branch: 'main', permissions: { push: true, admin: true }, ...overrides }) })
  const { calls, github } = fixtureState
  const branches = new Map([['main', 'old-main-commit'], ['publish/new', 'source-commit']])
  const trees = new Map([
    ['old-main-tree', { tree: [treeEntry('old-only.txt', 'old-file'), treeEntry('shared.txt', 'old-shared'), treeEntry('same.txt', 'same-file'), treeEntry('mode.sh', 'same-mode-file')], truncated: false }],
    ['source-tree', { tree: [treeEntry('new-only.txt', 'new-file'), treeEntry('shared.txt', 'new-shared'), treeEntry('same.txt', 'same-file'), treeEntry('mode.sh', 'same-mode-file', '100755')], truncated: false }],
  ])
  github.branch = async (_token, owner, repo, branch) => { calls.push(['branch', owner, repo, branch]); return { status: branches.has(branch) ? 200 : 404, body: { commit: { sha: branches.get(branch) } } } }
  github.gitCommit = async (_token, owner, repo, sha) => { calls.push(['gitCommit', owner, repo, sha]); return { status: 200, body: { tree: { sha: sha === 'source-commit' ? 'source-tree' : 'old-main-tree' } } } }
  github.gitTree = async (_token, owner, repo, sha) => { calls.push(['gitTree', owner, repo, sha]); return { status: 200, body: trees.get(sha) } }
  github.createCommit = async (_token, owner, repo, body) => { calls.push(['createCommit', owner, repo, body]); return { status: 201, body: { sha: 'replacement-commit' } } }
  github.updateRef = async (_token, owner, repo, branch, sha) => { calls.push(['updateRef', owner, repo, branch, sha]); branches.set(branch, sha); return { status: 200, body: {} } }
  github.updateRepository = async (_token, owner, repo, body) => { calls.push(['updateRepository', owner, repo, body]); return { status: 200, body } }
  return { ...fixtureState, branches, trees }
}

test('main replacement previews exact file additions, replacements, deletions and mode changes without mutations', async (t) => {
  const { agent, calls } = await mainFixture(t)
  const result = await call(agent, '/api/github/main/preview', mainInput)
  assert.equal(result.status, 200)
  assert.equal(result.payload.authenticatedLogin, 'sergey')
  assert.equal(result.payload.repositoryFullName, 'team/chosen')
  assert.equal(result.payload.sourceBranch, 'publish/new')
  assert.equal(result.payload.sourceSha, 'source-commit')
  assert.equal(result.payload.mainSha, 'old-main-commit')
  assert.equal(result.payload.defaultBranch, 'main')
  assert.deepEqual(result.payload.files, [
    { path: 'mode.sh', status: 'modified' }, { path: 'new-only.txt', status: 'added' },
    { path: 'old-only.txt', status: 'deleted' }, { path: 'shared.txt', status: 'modified' },
  ])
  assert.equal(calls.some(([name]) => ['createCommit', 'updateRef', 'updateRepository', 'add', 'commit', 'push'].includes(name)), false)
  assert.equal(agent.state.mainTickets.size, 1)
  assert.equal(agent.state.tickets.size, 0)
})

test('confirmed main replacement uses the source tree and preserves both histories as commit parents', async (t) => {
  const { agent, calls, branches } = await mainFixture(t)
  const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
  const result = await call(agent, '/api/github/main/replace', { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen', repositoryFullName: 'attacker/other', sourceBranch: 'attacker' })
  assert.equal(result.status, 200)
  assert.deepEqual(calls.find(([name]) => name === 'createCommit'), ['createCommit', 'team', 'chosen', { message: 'Publish publish/new files to main', tree: 'source-tree', parents: ['old-main-commit', 'source-commit'] }])
  assert.deepEqual(calls.find(([name]) => name === 'updateRef'), ['updateRef', 'team', 'chosen', 'main', 'replacement-commit'])
  assert.equal(branches.get('main'), 'replacement-commit')
  assert.equal(branches.get('publish/new'), 'source-commit')
  assert.equal(result.payload.branchUrl, 'https://github.com/team/chosen/tree/main')
  assert.equal(result.payload.commit, 'replacement-commit')
  assert.equal(calls.some(([name]) => ['updateRepository', 'init', 'add', 'commit', 'push', 'addRemote', 'setRemote'].includes(name)), false)
  assert.equal((await call(agent, '/api/github/main/replace', { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen' })).status, 409)
  assert.equal(calls.filter(([name]) => name === 'createCommit').length, 1)
})

test('main replacement requires explicit confirmation and the exact typed repository name', async (t) => {
  const { agent, calls } = await mainFixture(t)
  const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
  for (const input of [
    { ticket: preview.ticket, confirmationName: 'team/chosen' },
    { ticket: preview.ticket, confirmed: true },
    { ticket: preview.ticket, confirmed: true, confirmationName: 'chosen' },
    { ticket: preview.ticket, confirmed: true, confirmationName: 'team/other' },
  ]) assert.equal((await call(agent, '/api/github/main/replace', input)).status, 400)
  assert.equal(calls.some(([name]) => ['createCommit', 'updateRef'].includes(name)), false)
})

test('main preview requires another valid branch, authentication and writable repository', async (t) => {
  const { agent, calls } = await mainFixture(t)
  for (const input of [{}, { ...mainInput, sourceBranch: 'main' }, { ...mainInput, sourceBranch: 'publish/../other' }, { ...mainInput, repositoryFullName: 'invalid' }]) assert.equal((await call(agent, '/api/github/main/preview', input)).status, 400)
  assert.deepEqual(calls, [])
  agent.state.token = null
  assert.equal((await call(agent, '/api/github/main/preview', mainInput)).status, 401)
  const denied = await mainFixture(t, { permissions: { push: false, admin: true } })
  assert.equal((await call(denied.agent, '/api/github/main/preview', mainInput)).status, 403)
  assert.deepEqual(denied.calls, [['repository', 'team', 'chosen']])
})

test('main replacement rejects changed source or main commits before creating a remote commit', async (t) => {
  for (const branch of ['main', 'publish/new']) {
    const { agent, calls, branches } = await mainFixture(t)
    const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
    branches.set(branch, 'changed-commit')
    const result = await call(agent, '/api/github/main/replace', { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen' })
    assert.equal(result.status, 409)
    assert.match(result.payload.error, /branch changed/)
    assert.equal(calls.some(([name]) => ['createCommit', 'updateRef'].includes(name)), false)
  }
})

test('main replacement rechecks account, repository rights, default branch and privacy', async (t) => {
  for (const changed of [
    { status: 409, user: { login: 'another' } },
    { status: 403, repository: writableRepo({ default_branch: 'main', permissions: { push: false } }) },
    { status: 409, repository: writableRepo({ default_branch: 'main', private: true }) },
    { status: 409, repository: writableRepo({ default_branch: 'elsewhere', permissions: { push: true, admin: true } }) },
  ]) {
    const { agent, calls, github } = await mainFixture(t)
    const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
    if (changed.user) agent.state.user = changed.user
    if (changed.repository) github.repository = async () => ({ status: 200, body: changed.repository })
    const result = await call(agent, '/api/github/main/replace', { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen' })
    assert.equal(result.status, changed.status)
    assert.equal(calls.some(([name]) => ['createCommit', 'updateRef'].includes(name)), false)
  }
})

test('main preview rejects incomplete GitHub tree lists', async (t) => {
  for (const treeName of ['source-tree', 'old-main-tree']) {
    const { agent, calls, trees } = await mainFixture(t)
    trees.get(treeName).truncated = true
    const result = await call(agent, '/api/github/main/preview', mainInput)
    assert.equal(result.status, 422)
    assert.match(result.payload.error, /incomplete file list/)
    assert.equal(agent.state.mainTickets.size, 0)
    assert.equal(calls.some(([name]) => ['createCommit', 'updateRef'].includes(name)), false)
  }
})

test('making main the default requires admin permission and occurs only after confirmed replacement', async (t) => {
  const denied = await mainFixture(t, { default_branch: 'publish/new', permissions: { push: true, admin: false } })
  assert.equal((await call(denied.agent, '/api/github/main/preview', mainInput)).status, 403)
  const { agent, calls } = await mainFixture(t, { default_branch: 'publish/new' })
  const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
  assert.equal(preview.defaultBranch, 'publish/new')
  assert.equal(calls.some(([name]) => name === 'updateRepository'), false)
  assert.equal((await call(agent, '/api/github/main/replace', { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen' })).status, 200)
  assert.deepEqual(calls.find(([name]) => name === 'updateRepository'), ['updateRepository', 'team', 'chosen', { default_branch: 'main' }])
  assert.ok(calls.findIndex(([name]) => name === 'updateRef') < calls.findIndex(([name]) => name === 'updateRepository'))
})

test('branch protection and failed verification never produce a main replacement success', async (t) => {
  for (const failure of ['protection', 'verification', 'default-setting']) {
    const { agent, calls, github } = await mainFixture(t, failure === 'default-setting' ? { default_branch: 'publish/new' } : {})
    const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
    if (failure === 'protection') github.updateRef = async () => ({ status: 422, body: { message: 'Protected branch update failed' } })
    if (failure === 'verification') github.updateRef = async () => ({ status: 200, body: {} })
    if (failure === 'default-setting') github.updateRepository = async () => ({ status: 403, body: {} })
    const result = await call(agent, '/api/github/main/replace', { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen' })
    assert.equal(result.status, failure === 'protection' ? 422 : failure === 'verification' ? 409 : 403)
    assert.equal(result.payload.ok, undefined)
    assert.match(result.payload.error, failure === 'protection' ? /branch protection/ : failure === 'verification' ? /could not be verified/ : /Main was updated/)
    assert.equal(calls.some(([name]) => ['init', 'add', 'commit', 'push', 'addRemote', 'setRemote'].includes(name)), false)
  }
})

test('running main replacement rejects duplicates and an expired ticket cannot mutate GitHub', async (t) => {
  const { agent, calls, github } = await mainFixture(t)
  const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const createCommit = github.createCommit
  github.createCommit = async (...args) => { await gate; return createCommit(...args) }
  const input = { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen' }
  const first = call(agent, '/api/github/main/replace', input)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await call(agent, '/api/github/main/replace', input)).status, 409)
  release()
  assert.equal((await first).status, 200)
  assert.equal(calls.filter(([name]) => name === 'createCommit').length, 1)
  const secondPreview = (await call(agent, '/api/github/main/preview', mainInput)).payload
  agent.state.mainTickets.get(secondPreview.ticket).expiresAt = 0
  assert.equal((await call(agent, '/api/github/main/replace', { ...input, ticket: secondPreview.ticket })).status, 409)
  assert.equal(calls.filter(([name]) => name === 'createCommit').length, 1)
})

test('default GitHub adapter encodes branch names and updates main with force false', async (t) => {
  const { git, agent: fixtureAgent } = await fixture(t)
  const requests = []; let mainSha = 'old-main'
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null })
    let status = 200; let body
    if (url.endsWith('/branches/publish%2Fnew')) body = { commit: { sha: 'source' } }
    else if (url.endsWith('/branches/main')) body = { commit: { sha: mainSha } }
    else if (url.endsWith('/git/commits/source')) body = { tree: { sha: 'source-tree' } }
    else if (url.endsWith('/git/commits/old-main')) body = { tree: { sha: 'old-tree' } }
    else if (url.includes('/git/trees/')) body = { tree: [], truncated: false }
    else if (url.endsWith('/git/commits') && options.method === 'POST') { status = 201; body = { sha: 'replacement' } }
    else if (url.endsWith('/git/refs/heads/main') && options.method === 'PATCH') { mainSha = 'replacement'; body = {} }
    else if (url === 'https://api.github.com/repos/team/chosen') body = writableRepo({ default_branch: 'main' })
    else throw new Error(`Unexpected mocked URL: ${url}`)
    return { status, async json() { return body } }
  })
  const agent = createGithubAgent({ root: process.cwd(), git })
  agent.state.token = fixtureAgent.state.token; agent.state.user = fixtureAgent.state.user
  const preview = (await call(agent, '/api/github/main/preview', mainInput)).payload
  const result = await call(agent, '/api/github/main/replace', { ticket: preview.ticket, confirmed: true, confirmationName: 'team/chosen' })
  assert.equal(result.status, 200)
  assert.ok(requests.some(({ url }) => url.endsWith('/branches/publish%2Fnew')))
  assert.deepEqual(requests.find(({ method }) => method === 'PATCH').body, { sha: 'replacement', force: false })
  assert.deepEqual(requests.find(({ method }) => method === 'POST').body.parents, ['old-main', 'source'])
})
