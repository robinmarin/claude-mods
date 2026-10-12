// one edit's diff: Edit/Write hunks as given, or two git trees a Bash call
// left, diffed when the file is opened
export type Change =
  | { kind: 'patch'; lines: string[] }
  | { kind: 'git'; top: string; before: string; after: string; rel: string }

export type FileStatus = 'new' | 'modified' | 'deleted'

export type FileStat = { path: string; adds: number; dels: number; status: FileStatus; changes: Change[] }

export type OpenDiff = { path: string; lines: string[] }

declare module 'claude-code' {
  interface PluginState {
    'edited-files': { files: FileStat[]; open: OpenDiff | null; minimized: boolean; flipped: boolean }
  }
}
