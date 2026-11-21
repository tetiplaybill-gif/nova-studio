const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { mkdtemp, readFile, readdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { evaluateCdpExpression } = require('../e2e/regression/cdpClient.ts')

async function until(label, probe, timeout = 60_000) {
  const deadline = Date.now() + timeout
  do {
    const result = await probe()
    if (result) return result
    await delay(200)
  } while (Date.now() < deadline)
  throw new Error('Timed out waiting for ' + label)
}

async function withMainWindow(executable, profile, verify) {
  const child = spawn(
    executable,
    [
      '--user-data-dir=' + profile,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
      ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
      '--no-first-run'
    ],
    { stdio: 'ignore' }
  )
  let failure
  child.once('error', (e) => {
    failure = e
  })
  try {
    const target = await until(
      'the packaged main window',
      async () => {
        if (failure) throw failure
        if (child.exitCode !== null || child.signalCode)
          throw new Error('The packaged application exited during startup')
        try {
          const [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
          if (!/^\d+$/.test(port)) return
          const origin = '127.0.0.1:' + port
          const response = await fetch('http://' + origin + '/json/list', { signal: AbortSignal.timeout(2000) })
          const pages = await response.json()
          const page = pages.find((p) => p.type === 'page' && /\/windows\/main\/index\.html(?:[?#]|$)/.test(p.url))
          if (page && new URL(page.webSocketDebuggerUrl).origin === 'ws://' + origin) return page.webSocketDebuggerUrl
        } catch (e) {
          if (e.code !== 'ENOENT' && !(e instanceof TypeError) && e.name !== 'TimeoutError') throw e
        }
      },
      120_000
    )
    const run = (fn, arg) => evaluateCdpExpression(target, '(' + fn.toString() + ')(' + JSON.stringify(arg) + ')')
    await until(
      'onboarding or the main shell',
      () =>
        run(() => {
          const button = [...document.querySelectorAll('button')].find(
            (b) => b.offsetWidth && /稍后设置|set up later/i.test(b.innerText)
          )
          if (button) button.click()
          return Boolean(document.querySelector('[data-ui="app.shell"]')) && !button
        }),
      120_000
    )
    await verify(run)
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      try {
        await exited
      } finally {
        clearTimeout(timer)
      }
    }
  }
}

async function openNotes(run) {
  const target = '/app/notes'
  await until('the notes navigation handler', () =>
    run(
      (route) =>
        !window.dispatchEvent(
          new CustomEvent('cherry:open-main-route', {
            cancelable: true,
            detail: { path: route }
          })
        ),
      target
    )
  )
  await until('the notes editor', () => run(() => Boolean(document.querySelector('[data-ui="notes.editor"]'))))
}

async function verifyNoteRenderer(executable) {
  if (!executable || !path.isAbsolute(executable))
    throw new Error('An absolute NOVA Studio executable path is required')
  const profile = await mkdtemp(path.join(tmpdir(), 'nova-studio-note-'))
  const marker = 'NOVA desktop note ' + randomUUID()
  const notesDir = path.join(profile, 'Data', 'Notes')
  let filename
  await withMainWindow(executable, profile, async (run) => {
    await openNotes(run)
    await until('the new note action', () =>
      run(() => {
        const button = [...document.querySelectorAll('[data-ui="notes.editor"] button')].find((b) =>
          /create a new note|新建笔记/i.test(b.innerText)
        )
        if (!button || button.disabled) return false
        button.click()
        return true
      })
    )
    await until('an editable note', () =>
      run(() => Boolean(document.querySelector('[data-ui="notes.editor"] .tiptap[contenteditable=true]')))
    )
    const edited = await run((text) => {
      const editor = document.querySelector('[data-ui="notes.editor"] .tiptap')
      editor.focus()
      return document.execCommand('insertText', false, text) && editor.textContent.includes(text)
    }, marker)
    if (!edited) throw new Error('Editing through the packaged contenteditable failed')
    filename = await until('the saved Markdown on disk', async () => {
      for (const name of await readdir(notesDir)) {
        if (!name.endsWith('.md')) continue
        const file = path.join(notesDir, name)
        if ((await readFile(file, 'utf8')).trim() === marker) return file
      }
    })
    console.log('Created and edited the note; its Markdown was saved to disk')
  })
  await withMainWindow(executable, profile, async (run) => {
    await openNotes(run)
    const basename = path.basename(filename)
    try {
      await until('the saved note in the file list', () =>
        run((name) => {
          const row = [
            ...document.querySelectorAll('[data-ui="notes.navigation"] [role=treeitem][data-kind=file]')
          ].find(
            (el) => el.title === name || el.title + '.md' === name || el.dataset.nodeId?.split(/[\\/]/).pop() === name
          )
          if (!row) return false
          row.click()
          return true
        }, basename)
      )
      await until('the saved text after restarting Studio', () =>
        run((text) => document.querySelector('[data-ui="notes.editor"] .tiptap')?.textContent.trim() === text, marker)
      )
    } catch (error) {
      const state = await run(() => ({
        noteTitles: [...document.querySelectorAll('[data-ui="notes.navigation"] [role=treeitem]')].map(
          (el) => el.title
        ),
        editor: document.querySelector('[data-ui="notes.editor"]')?.innerText.slice(0, 180),
        hasActiveNote: Boolean(document.querySelector('[data-ui="notes.editor"][data-note-id]'))
      }))
      throw new Error(error.message + ' ' + JSON.stringify(state))
    }
    console.log('Reopened the same saved note after restarting the packaged application')
    const result = await run(() => {
      const element = document.querySelector('[data-ui="notes.editor"] .tiptap')
      const editor = element.editor
      const samples = []
      let count
      for (let i = 0; i < 4; i++) {
        editor.commands.setContent('start', { contentType: 'markdown', emitUpdate: false })
        const start = performance.now()
        editor.commands.setContent('---\n'.repeat(8448), { contentType: 'markdown', emitUpdate: false })
        count = element.querySelectorAll('hr').length
        if (count <= 8000) throw new Error('NOVA Studio rendered an incomplete note')
        if (i > 0) samples.push(performance.now() - start)
      }
      return { horizontalRules: count, medianMs: samples.sort((a, b) => a - b)[1] }
    })
    console.log(JSON.stringify(result))
    if (result.medianMs >= 3000) throw new Error('NOVA Studio exceeded the 3000 ms native rendering budget')
  })
}

verifyNoteRenderer(process.argv[2]).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
