import { useEffect, useMemo, useRef, useState } from 'react'

type GithubUser = { login: string; avatar_url?: string }
type ChangedFile = { name: string; status: string; tone?: string; lines?: string }
type DeviceSession = { sessionId: string; userCode: string; verificationUri: string; interval: number; expiresAt: number }
type PublishPreview = {
  ticket: string
  projectRoot?: string
  files: Array<{ path: string; status: string }>
  excludedCount?: number
  branch: string
  commit?: string
  repository?: string
  remote?: string
  privateRepo: boolean
  commitMessage: string
}

type Props = {
  open: boolean
  onClose: () => void
  commitMessage: string
  files: ChangedFile[]
  branch: string
  onPublished: (repository: string) => void
}

const readError = async (response: Response, fallback: string) => {
  try {
    const body = await response.json() as { error?: string; message?: string }
    return body.error ?? body.message ?? fallback
  } catch { return fallback }
}

export default function GitHubPublish({ open, onClose, commitMessage, files, branch, onPublished }: Props) {
  const [user, setUser] = useState<GithubUser | null>(null)
  const [clientId, setClientId] = useState(import.meta.env.VITE_GITHUB_CLIENT_ID ?? '')
  const [device, setDevice] = useState<DeviceSession | null>(null)
  const [repoName, setRepoName] = useState('vibedeploy-gui')
  const [privateRepo, setPrivateRepo] = useState(true)
  const [preview, setPreview] = useState<PublishPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [success, setSuccess] = useState('')
  const [copied, setCopied] = useState(false)
  const pollAbort = useRef<AbortController | null>(null)

  const resetPublish = () => {
    setPreview(null)
    setError('')
    setStatus('')
    setSuccess('')
  }

  useEffect(() => {
    if (!open) return
    setError('')
    setPreview(null)
    setSuccess('')
    fetch('/api/github/session').then(async (response) => {
      if (!response.ok) return
      const data = await response.json() as { user?: GithubUser | null }
      setUser(data.user ?? null)
    }).catch(() => undefined)
  }, [open])

  useEffect(() => {
    if (open) return
    pollAbort.current?.abort()
    setDevice(null)
    setBusy(false)
  }, [open])

  useEffect(() => () => pollAbort.current?.abort(), [])

  useEffect(() => {
    if (!device) return
    let cancelled = false
    let timer: number | undefined
    const controller = new AbortController()
    pollAbort.current = controller
    const poll = async () => {
      if (cancelled || controller.signal.aborted) return
      if (Date.now() >= device.expiresAt) {
        setError('GitHub authorization expired. Start login again.')
        setDevice(null)
        setBusy(false)
        return
      }
      try {
        const response = await fetch('/api/github/device/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: device.sessionId }), signal: controller.signal })
        const result = await response.json() as { user?: GithubUser; pending?: boolean; interval?: number; error?: string; expires_in?: number }
        if (cancelled) return
        if (result.user) {
          setUser(result.user)
          setDevice(null)
          setBusy(false)
          setStatus('GitHub connected. Choose the repository details below.')
          return
        }
        if (result.error === 'expired_token' || result.error === 'access_denied' || result.error === 'expired_session') {
          setError('GitHub authorization expired or was denied. Start login again.')
          setDevice(null)
          setBusy(false)
          return
        }
        const nextInterval = Math.max(1, result.interval ?? device.interval)
        timer = window.setTimeout(poll, nextInterval * 1000)
      } catch (pollError) {
        if (!cancelled && (pollError as Error).name !== 'AbortError') {
          setError('Could not check GitHub authorization. Retrying…')
          timer = window.setTimeout(poll, Math.max(5, device.interval) * 1000)
        }
      }
    }
    timer = window.setTimeout(poll, Math.max(1, device.interval) * 1000)
    return () => {
      cancelled = true
      controller.abort()
      if (timer) window.clearTimeout(timer)
      if (pollAbort.current === controller) pollAbort.current = null
    }
  }, [device])

  const startLogin = async () => {
    if (!clientId.trim()) { setError('Add your GitHub OAuth App client ID first.'); return }
    setBusy(true); setError(''); setStatus('Starting GitHub device login…')
    try {
      const response = await fetch('/api/github/device/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: clientId.trim() }) })
      if (!response.ok) throw new Error(await readError(response, 'GitHub login could not start.'))
      const result = await response.json() as { sessionId: string; userCode?: string; user_code?: string; verificationUri?: string; verification_uri?: string; verificationUriComplete?: string; interval?: number; expiresAt?: number; expires_in?: number }
      const userCode = result.userCode ?? result.user_code
      const verificationUri = result.verificationUriComplete ?? result.verificationUri ?? result.verification_uri
      if (!result.sessionId || !userCode || !verificationUri) throw new Error('GitHub returned an incomplete device login session.')
      const expiresAt = result.expiresAt ?? Date.now() + Math.max(60, result.expires_in ?? 900) * 1000
      setDevice({ sessionId: result.sessionId, userCode, verificationUri, interval: Math.max(1, result.interval ?? 5), expiresAt })
      window.open(verificationUri, '_blank', 'noopener,noreferrer')
    } catch (loginError) {
      setBusy(false)
      setError(loginError instanceof Error ? loginError.message : 'GitHub login could not start.')
    }
  }

  const cancelLogin = () => {
    if (device) void fetch('/api/github/device/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: device.sessionId }) }).catch(() => undefined)
    pollAbort.current?.abort()
    setDevice(null)
    setBusy(false)
    setStatus('')
  }

  const logout = async () => {
    setBusy(true)
    try {
      const response = await fetch('/api/github/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!response.ok) throw new Error(await readError(response, 'Could not disconnect GitHub.'))
      setUser(null)
      resetPublish()
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Could not disconnect GitHub.')
    } finally { setBusy(false) }
  }

  const copyCode = async () => {
    if (!device) return
    try { await navigator.clipboard.writeText(device.userCode); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { setError('Copy is unavailable. Select the code manually.') }
  }

  const loadPreview = async () => {
    if (!repoName.trim()) { setError('Repository name is required.'); return }
    setBusy(true); setError(''); setSuccess(''); setStatus('Preparing publish preview…')
    try {
      const response = await fetch('/api/github/publish/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoName: repoName.trim(), privateRepo, commitMessage: commitMessage.trim() }) })
      if (!response.ok) throw new Error(await readError(response, 'Could not prepare publish preview.'))
      const result = await response.json() as PublishPreview
      setPreview(result)
      setStatus('Review the files and confirm the first push.')
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not prepare publish preview.')
      setStatus('')
    } finally { setBusy(false) }
  }

  const publish = async () => {
    if (!preview) return
    setBusy(true); setError(''); setStatus('Pushing project to GitHub…')
    try {
      const response = await fetch('/api/github/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: preview.ticket, confirmed: true }) })
      if (!response.ok) throw new Error(await readError(response, 'GitHub push failed.'))
      const result = await response.json() as { repository?: string }
      if (!result.repository) throw new Error('GitHub did not return a repository link.')
      setSuccess(result.repository)
      setStatus('Project pushed successfully.')
      setBusy(false)
      onPublished(result.repository)
    } catch (pushError) {
      setBusy(false)
      setError(pushError instanceof Error ? pushError.message : 'GitHub push failed.')
      setStatus('')
    }
  }

  const displayedFiles = useMemo(() => preview?.files ?? files.map((file) => ({ path: file.name, status: file.status })), [preview, files])

  if (!open) return null
  return <div className="modal-backdrop" role="presentation"><div className="confirm-modal github-modal" role="dialog" aria-modal="true" aria-labelledby="github-title">
    <button className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
    <div className="modal-icon">●</div>
    {!user ? <>
      <h2 id="github-title">Connect GitHub</h2>
      <p>Sign in with GitHub Device Flow. The access token stays in the local agent.</p>
      <div className="modal-summary"><span>1</span><b>First time here?</b><small>Create a GitHub OAuth App, enable Device Flow, then paste its client ID. <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">Open GitHub Developer settings ↗</a> · <a href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow" target="_blank" rel="noreferrer">Read Device Flow docs ↗</a></small></div>
      <label className="modal-label" htmlFor="github-client-id">OAuth client ID</label>
      <input id="github-client-id" className="modal-input" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Public client ID" disabled={Boolean(device) || busy} />
      {device ? <div className="device-flow"><p>Enter this one-time code on GitHub:</p><div className="device-code" aria-live="polite">{device.userCode}</div><div className="modal-actions"><button className="secondary-btn" onClick={() => void copyCode()}>{copied ? 'Copied' : 'Copy code'}</button><a className="primary-btn" href={device.verificationUri} target="_blank" rel="noreferrer">Open GitHub</a></div><p className="modal-help">Waiting for authorization. This code expires automatically.</p><button className="secondary-btn" onClick={cancelLogin}>Cancel authorization</button></div> : <div className="modal-actions"><button className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={() => void startLogin()} disabled={busy || !clientId.trim()}>{busy ? 'Starting…' : 'Login with GitHub'}</button></div>}
    </> : <>
      <h2 id="github-title">Publish to GitHub</h2>
      <p>Connected as <b>@{user.login}</b>. Review what will be committed and pushed from this workspace.</p>
      {!preview ? <>
        <label className="modal-label" htmlFor="repo-name">Repository name</label><input id="repo-name" className="modal-input" value={repoName} onChange={(event) => setRepoName(event.target.value.replace(/[^a-zA-Z0-9._-]/g, '-'))} placeholder="vibedeploy-gui" disabled={busy} />
        <label className="setting-row"><span>Private repository</span><input type="checkbox" checked={privateRepo} onChange={(event) => setPrivateRepo(event.target.checked)} disabled={busy} /></label>
        <div className="modal-summary"><span>⑂</span><b>{branch} · {files.length} files</b><small>Commit: {commitMessage || 'No commit message'}</small></div>
        <div className="modal-actions"><button className="secondary-btn" onClick={() => void logout()} disabled={busy}>Disconnect</button><button className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-btn" onClick={() => void loadPreview()} disabled={busy || !repoName.trim()}>Review publish</button></div>
      </> : <>
        <div className="modal-summary"><span>↑</span><b>{preview.repository ?? `@${user.login}/${repoName}`}</b><small>{preview.branch} · {preview.privateRepo ? 'Private' : 'Public'} · {preview.commitMessage}</small></div>
        <div className="publish-file-list">{displayedFiles.slice(0, 12).map((file) => <div className="check-row" key={file.path}><span className="check-icon">{file.status}</span><span>{file.path}</span></div>)}{displayedFiles.length > 12 && <div className="modal-help">+{displayedFiles.length - 12} more files</div>}{preview.excludedCount ? <div className="modal-help">{preview.excludedCount} ignored files excluded</div> : null}</div>
        {success ? <div className="modal-summary"><span>✓</span><b>Push complete</b><small><a href={success} target="_blank" rel="noreferrer">Open repository ↗</a></small></div> : <div className="modal-actions"><button className="secondary-btn" onClick={() => setPreview(null)} disabled={busy}>Back</button><button className="primary-btn" onClick={() => void publish()} disabled={busy}>{busy ? 'Pushing…' : 'Confirm and push'}</button></div>}
      </>}
    </>}
    {status && <p className="modal-help" role="status">{status}</p>}
    {error && <p className="modal-error" role="alert">{error}</p>}
  </div></div>
}
