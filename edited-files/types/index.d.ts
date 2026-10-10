export type FileStat = { path: string; adds: number; dels: number }

declare module 'claude-code' {
  interface PluginState {
    'edited-files': { files: FileStat[] }
  }
}
