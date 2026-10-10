import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileStat } from '../types'

const PANE = 'edited-files'
const files = atom({ plugin: 'edited-files', key: 'files' } as const, [])

type Patch = { lines: string[] }[]

const count = (patch: Patch, ch: string) =>
  patch.reduce((n, hunk) => n + hunk.lines.filter(l => l[0] === ch).length, 0)

const record = ($: EngineInterface, stat: FileStat) =>
  update($, files, list => {
    const old = list.find(f => f.path === stat.path)
    const rest = list.filter(f => f.path !== stat.path)
    return [...rest, { path: stat.path, adds: (old?.adds ?? 0) + stat.adds, dels: (old?.dels ?? 0) + stat.dels }]
  })

// Bash has no patch to read, so snapshot the work tree as a git tree before and
// after the command and diff the two. A private index in .git keeps the real
// one untouched and caches file stats, so only changed files get rehashed.
// ponytail: git repos only; edits made by anything else during the command count too
const SNAPSHOT = `top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
cd "$top" || exit 1
GIT_INDEX_FILE="$(git rev-parse --absolute-git-dir)/edited-files.index" git add -A || exit 1
GIT_INDEX_FILE="$(git rev-parse --absolute-git-dir)/edited-files.index" git write-tree && echo "$top"`

type Snapshot = { tree: string; top: string }

const snapshot = async ($: EngineInterface): Promise<Snapshot | undefined> => {
  try {
    const r = await $.process.run(['sh', '-c', SNAPSHOT])
    const [tree, top] = r.stdout.trim().split('\n')
    return r.exitCode === 0 && tree && top ? { tree, top } : undefined
  } catch {
    return undefined
  }
}

// `git diff-tree -z --numstat`: "adds\tdels\tpath\0" per file, "-" for binary
const parseNumstat = (top: string, out: string): FileStat[] =>
  out.split('\0').filter(Boolean).map(line => {
    const [adds, dels, ...path] = line.split('\t')
    return { path: `${top}/${path.join('\t')}`, adds: Number(adds) || 0, dels: Number(dels) || 0 }
  })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'edited-files', description: 'Show files edited this session' })
    void $.ui.open({ id: PANE, title: 'Edited files' })
    return next(e)
  })

  // an open the mod makes on its own waits below 144 columns; one answering a
  // prompt is placed at any width, inline above the prompt when narrow
  on('prompt.submit', async ($, e, next) => {
    await $.ui.open({ id: PANE, title: 'Edited files' })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'edited-files' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Edited files' })
    return { text: 'Edited files pane opened.' }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const r = ran.result
      await record($, { path: r.filePath, adds: count(r.structuredPatch, '+'), dels: count(r.structuredPatch, '-') })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const r = ran.result
      // a new file may come back with an empty patch: count its content instead
      const adds = r.structuredPatch.length ? count(r.structuredPatch, '+') : r.content.split('\n').length
      await record($, { path: r.filePath, adds, dels: count(r.structuredPatch, '-') })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before = await snapshot($)
    const ran = await next(e)
    if (!before || ran.deny !== undefined) return ran
    try {
      const after = await snapshot($)
      if (after && after.top === before.top && after.tree !== before.tree) {
        const r = await $.process.run(['git', 'diff-tree', '-r', '-z', '--numstat', before.tree, after.tree], { cwd: before.top })
        for (const stat of parseNumstat(before.top, r.stdout)) await record($, stat)
      }
    } catch {}
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, files)
    const width = Math.max(10, e.props.bodyColumns - 12)
    const short = (p: string) => (p.length > width ? '…' + p.slice(-(width - 1)) : p)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No edits yet.</Text>}
        {list.map(f => (
          <Box key={f.path} flexDirection="row">
            <Text color="green">+{f.adds} </Text>
            <Text color="red">-{f.dels} </Text>
            <Text>{short(f.path)}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
