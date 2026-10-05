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
