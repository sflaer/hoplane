import test from 'node:test'
import assert from 'node:assert/strict'
import { createGithubAgent, isExcludedPath, parseRemote } from './github-agent.mjs'

function fakeGit() {
  return {
    async exists() { return false }, async branch() { return null }, async head() { return null }, async remote() { return null }, async status() { return '' },
    async config() { return { name: 'Test User', email: 'test@example.com' } }, async init() {}, async setInitialBranch() {}, async add() {}, async commit() {}, async addRemote() {}, async push() {}, async remoteHead() { return null },
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
  const req = { method: 'POST', url: '/api/github/publish/preview', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield JSON.stringify({ repoName: 'vibedeploy-test', commitMessage: 'feat: test' }) } }
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

test('preview rejects an existing non-GitHub or different origin before any GitHub mutation', async () => {
  let repositoryChecked = false
  const github = { async repository() { repositoryChecked = true; return { status: 404, body: {} } } }
  const git = { ...fakeGit(), async exists() { return true }, async branch() { return 'main' }, async head() { return 'abc123' }, async remote() { return 'https://github.com/another-owner/another-repo.git' } }
  const agent = createGithubAgent({ root: process.cwd(), github, git })
  agent.state.token = 'test-token'; agent.state.user = { login: 'sergey' }
  let status
  const req = { method: 'POST', url: '/api/github/publish/preview', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield JSON.stringify({ repoName: 'vibedeploy-test', commitMessage: 'feat: test' }) } }
  const res = { setHeader() {}, end(body) { status = JSON.parse(body) } }
  await agent.middleware(req, res, () => {})
  assert.match(status.error, /different HTTPS GitHub repository/)
  assert.equal(repositoryChecked, false)
})
