export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ProjectConfig {
  id: string;
  name: string;
  localPath: string;
  defaultBranch: string;
  gitRemote?: string;
  stagingProvider?: string;
  stagingEnvironment?: string;
  checkCommands: string[];
  allowedTools: string[];
  confirmationPolicy: 'always' | 'risky' | 'never';
}

export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk: RiskLevel;
  requiresConfirmation: boolean;
  platforms: Array<'macos' | 'windows' | 'linux'>;
}

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface OperationEvent {
  operationId: string;
  projectId: string;
  type: string;
  status: OperationStatus;
  input?: Record<string, unknown>;
  result?: unknown;
  stdout?: string;
  stderr?: string;
  timestamp: string;
  commit?: string;
}

export interface DeploymentInput {
  projectId: string;
  branch: string;
  commit?: string;
  environment: string;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface GitStatusResult {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  clean: boolean;
  changedFiles: ChangedFile[];
}

export interface GitDiffResult {
  files: ChangedFile[];
  patch: string;
}

export interface CheckResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  summary?: string;
}

export interface ChecksRunResult {
  status: 'passed' | 'failed';
  checks: CheckResult[];
}

export interface CommitResult {
  commit: string;
  message: string;
  changedFiles: number;
}

export interface PushResult {
  remote: string;
  branch: string;
  commit: string;
}

export interface DeploymentPreview {
  branch: string;
  commit?: string;
  environment: string;
  changedFiles: string[];
  url?: string;
}

export interface DeploymentStatus {
  deploymentId: string;
  status: 'queued' | 'building' | 'ready' | 'failed' | 'cancelled';
  url?: string;
  message?: string;
}

export interface DeploymentStartResult {
  deploymentId: string;
}

export interface DeploymentAdapter {
  validate(config: ProjectConfig): Promise<void>;
  preview(input: DeploymentInput): Promise<DeploymentPreview>;
  start(input: DeploymentInput): Promise<{ deploymentId: string }>;
  getStatus(deploymentId: string): Promise<DeploymentStatus>;
  getLogs(deploymentId: string): AsyncIterable<string>;
  cancel(deploymentId: string): Promise<void>;
  rollback(deploymentId: string): Promise<void>;
}
