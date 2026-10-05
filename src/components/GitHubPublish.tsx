import { useCallback, useEffect, useRef, useState } from 'react'

type GithubUser = { login: string; avatar_url?: string }
type Repository = { fullName: string; privateRepo: boolean }
type ChangedFile = { name: string; status: string; tone?: string; lines?: string }
type DeviceSession = { sessionId: string; userCode: string; verificationUri: string; interval: number; expiresAt: number }
type PublishPreview = {
  ticket: string
  projectRoot?: string
  files: Array<{ path: string; status: string }>
  excludedCount?: number
  branch: string
  targetBranch: string
  createNewBranch: boolean
  commit?: string
  repository: string
  repositoryFullName: string
  remote?: string
  privateRepo: boolean
  commitMessage: string
  authenticatedLogin: string
  requiresRemoteChange: boolean
  previousRemote?: string
  repositoryExists: boolean
}

type MainPreview = {
  ticket: string
  authenticatedLogin: string
  repository: string
  repositoryFullName: string
  sourceBranch: string
  sourceSha: string
  mainSha: string
  defaultBranch: string
  files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>
}
type MainSuccess = { repository: string; branch: 'main'; commit: string; branchUrl: string }

type PublishSuccess = { repository: string; branch: string; sourceBranch: string; branchUrl: string }

type Props = {
  open: boolean
  onClose: () => void
  commitMessage: string
  files: ChangedFile[]
  branch: string
  onPublished: (repository: string) => void
  onMainPublished?: (repository: string, commit: string) => void
}

const readError = async (response: Response, fallback: string) => {
  try {
    const body = await response.json() as { error?: string; message?: string }
    return body.error ?? body.message ?? fallback
  } catch { return fallback }
}

export default function GitHubPublish({ open, onClose, commitMessage, branch, onPublished, onMainPublished }: Props) {
  const [user, setUser] = useState<GithubUser | null>(null)
  const [clientId, setClientId] = useState(import.meta.env.VITE_GITHUB_CLIENT_ID ?? '')
  const [device, setDevice] = useState<DeviceSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [mode, setMode] = useState<'existing' | 'create'>('existing')
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [repositoryFullName, setRepositoryFullName] = useState('')
  const [manualRepository, setManualRepository] = useState('')
  const [useManual, setUseManual] = useState(false)
  const [failedRepositoryPage, setFailedRepositoryPage] = useState(1)
  const [repositoryPage, setRepositoryPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [repositoriesLoading, setRepositoriesLoading] = useState(false)
  const [repositoriesError, setRepositoriesError] = useState('')
  const [allowRemoteChange, setAllowRemoteChange] = useState(false)
  const [repoName, setRepoName] = useState('')
  const [privateRepo, setPrivateRepo] = useState(true)
  const [createNewBranch, setCreateNewBranch] = useState(false)
  const [targetBranch, setTargetBranch] = useState('')
  const [branchError, setBranchError] = useState('')
  const [branchConflict, setBranchConflict] = useState(false)
  const [preview, setPreview] = useState<PublishPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [success, setSuccess] = useState<PublishSuccess | null>(null)
  const [mainPreview, setMainPreview] = useState<MainPreview | null>(null)
  const [mainSuccess, setMainSuccess] = useState<MainSuccess | null>(null)
  const [confirmationName, setConfirmationName] = useState('')
  const [confirmationError, setConfirmationError] = useState('')
  const [copied, setCopied] = useState(false)
  const repositoryAbort = useRef<AbortController | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const branchInputRef = useRef<HTMLInputElement | null>(null)
  const focusBranchRequested = useRef(false)
  const reviewBackRef = useRef<HTMLButtonElement | null>(null)
  const mainCancelRef = useRef<HTMLButtonElement | null>(null)
  const confirmationInputRef = useRef<HTMLInputElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const busyRef = useRef(false)
  busyRef.current = busy
  const loginAbort = useRef<AbortController | null>(null)
  const pollAbort = useRef<AbortController | null>(null)

  const resetPublish = () => {
    setPreview(null)
    setError('')
    setBranchError('')
    setBranchConflict(false)
    setStatus('')
    setSuccess(null)
    setMainPreview(null); setMainSuccess(null); setConfirmationName(''); setConfirmationError('')
  }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError(''); setPreview(null); setSuccess(null); setStatus('')
    setRepositoryFullName(''); setManualRepository('')
    setRepoName(''); setPrivateRepo(true); setMode('existing'); setUseManual(false)
    setAllowRemoteChange(false); setUser(null); setSessionLoading(true)
    setCreateNewBranch(false); setTargetBranch(''); setBranchError(''); setBranchConflict(false)
    setMainPreview(null); setMainSuccess(null); setConfirmationName(''); setConfirmationError('')
    fetch('/api/github/session', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await readError(response, 'Could not check the GitHub account. Try again.'))
      const data = await response.json() as { user?: GithubUser | null }
      if (!controller.signal.aborted) setUser(data.user ?? null)
    }).catch((sessionError) => {
      if (!controller.signal.aborted) setError(sessionError instanceof Error ? sessionError.message : 'Could not check the GitHub account.')
    }).finally(() => { if (!controller.signal.aborted) setSessionLoading(false) })
    return () => controller.abort()
  }, [open])

  useEffect(() => {
    if (!open) return
    if (focusBranchRequested.current && !preview && createNewBranch) {
      focusBranchRequested.current = false
      branchInputRef.current?.focus()
    } else if (preview) reviewBackRef.current?.focus()
  }, [open, preview, createNewBranch])

  useEffect(() => {
    if (open && mainPreview) mainCancelRef.current?.focus()
  }, [open, mainPreview])

  const loadRepositories = useCallback(async (page: number) => {
    repositoryAbort.current?.abort()
    const controller = new AbortController()
    repositoryAbort.current = controller
    setRepositoriesLoading(true); setRepositoriesError(''); setFailedRepositoryPage(page)
    try {
      const response = await fetch(`/api/github/repositories?page=${page}`, { signal: controller.signal })
      if (!response.ok) throw new Error(await readError(response, 'Could not load repositories. Retry or enter the full repository name.'))
      const result = await response.json() as { repositories: Repository[]; hasMore: boolean }
      if (controller.signal.aborted) return
      if (!Array.isArray(result.repositories)) throw new Error('GitHub returned an incomplete repository list.')
      setRepositories((previous) => page === 1 ? result.repositories : [...new Map([...previous, ...result.repositories].map((repo) => [repo.fullName, repo])).values()])
      setHasMore(result.hasMore); setRepositoryPage(page)
    } catch (listError) {
      if (!controller.signal.aborted) setRepositoriesError(listError instanceof Error ? listError.message : 'Could not load repositories.')
    } finally { if (!controller.signal.aborted) setRepositoriesLoading(false) }
  }, [])

  useEffect(() => {
    setRepositories([]); setRepositoryPage(0); setHasMore(false); setRepositoriesError('')
    if (open && user) void loadRepositories(1)
    return () => repositoryAbort.current?.abort()
  }, [open, user, loadRepositories])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    const background = [...(dialogRef.current?.parentElement?.parentElement?.children ?? [])].filter((element) => element !== dialogRef.current?.parentElement && element instanceof HTMLElement) as HTMLElement[]
    const inertBefore = background.map((element) => element.inert)
    background.forEach((element) => { element.inert = true })
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const targets = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')
      if (!targets?.length) { event.preventDefault(); return }
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = previousOverflow; background.forEach((element, index) => { element.inert = inertBefore[index] }); previousFocus?.focus() }
  }, [open])

  useEffect(() => {
    if (open) return
    loginAbort.current?.abort()
    pollAbort.current?.abort()
    setDevice(null)
    setBusy(false)
  }, [open])

  useEffect(() => () => { loginAbort.current?.abort(); repositoryAbort.current?.abort(); pollAbort.current?.abort() }, [])

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
          setError('')
          setStatus('GitHub connected. Choose a repository for this account.')
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
    const controller = new AbortController()
    loginAbort.current?.abort(); loginAbort.current = controller
    setBusy(true); setError(''); setStatus('Starting GitHub device login…')
    try {
      const response = await fetch('/api/github/device/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: clientId.trim() }), signal: controller.signal })
      if (!response.ok) throw new Error(await readError(response, 'GitHub login could not start.'))
      const result = await response.json() as { sessionId: string; userCode?: string; user_code?: string; verificationUri?: string; verification_uri?: string; verificationUriComplete?: string; interval?: number; expiresAt?: number; expires_in?: number }
      if (controller.signal.aborted) return
      const userCode = result.userCode ?? result.user_code
      const verificationUri = result.verificationUriComplete ?? result.verificationUri ?? result.verification_uri
      if (!result.sessionId || !userCode || !verificationUri) throw new Error('GitHub returned an incomplete device login session.')
      const expiresAt = result.expiresAt ?? Date.now() + Math.max(60, result.expires_in ?? 900) * 1000
      setDevice({ sessionId: result.sessionId, userCode, verificationUri, interval: Math.max(1, result.interval ?? 5), expiresAt })
      window.open(verificationUri, '_blank', 'noopener,noreferrer')
    } catch (loginError) {
      if (controller.signal.aborted) return
      setBusy(false)
      setError(loginError instanceof Error ? loginError.message : 'GitHub login could not start.')
    }
  }

  const cancelLogin = () => {
    loginAbort.current?.abort()
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
      repositoryAbort.current?.abort()
      setUser(null); setRepositoryFullName(''); setManualRepository('')
      setRepoName(''); setAllowRemoteChange(false); setUseManual(false); setMode('existing')
      setCreateNewBranch(false); setTargetBranch('')
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
    if (busyRef.current) return
    let destination = (useManual ? manualRepository : repositoryFullName).trim()
    if (mode === 'existing' && !destination) { setError('Choose a repository or enter its full owner/repository name.'); return }
    if (mode === 'create' && !repoName.trim()) { setError('New repository name is required.'); return }
    if (createNewBranch && !targetBranch.trim()) {
      setBranchError('Enter a name for the new GitHub branch.')
      branchInputRef.current?.focus()
      return
    }
    if (mode === 'existing') {
      const urlMatch = /^https:\/\/github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)\/?$/i.exec(destination)
      if (urlMatch) destination = `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/i, '')}`
      if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(destination) || ['.', '..'].includes(destination.split('/')[1])) {
        setError('Enter owner/repository or its https://github.com/owner/repository URL, without extra paths, credentials, or query parameters.')
        document.getElementById('github-manual-repository')?.focus()
        return
      }
    }
    busyRef.current = true
    setBusy(true); setError(''); setBranchError(''); setBranchConflict(false); setSuccess(null); setStatus('Preparing publish preview…')
    try {
      const response = await fetch('/api/github/publish/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, repositoryFullName: mode === 'existing' ? destination : undefined, repoName: mode === 'create' ? repoName.trim() : undefined, privateRepo, commitMessage: commitMessage.trim(), allowRemoteChange, createNewBranch, targetBranch: createNewBranch ? targetBranch.trim() : undefined }) })
      if (!response.ok) throw new Error(await readError(response, 'Could not prepare publish preview.'))
      const result = await response.json() as PublishPreview
      if (!result.ticket || !result.repository || !result.authenticatedLogin || !Array.isArray(result.files) || !result.branch || !result.targetBranch || typeof result.createNewBranch !== 'boolean') throw new Error('The publish preview is incomplete. Please try again.')
      if (result.authenticatedLogin !== user?.login) { throw new Error('The connected GitHub account changed. Reconnect and confirm the account again.') }
      setPreview(result)
      setStatus('Review the destination and files before confirming the push.')
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not prepare publish preview.')
      setStatus('')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const publish = async () => {
    if (!preview || busyRef.current || branchConflict || success) return
    busyRef.current = true
    setBusy(true); setError(''); setBranchConflict(false); setStatus('Pushing project to GitHub…')
    try {
      const response = await fetch('/api/github/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: preview.ticket, confirmed: true }) })
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { code?: string; error?: string; message?: string }
        if (response.status === 409 && failure.code === 'NON_FAST_FORWARD') {
          setBranchConflict(true)
          throw new Error(`GitHub branch “${preview.targetBranch}” has history that this push cannot safely update. Choose a new branch to preserve the existing branch.`)
        }
        throw new Error(failure.error ?? failure.message ?? 'GitHub push failed. Review the destination and try again.')
      }
      const result = await response.json() as PublishSuccess
      if (!result.repository || !result.branch || !result.sourceBranch || !result.branchUrl) throw new Error('GitHub did not return a complete branch confirmation. Review the repository before trying again.')
      setSuccess(result)
      setStatus('Project pushed successfully.')
      onPublished(result.repository)
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : 'GitHub push failed.')
      setStatus('')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const chooseNewBranch = () => {
    if (busyRef.current) return
    resetPublish()
    setTargetBranch('')
    focusBranchRequested.current = true
    setCreateNewBranch(true)
  }

  const loadMainPreview = async () => {
    if (busyRef.current || !preview || !success || !preview.createNewBranch) return
    busyRef.current = true
    setBusy(true); setError(''); setStatus('Preparing main replacement preview…')
    setMainSuccess(null); setConfirmationName(''); setConfirmationError('')
    try {
      const response = await fetch('/api/github/main/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repositoryFullName: preview.repositoryFullName, sourceBranch: success.branch }) })
      if (!response.ok) throw new Error(await readError(response, 'Could not prepare the main replacement preview.'))
      const result = await response.json() as MainPreview
      if (!result.ticket || !result.repository || !result.repositoryFullName || !result.sourceBranch || !result.sourceSha || !result.mainSha || typeof result.authenticatedLogin !== 'string' || !result.authenticatedLogin || typeof result.defaultBranch !== 'string' || !result.defaultBranch || !Array.isArray(result.files)) throw new Error('The main replacement preview is incomplete. Please try again.')
      if (result.authenticatedLogin !== user?.login || result.repositoryFullName !== preview.repositoryFullName || result.sourceBranch !== success.branch) throw new Error('The account or destination changed. Review the published branch before continuing.')
      setMainPreview(result)
      setStatus('Review every file change before replacing files in main.')
    } catch (mainError) {
      setError(mainError instanceof Error ? mainError.message : 'Could not prepare the main replacement preview.')
      setStatus('')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const replaceMain = async () => {
    if (busyRef.current || !mainPreview || mainSuccess) return
    if (confirmationName !== mainPreview.repositoryFullName) {
      setConfirmationError(`Type ${mainPreview.repositoryFullName} exactly to confirm.`)
      confirmationInputRef.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true); setError(''); setConfirmationError(''); setStatus('Replacing files in main…')
    try {
      const response = await fetch('/api/github/main/replace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: mainPreview.ticket, confirmed: true, confirmationName }) })
      if (!response.ok) throw new Error(await readError(response, 'Could not replace files in main. Review a fresh preview before retrying.'))
      const result = await response.json() as MainSuccess
      if (!result.repository || result.branch !== 'main' || !result.commit || !result.branchUrl) throw new Error('GitHub did not return a verified main confirmation. Check main before retrying.')
      setMainSuccess(result)
      setStatus('Main now contains the published version.')
      onMainPublished?.(result.repository, result.commit)
    } catch (mainError) {
      setError(mainError instanceof Error ? mainError.message : 'Could not replace files in main.')
      setStatus('')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const cancelMainPreview = () => {
    if (busyRef.current) return
    setMainPreview(null); setConfirmationName(''); setConfirmationError(''); setError(''); setStatus('Published branch retained.')
  }

  const displayedFiles = preview?.files ?? []
  const mainFileCounts = mainPreview?.files.reduce((counts, file) => ({ ...counts, [file.status]: counts[file.status] + 1 }), { added: 0, modified: 0, deleted: 0 })

  if (!open) return null
  return <div className="modal-backdrop" role="presentation"><div ref={dialogRef} tabIndex={-1} className="confirm-modal github-modal" role="dialog" aria-modal="true" aria-labelledby="github-title" aria-busy={busy || sessionLoading}>
    <button className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
    <div className="modal-icon">●</div>
    {sessionLoading ? <><h2 id="github-title">Connect GitHub</h2><p role="status">Checking the connected GitHub account…</p></> : !user ? <>
      <h2 id="github-title">Connect GitHub</h2>
      <p>Sign in with GitHub Device Flow. The access token stays in the local agent.</p>
      <div className="modal-summary"><span>1</span><b>First time here?</b><small>Create a GitHub OAuth App, enable Device Flow, then paste its client ID. <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">Open GitHub Developer settings ↗</a> · <a href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow" target="_blank" rel="noreferrer">Read Device Flow docs ↗</a></small></div>
      <label className="modal-label" htmlFor="github-client-id">OAuth client ID</label>
      <input id="github-client-id" className="modal-input" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Public client ID" disabled={Boolean(device) || busy} />
      {device ? <div className="device-flow"><p>Enter this one-time code on GitHub:</p><div className="device-code" aria-live="polite">{device.userCode}</div><div className="modal-actions"><button className="secondary-btn" onClick={() => void copyCode()}>{copied ? 'Copied' : 'Copy code'}</button><a className="primary-btn" href={device.verificationUri} target="_blank" rel="noreferrer">Open GitHub</a></div><p className="modal-help">Waiting for authorization. This code expires automatically.</p><button className="secondary-btn" onClick={cancelLogin}>Cancel authorization</button></div> : <div className="modal-actions"><button className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={() => void startLogin()} disabled={busy || !clientId.trim()}>{busy ? 'Starting…' : 'Login with GitHub'}</button></div>}
    </> : <>
      <h2 id="github-title">Publish to GitHub</h2>
      <div className="github-account"><p>Connected as <b>@{user.login}</b></p><button className="secondary-btn" onClick={() => void logout()} disabled={busy}>Switch account</button></div>
      {!preview ? <>
        <fieldset className="github-mode" disabled={busy}><legend>Repository destination</legend><label><input type="radio" name="github-publish-mode" checked={mode === 'existing'} onChange={() => { setMode('existing'); resetPublish() }} /> Existing repository</label><label><input type="radio" name="github-publish-mode" checked={mode === 'create'} onChange={() => { setMode('create'); resetPublish() }} /> Create new repository</label></fieldset>
        {mode === 'existing' ? <>
          <label className="modal-label" htmlFor="github-repository">Choose an existing repository</label>
          <select id="github-repository" className="modal-input" value={repositoryFullName} onChange={(event) => { setRepositoryFullName(event.target.value); setUseManual(false); resetPublish() }} disabled={busy || repositoriesLoading} aria-describedby="github-repository-help">
            <option value="">Choose a repository…</option>
            {repositories.map((repository) => <option key={repository.fullName} value={repository.fullName}>{repository.fullName} · {repository.privateRepo ? 'Private' : 'Public'}</option>)}
          </select>
          <p id="github-repository-help" className="modal-help">Choose the exact owner and repository. Nothing is selected automatically.</p>
          {repositoriesLoading && <p className="modal-help" role="status">Loading repositories…</p>}
          {!repositoriesLoading && !repositoriesError && repositories.length === 0 && <p className="modal-help">No accessible repositories found. Enter the full name below or create a new repository.</p>}
          {repositoriesError && <p className="modal-error" role="alert"><span aria-hidden="true">⚠</span> {repositoriesError}</p>}
          {(hasMore || repositoriesError) && <button className="secondary-btn" onClick={() => void loadRepositories(repositoriesError ? failedRepositoryPage : repositoryPage + 1)} disabled={busy || repositoriesLoading}>{repositoriesError ? 'Retry repositories' : 'Load more repositories'}</button>}
          <label className="setting-row github-consent"><input type="checkbox" checked={useManual} onChange={(event) => { setUseManual(event.target.checked); resetPublish() }} disabled={busy} /><span>Enter a repository name or URL instead</span></label>
          {useManual && <><label className="modal-label" htmlFor="github-manual-repository">Full repository name or GitHub HTTPS URL</label><input id="github-manual-repository" className="modal-input" value={manualRepository} onChange={(event) => { setManualRepository(event.target.value); resetPublish() }} aria-invalid={Boolean(error)} aria-describedby={error ? 'github-publish-error' : undefined} placeholder="owner/repository or https://github.com/owner/repository" disabled={busy} autoCapitalize="none" spellCheck={false} /></>}
        </> : <>
          <label className="modal-label" htmlFor="repo-name">New repository name</label><input id="repo-name" className="modal-input" value={repoName} onChange={(event) => { setRepoName(event.target.value); resetPublish() }} placeholder="Enter a new repository name" disabled={busy} autoCapitalize="none" spellCheck={false} />
          <p className="modal-help">Create under @{user.login}. The name must not already exist.</p>
          <label className="setting-row"><span>Private repository</span><input type="checkbox" checked={privateRepo} onChange={(event) => { setPrivateRepo(event.target.checked); resetPublish() }} disabled={busy} /></label>
        </>}
        <fieldset className="github-mode" disabled={busy}><legend>GitHub branch destination</legend><label><input type="radio" name="github-branch-mode" checked={!createNewBranch} onChange={() => { setCreateNewBranch(false); resetPublish() }} /> Current local branch</label><label><input type="radio" name="github-branch-mode" checked={createNewBranch} onChange={() => { focusBranchRequested.current = true; setCreateNewBranch(true); resetPublish() }} /> Create new branch</label></fieldset>
        {createNewBranch ? <>
          <label className="modal-label" htmlFor="github-target-branch">New GitHub branch name</label>
          <input ref={branchInputRef} id="github-target-branch" className="modal-input" value={targetBranch} onChange={(event) => { setTargetBranch(event.target.value); resetPublish() }} placeholder="e.g. vibedeploy/mvp" disabled={busy} autoCapitalize="none" autoComplete="off" spellCheck={false} aria-invalid={Boolean(branchError)} aria-describedby={branchError ? 'github-branch-help github-branch-error' : 'github-branch-help'} />
          <p id="github-branch-help" className="modal-help">Create new branch; existing branches will not be force-updated. The preview checks that this name is available.</p>
          {branchError && <p id="github-branch-error" className="modal-error" role="alert"><span aria-hidden="true">⚠</span> {branchError}</p>}
        </> : <p className="modal-help">Workspace branch: {branch || 'Not yet confirmed'}. The preview verifies the actual local branch and uses the same name on GitHub.</p>}
        <label className="setting-row github-consent"><input type="checkbox" checked={allowRemoteChange} onChange={(event) => { setAllowRemoteChange(event.target.checked); resetPublish() }} disabled={busy} /><span>If the current origin differs, change it to this repository on confirmed push</span></label>
        <p className="modal-help">The preview checks the current branch, files, repository visibility, and origin.</p>
        <div className="modal-actions"><button className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-btn" onClick={() => void loadPreview()} disabled={busy || (mode === 'existing' ? !(useManual ? manualRepository.trim() : repositoryFullName) : !repoName.trim())}>{busy ? 'Preparing…' : 'Review publish'}</button></div>
      </> : <>
        <div className="modal-summary"><span>↑</span><b>{preview.repositoryFullName || preview.repository.replace('https://github.com/', '')}</b><small>Account: @{preview.authenticatedLogin}<br />Local: {preview.branch} → GitHub: {preview.targetBranch}<br />{preview.privateRepo ? 'Private' : 'Public'}<br />{preview.repositoryExists ? 'Existing repository' : 'Create new repository'}<br />{preview.createNewBranch ? 'Create new branch; existing branches will not be force-updated' : 'Update the GitHub branch with the current local branch name; no force push'}<br />Commit: {preview.commitMessage}</small></div>
        {preview.requiresRemoteChange && <div className="modal-summary github-origin"><span>↗</span><b>Change origin on confirmed push</b><small>From: {preview.previousRemote || 'No origin'}<br />To: {preview.repository}.git</small></div>}
        {!preview.requiresRemoteChange && preview.remote && <p className="modal-help">Origin: {preview.remote}</p>}
        {!success && <><p className="modal-help">{displayedFiles.length} files in this preview</p>
        <div className="publish-file-list">{displayedFiles.slice(0, 12).map((file) => <div className="check-row" key={file.path}><span className="check-icon">{file.status}</span><span>{file.path}</span></div>)}{displayedFiles.length > 12 && <div className="modal-help">+{displayedFiles.length - 12} more files</div>}{preview.excludedCount ? <div className="modal-help">{preview.excludedCount} ignored files excluded</div> : null}</div></>}
        {success ? <>
          <div className="modal-summary github-success" role="status"><span aria-hidden="true">✓</span><b>Push complete · {success.branch}</b><small>Local: {success.sourceBranch} → GitHub: {success.branch}<br /><a href={success.branchUrl} target="_blank" rel="noreferrer">Open branch ↗</a> · <a href={success.repository} target="_blank" rel="noreferrer">Open repository ↗</a></small></div>
          {preview.createNewBranch && success.branch !== 'main' && !mainPreview && !mainSuccess && <div className="github-main-entry"><p className="modal-help">Publish this version to main after reviewing its file changes.</p><button className="secondary-btn" onClick={() => void loadMainPreview()} disabled={busy}>Make this version main</button></div>}
          {mainPreview && !mainSuccess && <section className="github-main-review" aria-labelledby="github-main-title">
            <h3 id="github-main-title">Replace main files?</h3>
            <p>Replace files in main with this published branch. Commit history is preserved.</p>
            {mainPreview.defaultBranch !== 'main' && <p className="modal-help">Default branch will change from {mainPreview.defaultBranch} to main.</p>}
            <div className="modal-summary github-main-consequence"><span aria-hidden="true">⚠</span><b>{mainPreview.repositoryFullName}</b><small>Account: @{mainPreview.authenticatedLogin}<br />Published branch: {mainPreview.sourceBranch} ({mainPreview.sourceSha.slice(0, 8)}) → main ({mainPreview.mainSha.slice(0, 8)})<br />{mainFileCounts?.added} added · {mainFileCounts?.modified} replaced · {mainFileCounts?.deleted} deleted</small></div>
            <p className="modal-help">Files absent from the published branch will be deleted from main. Review all changes below.</p>
            <div className="publish-file-list github-main-files" aria-label="Files changing in main">{mainPreview.files.length ? mainPreview.files.map((file) => <div className="check-row" key={file.path}><span className={`github-file-status github-file-${file.status}`}>{file.status}</span><span>{file.path}</span></div>) : <p className="modal-help">The file contents already match this published branch.</p>}</div>
            <label className="modal-label" htmlFor="github-main-confirmation">Type {mainPreview.repositoryFullName} to confirm</label>
            <input ref={confirmationInputRef} id="github-main-confirmation" className="modal-input" value={confirmationName} onChange={(event) => { setConfirmationName(event.target.value); setConfirmationError('') }} disabled={busy} autoCapitalize="none" autoComplete="off" spellCheck={false} aria-invalid={Boolean(confirmationError)} aria-describedby={confirmationError ? 'github-main-confirmation-error' : undefined} />
            {confirmationError && <p id="github-main-confirmation-error" className="modal-error" role="alert"><span aria-hidden="true">⚠</span> {confirmationError}</p>}
            <div className="modal-actions"><button ref={mainCancelRef} className="secondary-btn" onClick={cancelMainPreview} disabled={busy}>Cancel</button><button className="github-replace-main" onClick={() => void replaceMain()} disabled={busy || confirmationName !== mainPreview.repositoryFullName}>{busy ? 'Replacing…' : 'Replace main files'}</button></div>
          </section>}
          {mainSuccess && <div className="modal-summary github-success" role="status"><span aria-hidden="true">✓</span><b>Main updated</b><small>The published version is now in main.<br /><a href={mainSuccess.branchUrl} target="_blank" rel="noreferrer">Open main ↗</a> · <a href={mainSuccess.repository} target="_blank" rel="noreferrer">Open repository ↗</a></small></div>}
        </> : <div className="modal-actions"><button ref={reviewBackRef} className="secondary-btn" onClick={resetPublish} disabled={busy}>Back</button><button className="primary-btn" onClick={() => void publish()} disabled={busy || branchConflict || (preview.requiresRemoteChange && !allowRemoteChange)}>{busy ? 'Pushing…' : 'Confirm and push'}</button></div>}
      </>}
    </>}
    {status && <p className="modal-help" role="status">{status}</p>}
    {error && <div className="github-error"><p id="github-publish-error" className="modal-error" role="alert"><span aria-hidden="true">⚠</span> {error}</p>{branchConflict && <button className="secondary-btn" onClick={chooseNewBranch} disabled={busy}>Choose a new branch</button>}</div>}
  </div></div>
}
