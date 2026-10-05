import { useEffect, useMemo, useState } from 'react'
import './styles.css'
import GitHubPublish from './components/GitHubPublish'
type ConfirmKind = 'commit' | 'deploy' | null
type ModalKind = 'workspace' | 'settings' | 'account' | 'environment' | 'search' | 'notifications' | 'more' | 'branch' | 'event' | 'github' | null
type Tab = 'changes' | 'activity' | 'chat'
type Project = { name: string; branch: string; tone: string; status: string }

const files = [
  { name: 'src/components/Hero.tsx', status: 'M', tone: 'amber', lines: '+18 −6' },
  { name: 'src/styles/tokens.css', status: 'M', tone: 'amber', lines: '+9 −2' },
  { name: 'tests/hero.spec.ts', status: 'A', tone: 'green', lines: '+42' },
]

const timeline = [
  { icon: '✦', color: 'violet', category: 'AI', title: 'AI prepared changes', body: 'Refined hero copy and added responsive states', time: '2 min ago', meta: '3 files · 69 additions' },
  { icon: '✓', color: 'green', category: 'Checks', title: 'Checks passed', body: 'Typecheck · Unit tests · Lint', time: '1 min ago', meta: '42 tests passed' },
  { icon: '●', color: 'blue', category: 'Git', title: 'Workspace connected', body: 'origin/github.com/acme/launchpad', time: 'Today, 10:32', meta: 'main · 4f28a1c' },
]

export default function App() {
  const [projects, setProjects] = useState<Project[]>([
    { name: 'Launchpad', branch: 'main · connected', tone: 'purple', status: 'online' },
    { name: 'Marketing site', branch: 'feat/refresh', tone: 'blue', status: 'online' },
    { name: 'Side project', branch: 'main · offline', tone: 'orange', status: 'offline' },
  ])
  const [activeProject, setActiveProject] = useState('Launchpad')
  const [activeFile, setActiveFile] = useState(files[0].name)
  const [activeTab, setActiveTab] = useState<Tab>('changes')
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [modal, setModal] = useState<ModalKind>(null)
  const [toast, setToast] = useState('')
  const [query, setQuery] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [diffSize, setDiffSize] = useState(11)
  const [fullscreenDiff, setFullscreenDiff] = useState(false)
  const [activityFilter, setActivityFilter] = useState('All activity')
  const [beginnerMode, setBeginnerMode] = useState(false)
  const [checkState, setCheckState] = useState<'passed' | 'running'>('passed')
  const [chatMessages, setChatMessages] = useState<string[]>([])
  const [commitMessage, setCommitMessage] = useState('feat: refine launchpad hero experience')
  const [changesCommitted, setChangesCommitted] = useState(false)
  const [pushComplete, setPushComplete] = useState(false)
  const [deploymentState, setDeploymentState] = useState<'idle' | 'building' | 'ready'>('idle')
  const [activityEvents, setActivityEvents] = useState(timeline)
  const [alwaysConfirm, setAlwaysConfirm] = useState(true)
  const [showTimeline, setShowTimeline] = useState(true)

  const active = projects.find((project) => project.name === activeProject) ?? projects[0]
  const filteredFiles = useMemo(() => (changesCommitted ? [] : files).filter((file) => file.name.toLowerCase().includes(query.toLowerCase())), [query, changesCommitted])
  const filteredActivity = useMemo(() => activityFilter === 'All activity' ? activityEvents : activityEvents.filter((event) => event.category === activityFilter.replace(' events', '')), [activityFilter, activityEvents])

  const closeModal = () => { setModal(null); setQuery('') }
  const queueToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000) }
  const appendEvent = (event: typeof timeline[number]) => setActivityEvents((items) => [{ ...event, time: 'Just now' }, ...items])
  const runChecks = () => {
    if (checkState === 'running') return
    setCheckState('running')
    appendEvent({ icon: '◌', color: 'green', category: 'Checks', title: 'Checks running', body: 'Typecheck · Unit tests · Lint', time: 'Just now', meta: 'In progress' })
    queueToast('Checks running')
    window.setTimeout(() => {
      setCheckState('passed')
      appendEvent({ icon: '✓', color: 'green', category: 'Checks', title: 'Checks passed', body: 'Typecheck · Unit tests · Lint', time: 'Just now', meta: '42 tests passed' })
      queueToast('Checks passed')
    }, 1200)
  }
  const confirmAction = () => {
    const action = confirm
    if (!action) return
    if (action === 'commit' && !commitMessage.trim()) {
      queueToast('Add a commit message first')
      return
    }
    if (action === 'commit') {
      setChangesCommitted(true)
      appendEvent({ icon: '✓', color: 'green', category: 'Git', title: 'Changes committed', body: commitMessage.trim(), time: 'Just now', meta: 'Local commit' })
    }
    if (action === 'deploy') {
      setDeploymentState('building')
      appendEvent({ icon: '▲', color: 'green', category: 'Deploy', title: 'Staging deploy started', body: 'Building the current commit on Vercel', time: 'Just now', meta: 'Vercel · staging' })
      window.setTimeout(() => { setDeploymentState('ready'); queueToast('Staging deploy ready') }, 1400)
    }
    queueToast(action === 'deploy' ? 'Staging deploy queued' : 'Commit queued')
    setConfirm(null)
  }
  const addWorkspace = () => {
    const name = workspaceName.trim()
    if (!name) return
    setProjects((items) => [...items, { name, branch: 'main · connected', tone: 'purple', status: 'online' }])
    setActiveProject(name)
    setWorkspaceName('')
    closeModal()
    queueToast(`${name} connected`)
  }
  const sendChat = () => { setChatMessages((messages) => [...messages, 'Inspect the current changes and tell me what is ready to ship.']); setActiveTab('chat'); queueToast('AI prompt sent') }

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Projects navigation">
      <div className="brand"><span className="brand-mark">V</span><span>vibe<span className="brand-accent">deploy</span></span><span className="beta">BETA</span></div>
      <div className="side-label">WORKSPACES <button className="icon-btn" aria-label="Add workspace" onClick={() => setModal('workspace')}>＋</button></div>
      <nav className="projects">
        {projects.map((project) => <button key={project.name} className={`project ${activeProject === project.name ? 'active' : ''}`} onClick={() => { setActiveProject(project.name); setActiveTab('changes'); queueToast(`${project.name} selected`) }}><span className={`project-dot ${project.tone}`}/><span><b>{project.name}</b><small>{project.branch}</small></span>{project.status === 'online' && <span className="status-dot"/>}</button>)}
      </nav>
      <div className="side-label env-label">ENVIRONMENTS</div>
      <button className="environment" onClick={() => setModal('environment')}><span className="env-dot"/><span><b>staging</b><small>launchpad-preview.vercel.app</small></span><span className="chevron">↗</span></button>
      <div className="sidebar-bottom"><button className="bottom-link" onClick={() => setActiveTab('activity')}>◌ <span>Activity</span><em>3</em></button><button className="bottom-link" onClick={() => setModal('settings')}>⚙ <span>Settings</span></button><div className="user"><span className="avatar">SN</span><span><b>Sergey</b><small>Personal plan</small></span><button className="more" aria-label="Open account menu" onClick={() => setModal('account')}>•••</button></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><span className="muted">{activeProject}</span><span>/</span><b>Workspace</b></div><div className="top-actions"><span className="agent-status"><span className="pulse"/> Agent online</span><button className="github-connect" onClick={() => setModal('github')}>Connect GitHub</button><button className="top-icon" aria-label="Search" onClick={() => setModal('search')}>⌕</button><button className="top-icon" aria-label="Notifications" onClick={() => setModal('notifications')}>♧<i/></button><button className="top-avatar" aria-label="Open profile" onClick={() => setModal('account')}>SN</button></div></header>
      <section className="workspace-header"><div><div className="eyebrow">WORKSPACE <span className="live-pill">LIVE</span></div><h1>{activeProject}</h1><p className="subtitle"><span className="branch-icon">⑂</span> {active.branch.split(' · ')[0]} <span className="divider">·</span> <span className="commit-hash">4f28a1c</span> <span className="divider">·</span> {changesCommitted ? 'Working tree clean' : `${files.length} changes ready`}</p></div><div className="header-actions"><button className="secondary-btn" onClick={() => setModal('more')}>⋯ <span>More</span></button><button className="deploy-btn" onClick={() => setConfirm('deploy')} disabled={deploymentState === 'building'}><span>▲</span> {deploymentState === 'building' ? 'Deploying…' : 'Deploy to staging'}</button></div></section>

      <div className="content-grid">
        <section className="center-column">
          <div className="section-tabs" role="tablist"><button className={`tab ${activeTab === 'changes' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'changes'} onClick={() => setActiveTab('changes')}>Changes <span>3</span></button><button className={`tab ${activeTab === 'activity' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'activity'} onClick={() => setActiveTab('activity')}>Activity <span>8</span></button><button className={`tab ${activeTab === 'chat' ? 'active' : ''}`} role="tab" aria-selected={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>AI chat</button></div>
          {activeTab === 'changes' && <div className="changes-card card"><div className="card-heading"><div><h2>{changesCommitted ? 'Working tree clean' : 'Changes ready to commit'}</h2><p>{changesCommitted ? 'All reviewed changes are committed locally.' : 'AI reviewed these changes and found no blockers.'}</p></div><span className="ready-badge"><span>✓</span> {changesCommitted ? 'Committed' : 'Ready'}</span></div>
            <div className="file-list" role="list">{filteredFiles.map((file) => <button key={file.name} className={`file-row ${activeFile === file.name ? 'selected' : ''}`} onClick={() => setActiveFile(file.name)} role="listitem"><span className={`file-status ${file.tone}`}>{file.status}</span><span className="file-name">{file.name}</span><span className="file-lines">{file.lines}</span><span className="file-chevron">›</span></button>)}{filteredFiles.length === 0 && <div className="empty-state">No matching files</div>}</div>
            <div className="diff-header"><span>Diff preview</span><span className="diff-path">{activeFile || 'No pending changes'}</span><span className="diff-controls"><button aria-label="Decrease diff font size" onClick={() => setDiffSize((size) => Math.max(9, size - 1))}>−</button><button aria-label="Increase diff font size" onClick={() => setDiffSize((size) => Math.min(18, size + 1))}>＋</button><button aria-label="Open diff in full screen" onClick={() => setFullscreenDiff(true)} disabled={changesCommitted}>↗</button></span></div>
            <div className="diff-view" aria-label="Diff preview" style={{ fontSize: diffSize }}>{changesCommitted ? <div className="empty-state">No pending diff. Make another AI change to continue.</div> : <><div className="code-line dim"><span>1</span><code>  <i>export default function Hero() &#123;</i></code></div><div className="code-line removed"><span>2</span><code>-   return &lt;section className="hero"&gt;</code></div><div className="code-line added"><span>2</span><code>+   return &lt;section className="hero" aria-labelledby="hero-title"&gt;</code></div><div className="code-line added"><span>3</span><code>+     &lt;Badge&gt;Ship faster&lt;/Badge&gt;</code></div><div className="code-line dim"><span>4</span><code>      &lt;h1 id="hero-title"&gt;Build without the busywork.&lt;/h1&gt;</code></div><div className="code-line dim"><span>5</span><code>  &#125;</code></div></>}</div>
            <div className="commit-row"><div className="commit-message"><span className="sparkle">✦</span><input aria-label="Commit message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} disabled={changesCommitted}/></div><button className="outline-btn" onClick={() => setConfirm('commit')} disabled={changesCommitted}>Commit changes</button><button className="primary-btn" onClick={() => setModal('github')} disabled={pushComplete}>{pushComplete ? 'Пуш выполнен' : 'Commit &amp; пуш'} <span>⌘↵</span></button></div>
          </div>}
          {activeTab === 'activity' && <div className="card activity-view"><div className="card-heading"><div><h2>Workspace activity</h2><p>Every AI, Git and deployment operation in this workspace.</p></div><button className="filter-btn" onClick={() => setActivityFilter(activityFilter === 'All activity' ? 'Git events' : activityFilter === 'Git events' ? 'AI events' : activityFilter === 'AI events' ? 'Checks events' : 'All activity')}>{activityFilter}⌄</button></div>{showTimeline ? <div className="timeline">{filteredActivity.length ? filteredActivity.map((event, index) => <div className="timeline-item" key={`${event.title}-${event.time}-${index}`}><div className={`timeline-icon ${event.color}`}>{event.icon}</div><div className="timeline-content"><div className="event-title">{event.title}<time>{event.time}</time></div><p>{event.body}</p><span className="event-meta">{event.meta}</span></div></div>) : <div className="empty-state">No events in this filter</div>}</div> : <div className="empty-state">Timeline is hidden in workspace settings.</div>}</div>}
          {activeTab === 'chat' && <div className="card chat-view"><div className="card-heading"><div><h2>Vibe agent</h2><p>Ask for a review, a change, or a deploy plan.</p></div><span className="ready-badge">● connected</span></div><div className="chat-messages"><div className="chat-bubble agent">I can inspect the current diff, run checks, and prepare the next safe action.</div>{chatMessages.map((message, index) => <div className="chat-bubble user" key={`${message}-${index}`}>{message}</div>)}</div><button className="primary-btn chat-action" onClick={() => { setChatMessages((messages) => [...messages, 'Review complete: 3 files are ready and checks are passing.']); queueToast('AI review complete') }}>Run AI review</button></div>}
        </section>
        <aside className="right-column"><div className="agent-card card"><div className="agent-heading"><span className="agent-orb">✦</span><div><h2>Vibe agent</h2><p>Ready to help with this workspace</p></div><span className="online-dot"/></div><div className="agent-prompt"><span className="sparkle">✦</span><span>Ask me to inspect, change or ship your code...</span><button aria-label="Send prompt" onClick={sendChat}>↑</button></div><div className="quick-actions"><button onClick={() => { setActiveTab('changes'); queueToast('Review opened') }}>Review changes <span>↗</span></button><button onClick={runChecks}>Run checks <span>▶</span></button><button onClick={() => setBeginnerMode((value) => !value)}>Beginner mode <span>?</span></button></div>{beginnerMode && <div className="beginner-hint">Beginner mode is on. Each action will explain what it does before running.</div>}</div>
          <div className="action-card card"><div className="card-heading compact"><h2>Actions</h2><span className="lock-icon">⌑</span></div><button className="action-row" onClick={() => setConfirm('commit')}><span className="action-icon violet-bg">⌁</span><span><b>Commit changes</b><small>3 files · local only</small></span><span className="row-arrow">›</span></button><button className="action-row" onClick={() => setModal('github')}><span className="action-icon blue-bg">↑</span><span><b>Пуш в GitHub</b><small>origin / main · действие с подтверждением</small></span><span className="row-arrow">›</span></button><button className="action-row" onClick={() => setConfirm('deploy')}><span className="action-icon green-bg">▲</span><span><b>Deploy to staging</b><small>Vercel · preview</small></span><span className="row-arrow">›</span></button><div className="actions-note"><span>⌑</span> Dangerous actions always require confirmation</div></div>
          <div className="checks-card card"><div className="card-heading compact"><h2>Checks</h2><span className="passed">{checkState === 'running' ? '◌ Running' : '✓ All passed'}</span></div><div className="check-row"><span className="check-icon">✓</span><span>Typecheck</span><time>4.2s</time></div><div className="check-row"><span className="check-icon">✓</span><span>Unit tests <small>42 passed</small></span><time>8.1s</time></div><div className="check-row"><span className="check-icon">✓</span><span>Lint</span><time>1.8s</time></div><button className="rerun-btn" onClick={runChecks}>↻ Run again</button></div>
        </aside>
      </div>
    </main>

    {confirm && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="modal-close" onClick={() => setConfirm(null)} aria-label="Close">×</button><div className={`modal-icon ${confirm === 'deploy' ? 'deploy-modal' : ''}`}>{confirm === 'deploy' ? '▲' : '⌁'}</div><h2 id="confirm-title">{confirm === 'deploy' ? 'Deploy to staging?' : 'Commit these changes?'}</h2><p>{confirm === 'deploy' ? 'This will build the current commit and publish a new staging preview.' : 'Create a commit from the 3 reviewed files.'}</p><div className="modal-summary"><span>⑂</span><b>{confirm === 'deploy' ? 'main · 4f28a1c' : 'feat: refine launchpad hero experience'}</b><small>{confirm === 'deploy' ? 'Vercel · staging' : '3 files · 69 additions'}</small></div><div className="modal-actions"><button className="secondary-btn" onClick={() => setConfirm(null)}>Cancel</button><button className="primary-btn" onClick={confirmAction}>{confirm === 'deploy' ? 'Deploy now' : 'Commit changes'}</button></div></div></div>}
    <GitHubPublish open={modal === 'github'} onClose={closeModal} commitMessage={commitMessage} files={files} branch={active.branch.split(' · ')[0]} onPublished={(repository) => { setChangesCommitted(true); setPushComplete(true); appendEvent({ icon: '↑', color: 'blue', category: 'Git', title: 'Changes pushed to GitHub', body: commitMessage.trim(), time: 'Just now', meta: repository }); queueToast('Пуш выполнен') }} onMainPublished={(repository, commit) => { appendEvent({ icon: '↑', color: 'blue', category: 'Git', title: 'Main updated on GitHub', body: `Published version replaces main files · ${commit.slice(0, 8)}`, time: 'Just now', meta: repository }); queueToast('Новая версия опубликована в main') }} />
    {modal === 'workspace' && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><button className="modal-close" onClick={closeModal} aria-label="Close">×</button><div className="modal-icon">＋</div><h2 id="workspace-title">Add workspace</h2><p>Connect another local Git repository to this app.</p><input className="modal-input" autoFocus value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" onKeyDown={(event) => event.key === 'Enter' && addWorkspace()}/><div className="modal-actions"><button className="secondary-btn" onClick={closeModal}>Cancel</button><button className="primary-btn" onClick={addWorkspace} disabled={!workspaceName.trim()}>Connect</button></div></div></div>}
    {modal === 'search' && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="search-title"><button className="modal-close" onClick={closeModal} aria-label="Close">×</button><div className="modal-icon">⌕</div><h2 id="search-title">Search changes</h2><p>Filter the current file list by name.</p><input className="modal-input" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Hero.tsx"/><div className="search-results">{query ? `${filteredFiles.length} matching file${filteredFiles.length === 1 ? '' : 's'}` : 'Start typing to search files'}</div></div></div>}
    {modal === 'settings' && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="modal-close" onClick={closeModal} aria-label="Close">×</button><div className="modal-icon">⚙</div><h2 id="settings-title">Workspace settings</h2><p>Local agent and confirmation preferences.</p><label className="setting-row"><span>Always confirm risky actions</span><input type="checkbox" defaultChecked/></label><label className="setting-row"><span>Show operation timeline</span><input type="checkbox" defaultChecked/></label><div className="modal-actions"><button className="primary-btn" onClick={() => { closeModal(); queueToast('Settings saved') }}>Save settings</button></div></div></div>}
    {modal === 'environment' && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-labelledby="environment-title"><button className="modal-close" onClick={closeModal} aria-label="Close">×</button><div className="modal-icon deploy-modal">▲</div><h2 id="environment-title">staging</h2><p>Vercel preview environment connected to the main branch.</p><div className="modal-summary"><span>●</span><b>Ready</b><small>launchpad-preview.vercel.app</small></div><div className="modal-actions"><button className="secondary-btn" onClick={() => { closeModal(); window.open('https://launchpad-preview.vercel.app', '_blank') }}>Open preview</button><button className="primary-btn" onClick={() => { closeModal(); setConfirm('deploy') }}>New deploy</button></div></div></div>}
    {modal === 'notifications' && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-labelledby="notifications-title"><button className="modal-close" onClick={closeModal} aria-label="Close">×</button><div className="modal-icon">♧</div><h2 id="notifications-title">Notifications</h2><p>No unread notifications. Deployment and agent updates will appear here.</p><div className="modal-actions"><button className="primary-btn" onClick={closeModal}>Done</button></div></div></div>}
    {modal === 'account' && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-labelledby="account-title"><button className="modal-close" onClick={closeModal} aria-label="Close">×</button><div className="modal-icon">SN</div><h2 id="account-title">Sergey</h2><p>Personal plan · local agent connected.</p><div className="modal-actions"><button className="primary-btn" onClick={closeModal}>Done</button></div></div></div>}
    {modal === 'more' && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-labelledby="more-title"><button className="modal-close" onClick={closeModal} aria-label="Close">×</button><div className="modal-icon">•••</div><h2 id="more-title">Workspace actions</h2><p>Refresh the local state or manage the current branch.</p><div className="modal-actions"><button className="secondary-btn" onClick={() => { closeModal(); queueToast('Workspace refreshed') }}>Refresh</button><button className="primary-btn" onClick={() => { closeModal(); queueToast('Branch manager opened') }}>Branch manager</button></div></div></div>}
    {fullscreenDiff && <div className="modal-backdrop diff-fullscreen" role="presentation"><div className="confirm-modal" role="dialog" aria-labelledby="fullscreen-title"><button className="modal-close" onClick={() => setFullscreenDiff(false)} aria-label="Close">×</button><div className="diff-header"><span id="fullscreen-title">Diff preview</span><span className="diff-path">{activeFile}</span></div><div className="diff-view" style={{ fontSize: diffSize * 1.2 }}><div className="code-line removed"><span>2</span><code>-   return &lt;section className="hero"&gt;</code></div><div className="code-line added"><span>2</span><code>+   return &lt;section className="hero" aria-labelledby="hero-title"&gt;</code></div><div className="code-line added"><span>3</span><code>+     &lt;Badge&gt;Ship faster&lt;/Badge&gt;</code></div></div></div></div>}
    {toast && <div className="toast" role="status">✓ {toast}</div>}
  </div>
}
