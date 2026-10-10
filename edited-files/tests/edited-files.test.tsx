import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }]

const mount = ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'edited-files', surface, component: 'Pane', requestId: 'edited-files',
    props: { title: 'Edited files', isFocused: false, bodyColumns: 60, bodyRows: 20, placement: 'dock', scroll: { top: 0 } } as never,
  })

test('Edit and Write: tree, totals, new marker, Enter shows the diff', async ($, on) => {
  on('session.cwd', () => ({ value: '/proj' }))
  on('tool.call', { tool: 'Edit' }, (_$, e) => ({
    result: {
      filePath: e.file_path, oldString: e.old_string, newString: e.new_string,
      originalFile: null, structuredPatch: patch, userModified: false, replaceAll: false,
    },
  }))
  on('tool.call', { tool: 'Write' }, (_$, e) => ({
    result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null },
  }))
  for (const id of ['t1', 't2'])
    await $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: '/x/a.ts', old_string: 'b', new_string: 'c\nd' })
  await $.tool.call({ tool: 'Write', tool_use_id: 't3', file_path: '/proj/new.ts', content: 'one\ntwo' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    for (const text of ['/x/', '└─ ', 'a.ts', ' +4', ' -2', 'new.ts', ' new', '2 files', ' +6'])
      expect(await ui.find({ type: 'Text', text })).toBeDefined()

    await ui.press({ key: '/x/a.ts' })
    // find matches text it includes
    for (const text of ['/x/a.ts', '@@ -1,2 +1,3 @@', '+c', '-b'])
      expect(await ui.find({ type: 'Text', text })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: '2 files' })).toBeDefined()

    // minimize keeps the summary row and drops the tree; expand brings it back
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: '2 files' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'a.ts' })).toBeUndefined()
    expect(await ui.find({ key: 'toggle', text: 'expand' })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: 'a.ts' })).toBeDefined()
    await ui.unmount()
  }
})

test('Bash: files from git tree snapshots, status, diff without headers', async ($, on) => {
  on('session.cwd', () => ({ value: '/elsewhere' }))
  const trees = ['t-before', 't-after']
  const out: Record<string, string> = {
    '--numstat': '31\t0\tREADME.md\x002\t1\tsrc/a b.ts\x00-\t-\timg.png\x00',
    '--name-status': 'A\x00README.md\x00M\x00src/a b.ts\x00D\x00img.png\x00',
    diff: 'diff --git a/README.md b/README.md\nnew file mode 100644\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+hello\n',
  }
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_$, e) =>
    ok(e.argv[0] === 'sh' ? `${trees.shift()}\n/repo\n` : e.argv[1] === 'diff' ? out.diff! : out[e.argv[4]!]!))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'make', description: 'x' })

  const ui = await mount($, 'terminal')
  // /repo/ flush left, src/ before the files, then files by name
  for (const [prefix, text] of [['├─ ', 'src/'], ['│  └─ ', 'a b.ts'], ['├─ ', 'img.png'], ['└─ ', 'README.md']]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: prefix })).toBeDefined()
  }
  for (const text of ['/repo/', ' deleted', ' new', ' +33', '3 files'])
    expect(await ui.find({ type: 'Text', text })).toBeDefined()

  await ui.press({ key: '/repo/README.md' })
  expect(await ui.find({ type: 'Text', text: '+hello' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+++ b/README.md' })).toBeUndefined()
  await ui.unmount()
})
