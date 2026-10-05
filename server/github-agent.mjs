import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(nodeExecFile)
const JSON_LIMIT = 128 * 1024
const DEVICE_TTL_MS = 15 * 60 * 1000
const TICKET_TTL_MS = 10 * 60 * 1000
const DEFAULT_BRANCH = 'main'
const DEFAULT_GITIGNORE = 'node_modules/\ndist/\n.env\n.env.*\n.DS_Store\n*.tsbuildinfo\n'

function json(res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(value))
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > JSON_LIMIT) throw Object.assign(new Error('Request body is too large'), { status: 413 })
  }
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }) }
}

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(Bearer|token|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1: [redacted]')
}
function str(value, fallback = '') { return typeof value === 'string' ? value : fallback }
function repoName(value) {
  const name = str(value).trim()
  return !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(name) ? null : name
}
function commitMessage(value) {
  const message = str(value, 'feat: initial VibeDeploy MVP').trim()
  return !message || message.length > 2000 || message.includes('\u0000') ? null : message
}
function branchName(value) {
  const branch = str(value).trim()
  if (!branch || branch.startsWith('-') || branch.includes('..') || branch.includes('~') || branch.includes('^') || branch.includes(':') || branch.includes('\\') || !/^[A-Za-z0-9._/-]+$/.test(branch)) return null
  return branch
}

export function isExcludedPath(path) {
  const normalized = path.split(sep).join('/')
  const parts = normalized.split('/')
  const base = parts.at(-1)?.toLowerCase() ?? ''
  if (parts.some((part) => ['node_modules', 'dist', '.git', 'sources', '.tasks', '.codex', '.aws'].includes(part))) return true
  if (base === 'agents.md' || base.endsWith('.tsbuildinfo') || base.includes('buildinfo')) return true
  if (base === '.env' || base.startsWith('.env.') || ['.npmrc', '.netrc', '.git-credentials', '.ds_store'].includes(base)) return true
  if (/\.(pem|key|p12|pfx|crt)$/i.test(base)) return true
  return /(^|[._-])(secret|secrets|credential|credentials|token|private-key)([._-]|$)/i.test(base)
}

export async function listPublishFiles(root) {
  const result = []
  async function walk(directory) {
    let entries = []
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const relativePath = relative(root, absolute).split(sep).join('/')
      if (isExcludedPath(relativePath)) continue
      if (entry.isDirectory()) { await walk(absolute); continue }
      if (!entry.isFile()) continue
      const content = await readFile(absolute)
      result.push({ path: relativePath, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') })
    }
  }
  await walk(root)
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
export function fingerprint(files) {
  return createHash('sha256').update(files.map((file) => `${file.path}\u0000${file.sha256}`).join('\u0001')).digest('hex')
}
async function countExcludedFiles(root) {
  let count = 0
  async function walk(directory) {
    let entries = []
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const relativePath = relative(root, absolute).split(sep).join('/')
      if (isExcludedPath(relativePath)) { if (entry.isFile()) count++; continue }
      if (entry.isDirectory()) await walk(absolute)
    }
  }
  await walk(root)
  return count
}

export function parseRemote(remote) {
  try {
    const url = new URL(remote)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) return null
    const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
    const pieces = path.split('/')
    if (pieces.length !== 2 || !pieces.every((piece) => /^[A-Za-z0-9._-]+$/.test(piece))) return null
    return { owner: pieces[0], repo: pieces[1], canonical: `https://github.com/${pieces[0]}/${pieces[1]}.git` }
  } catch { return null }
}

function defaultGit(root) {
  const run = async (args, options = {}) => {
    const result = await execFile('git', args, { cwd: root, shell: false, maxBuffer: 2 * 1024 * 1024, ...options })
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
  return {
    async exists() { try { await run(['rev-parse', '--git-dir']); return true } catch { return false } },
    async branch() { try { return (await run(['branch', '--show-current'])).stdout.trim() || null } catch { return null } },
    async head() { try { return (await run(['rev-parse', 'HEAD'])).stdout.trim() || null } catch { return null } },
    async remote() { try { return (await run(['remote', 'get-url', 'origin'])).stdout.trim() || null } catch { return null } },
    async status() { try { return (await run(['status', '--porcelain=v1'])).stdout } catch { return '' } },
    async config() {
      try { return { name: (await run(['config', '--get', 'user.name'])).stdout.trim(), email: (await run(['config', '--get', 'user.email'])).stdout.trim() } } catch {
        try { return { name: (await run(['config', '--global', '--get', 'user.name'])).stdout.trim(), email: (await run(['config', '--global', '--get', 'user.email'])).stdout.trim() } } catch { return { name: '', email: '' } }
      }
    },
    async init() { await run(['init']) },
    async setInitialBranch(branch) { await run(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]) },
    async add(paths) { if (paths.length) await run(['add', '--', ...paths]) },
    async commit(message) { return run(['commit', '-m', message]) },
    async addRemote(remote) { await run(['remote', 'add', 'origin', remote]) },
    async setRemote(remote) { await run(['remote', 'set-url', 'origin', remote]) },
    async push(branch, env, remote) { await run(['-c', 'credential.helper=', 'push', remote, `refs/heads/${branch}:refs/heads/${branch}`], { env }) },
    async remoteHead(branch, env, remote) { try { return (await run(['-c', 'credential.helper=', 'ls-remote', '--refs', remote, `refs/heads/${branch}`], { env })).stdout.trim().split(/\s+/)[0] || null } catch { return null } },
  }
}

function defaultGithub() {
  const request = async (url, init = {}) => fetch(url, { ...init, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) } })
  return {
    async deviceStart(clientId) { const response = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scope: 'repo' }) }); return { status: response.status, body: await response.json() } },
    async devicePoll(clientId, deviceCode) { const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) }); return { status: response.status, body: await response.json() } },
    async user(token) { const response = await request('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}` } }); return { status: response.status, body: await response.json() } },
    async repositories(token, page) { const response = await request(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`, { headers: { Authorization: `Bearer ${token}` } }); return { status: response.status, body: await response.json(), hasMore: /rel="next"/.test(response.headers.get('link') ?? '') } },
    async repository(token, owner, repo) { const response = await request(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: response.status, body: await response.json() } },
    async createRepository(token, name, isPrivate) { const response = await request('https://api.github.com/user/repos', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, private: isPrivate, auto_init: false }) }); return { status: response.status, body: await response.json() } },
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  if (origin === 'null') return false
  try { return new URL(origin).host === req.headers.host } catch { return false }
}
function isJson(req) { return str(req.headers['content-type']).toLowerCase().split(';', 1)[0].trim() === 'application/json' }
function publicUser(user) { return user && typeof user.login === 'string' ? { login: user.login, ...(typeof user.avatar_url === 'string' ? { avatar_url: user.avatar_url } : {}) } : null }

export function createGithubAgent({ root = process.cwd(), github = defaultGithub(), git, now = () => Date.now(), id = randomUUID } = {}) {
  const projectRoot = resolve(root)
  const gitClient = git ?? defaultGit(projectRoot)
  const state = { token: null, user: null, deviceSessions: new Map(), tickets: new Map(), pushing: false }
  const clearExpired = () => {
    const current = now()
    for (const [key, value] of state.deviceSessions) if (value.expiresAt <= current) state.deviceSessions.delete(key)
    for (const [key, value] of state.tickets) if (value.expiresAt <= current || value.used) state.tickets.delete(key)
  }
  const requireAuth = () => { if (!state.token || !state.user) throw Object.assign(new Error('Connect GitHub first'), { status: 401 }); return { token: state.token, user: state.user } }
  const inspect = async () => {
    const exists = await gitClient.exists()
    return { exists, branch: exists ? await gitClient.branch() : null, head: exists ? await gitClient.head() : null, remote: exists ? await gitClient.remote() : null, status: exists ? await gitClient.status() : '', identity: await gitClient.config() }
  }
  const repositoryWritable = (repository) => repository?.permissions?.push === true && repository.archived !== true && repository.disabled !== true
  const requireWritableRepository = (response) => {
    if (response.status === 404) throw Object.assign(new Error('Selected GitHub repository does not exist'), { status: 404 })
    if (response.status !== 200) throw Object.assign(new Error('Unable to access the selected GitHub repository'), { status: response.status || 502 })
    if (!repositoryWritable(response.body)) throw Object.assign(new Error('Selected GitHub repository is not writable'), { status: 403 })
    return response.body
  }
  const preview = async (input) => {
    const { user, token } = requireAuth()
    if (input.mode !== 'existing' && input.mode !== 'create') throw Object.assign(new Error('Choose an existing repository or explicitly create a new one'), { status: 400 })
    let owner = user.login; let repo
    if (input.mode === 'existing') {
      const fullName = str(input.repositoryFullName).trim()
      const parts = fullName.split('/')
      if (parts.length !== 2 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(parts[0]) || !repoName(parts[1])) throw Object.assign(new Error('Select a repository using owner/repository'), { status: 400 })
      ;[owner, repo] = parts
    } else {
      repo = repoName(input.repoName)
      if (!repo) throw Object.assign(new Error('An explicit valid repository name is required'), { status: 400 })
    }
    const message = commitMessage(input.commitMessage)
    if (!message) throw Object.assign(new Error('Commit message is invalid'), { status: 400 })
    const gitState = await inspect(); const expectedRemote = `https://github.com/${owner}/${repo}.git`
    const requiresRemoteChange = Boolean(gitState.remote && parseRemote(gitState.remote)?.canonical.toLowerCase() !== expectedRemote.toLowerCase())
    if (requiresRemoteChange && input.allowRemoteChange !== true) throw Object.assign(new Error('Changing origin to the selected repository requires explicit consent'), { status: 409 })
    const response = await github.repository(token, owner, repo)
    let privateRepo
    if (input.mode === 'existing') privateRepo = requireWritableRepository(response).private === true
    else {
      if (response.status === 200) throw Object.assign(new Error('Repository already exists; select it as an existing repository'), { status: 409 })
      if (response.status !== 404) throw Object.assign(new Error('Unable to check the new GitHub repository name'), { status: response.status || 502 })
      privateRepo = input.privateRepo !== false
    }
    const files = await listPublishFiles(projectRoot)
    const ticket = id()
    const result = { ticket, mode: input.mode, authenticatedLogin: user.login, repositoryFullName: `${owner}/${repo}`, projectRoot, files: files.map(({ path, bytes, sha256 }) => ({ path, status: 'publish', bytes, sha256 })), excludedCount: await countExcludedFiles(projectRoot), fingerprint: fingerprint(files), branch: branchName(gitState.branch ?? DEFAULT_BRANCH), commit: gitState.head, remote: parseRemote(gitState.remote)?.canonical ?? null, previousRemote: gitState.remote, requiresRemoteChange, repository: `https://github.com/${owner}/${repo}`, privateRepo, repositoryExists: input.mode === 'existing', repoName: repo, owner, commitMessage: message, gitExists: gitState.exists, identity: gitState.identity }
    state.tickets.set(ticket, { ...result, expectedRemote, allowRemoteChange: input.allowRemoteChange === true, status: 'ready', expiresAt: now() + TICKET_TTL_MS })
    return result
  }
  const push = async (ticketId) => {
    const { token, user } = requireAuth(); clearExpired()
    const ticket = state.tickets.get(ticketId)
    if (!ticket || ticket.authenticatedLogin !== user.login || ticket.status !== 'ready') throw Object.assign(new Error('Publish preview is no longer valid'), { status: 409 })
    if (state.pushing) throw Object.assign(new Error('Another publish is already running'), { status: 409 })
    ticket.status = 'running'; state.pushing = true
    try {
      const current = await inspect(); const files = await listPublishFiles(projectRoot)
      if (fingerprint(files) !== ticket.fingerprint) throw Object.assign(new Error('Files changed after preview; review a new preview'), { status: 409 })
      if (current.remote !== ticket.previousRemote) throw Object.assign(new Error('origin changed after preview; review a new preview'), { status: 409 })
      if (ticket.requiresRemoteChange && ticket.allowRemoteChange !== true) throw Object.assign(new Error('Changing origin requires explicit consent'), { status: 409 })
      if (ticket.gitExists !== current.exists) throw Object.assign(new Error('Git repository changed after preview; review a new preview'), { status: 409 })
      if (ticket.gitExists && current.head !== ticket.commit) throw Object.assign(new Error('Current commit changed after preview; review a new preview'), { status: 409 })
      const branch = branchName(current.branch ?? (!current.exists ? DEFAULT_BRANCH : ''))
      if (!branch) throw Object.assign(new Error('Current Git branch name is not available'), { status: 400 })
      if (ticket.branch && branch !== ticket.branch) throw Object.assign(new Error('Current branch changed after preview; review a new preview'), { status: 409 })
      if (!current.identity?.name || !current.identity?.email) throw Object.assign(new Error('Configure Git user.name and user.email before publishing'), { status: 400 })
      const response = await github.repository(token, ticket.owner, ticket.repoName)
      if (ticket.mode === 'existing') {
        const repository = requireWritableRepository(response)
        if ((repository.private === true) !== ticket.privateRepo) throw Object.assign(new Error('Repository visibility changed after preview; review a new preview'), { status: 409 })
      } else {
        if (response.status !== 404) throw Object.assign(new Error('New repository name is no longer available; review a new preview'), { status: response.status === 200 ? 409 : response.status || 502 })
        const created = await github.createRepository(token, ticket.repoName, ticket.privateRepo)
        if (created.status !== 201) throw Object.assign(new Error('GitHub repository could not be created; review a new preview'), { status: created.status || 502 })
        if ((created.body?.private === true) !== ticket.privateRepo) throw Object.assign(new Error('Created repository visibility differs from the preview'), { status: 409 })
      }
      if (!current.exists) { await gitClient.init(); if (!current.branch && gitClient.setInitialBranch) await gitClient.setInitialBranch(branch) }
      if (!current.remote) await gitClient.addRemote(ticket.expectedRemote)
      else if (ticket.requiresRemoteChange) await gitClient.setRemote(ticket.expectedRemote)
      let generatedGitignore = false
      try { await readFile(join(projectRoot, '.gitignore')) } catch { await writeFile(join(projectRoot, '.gitignore'), DEFAULT_GITIGNORE, { flag: 'wx', mode: 0o644 }); generatedGitignore = true }
      await gitClient.add([...files.map((file) => file.path), ...(generatedGitignore ? ['.gitignore'] : [])])
      try { await gitClient.commit(ticket.commitMessage) } catch (error) { const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`; if (!/nothing to commit|working tree clean/i.test(output)) throw error }
      const commit = await gitClient.head(); if (!commit) throw new Error('Git did not produce a commit')
      const askDir = await mkdtemp(join(tmpdir(), 'vibedeploy-')); const askpass = join(askDir, 'askpass.sh')
      const gitEnv = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0', VIBEDEPLOY_GITHUB_TOKEN: token }
      await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) echo x-access-token;; *) echo "$VIBEDEPLOY_GITHUB_TOKEN";; esac\n', { mode: 0o700 }); await chmod(askpass, 0o700)
      let remoteCommit
      try { await gitClient.push(branch, gitEnv, ticket.expectedRemote); remoteCommit = await gitClient.remoteHead(branch, gitEnv, ticket.expectedRemote) } finally { await rm(askDir, { recursive: true, force: true }) }
      if (remoteCommit !== commit) throw new Error('GitHub accepted the push but the remote commit could not be verified')
      ticket.status = 'used'; return { ok: true, repository: ticket.repository, branch, commit, remoteCommit, privateRepo: ticket.privateRepo }
    } finally { state.pushing = false; if (ticket.status !== 'used') ticket.status = 'ready' }
  }
  async function middleware(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname
    if (!pathname.startsWith('/api/github/')) return next()
    clearExpired()
    try {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin requests are not allowed' })
      if (req.method === 'GET' && pathname === '/api/github/session') return json(res, 200, { user: publicUser(state.user) })
      if (req.method === 'GET' && pathname === '/api/github/repositories') {
        const { token } = requireAuth()
        const pageText = url.searchParams.get('page') ?? '1'
        if (!/^[1-9][0-9]*$/.test(pageText) || !Number.isSafeInteger(Number(pageText))) return json(res, 400, { error: 'Repository page must be a positive integer' })
        const response = await github.repositories(token, Number(pageText))
        if (response.status !== 200 || !Array.isArray(response.body)) return json(res, response.status === 200 ? 502 : response.status || 502, { error: 'Unable to list GitHub repositories' })
        return json(res, 200, { repositories: response.body.filter(repositoryWritable).filter((repository) => typeof repository.full_name === 'string').map((repository) => ({ fullName: repository.full_name, privateRepo: repository.private === true })), hasMore: response.hasMore === true })
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST required' })
      if (!isJson(req)) return json(res, 415, { error: 'application/json required' })
      const input = await readJson(req)
      if (pathname === '/api/github/device/start') {
        const clientId = str(input.clientId, process.env.VITE_GITHUB_CLIENT_ID).trim()
        if (!clientId || !/^[A-Za-z0-9_.-]{6,100}$/.test(clientId)) return json(res, 400, { error: 'Missing GitHub OAuth client ID' })
        const response = await github.deviceStart(clientId); const body = response.body ?? {}
        if (response.status !== 200 || !body.device_code) return json(res, response.status || 502, { error: body.error_description || body.error || 'GitHub device authorization failed' })
        const sessionId = randomBytes(24).toString('base64url'); const interval = Math.max(5, Number(body.interval) || 5); const expiresAt = now() + Math.min(DEVICE_TTL_MS, Math.max(60_000, (Number(body.expires_in) || 900) * 1000))
        state.deviceSessions.set(sessionId, { clientId, deviceCode: body.device_code, interval, nextPollAt: 0, expiresAt })
        return json(res, 200, { sessionId, userCode: body.user_code, verificationUri: body.verification_uri, verificationUriComplete: body.verification_uri_complete, interval, expiresAt })
      }
      if (pathname === '/api/github/device/poll') {
        const sessionId = str(input.sessionId); const session = state.deviceSessions.get(sessionId)
        if (!session || session.expiresAt <= now()) { state.deviceSessions.delete(sessionId); return json(res, 410, { error: 'expired_token', expiresAt: session?.expiresAt }) }
        if (now() < session.nextPollAt) return json(res, 200, { pending: true, error: 'authorization_pending', interval: session.interval, expiresAt: session.expiresAt })
        session.nextPollAt = now() + session.interval * 1000; const response = await github.devicePoll(session.clientId, session.deviceCode); const body = response.body ?? {}
        if (!body.access_token) { if (body.error === 'slow_down') session.interval += 5; if (body.error === 'expired_token' || body.error === 'access_denied') state.deviceSessions.delete(sessionId); return json(res, 200, { pending: true, error: body.error, interval: session.interval, expiresAt: session.expiresAt }) }
        const userResponse = await github.user(body.access_token); if (userResponse.status !== 200 || !userResponse.body?.login) return json(res, 502, { error: 'GitHub user lookup failed' })
        state.token = body.access_token; state.user = publicUser(userResponse.body); state.deviceSessions.delete(sessionId); return json(res, 200, { user: publicUser(state.user) })
      }
      if (pathname === '/api/github/device/cancel') { state.deviceSessions.delete(str(input.sessionId)); return json(res, 200, { ok: true }) }
      if (pathname === '/api/github/logout') { state.token = null; state.user = null; state.deviceSessions.clear(); state.tickets.clear(); return json(res, 200, { ok: true }) }
      if (pathname === '/api/github/publish/preview') { const result = await preview(input); const { fingerprint: _fingerprint, ...publicPreview } = result; return json(res, 200, publicPreview) }
      if (pathname === '/api/github/push') { if (input.confirmed !== true) return json(res, 400, { error: 'Explicit confirmation is required' }); if (!str(input.ticket)) return json(res, 400, { error: 'Publish preview ticket is required' }); return json(res, 200, await push(input.ticket)) }
      return json(res, 404, { error: 'Not found' })
    } catch (error) { return json(res, Number(error?.status) || 500, { error: cleanError(error) }) }
  }
  return { middleware, state, listPublishFiles, fingerprint }
}
