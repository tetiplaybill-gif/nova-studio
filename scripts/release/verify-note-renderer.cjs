const { spawn } = require('node:child_process')
const { mkdtemp, readFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('@playwright/test')

async function verifyNoteRenderer(executable) {
  if (!executable || !path.isAbsolute(executable))
    throw new Error('An absolute NOVA Studio executable path is required')
  const profile = await mkdtemp(path.join(tmpdir(), 'nova-note-release-test-'))
  const app = spawn(
    executable,
    [
      '--user-data-dir=' + profile,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
      '--no-first-run'
    ],
    { stdio: 'ignore' }
  )
  let startupError
  app.on('error', (error) => {
    startupError = error
  })
  let browser
  try {
    const deadline = Date.now() + 45_000
    let port
    while (!port && Date.now() < deadline) {
      if (startupError) throw startupError
      if (app.exitCode !== null) throw new Error('NOVA Studio exited before its window opened')
      try {
        port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim()
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (!port) await delay(200)
    }
    if (!/^\d+$/.test(port || '')) throw new Error('NOVA Studio did not expose its test renderer')
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
    let main
    while (!main && Date.now() < deadline) {
      main = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((page) => /\/windows\/main\/index\.html/.test(page.url()))
      if (!main) await delay(200)
    }
    if (!main) throw new Error('NOVA Studio main window did not open')
    const skip = main.getByRole('button', { name: /稍后设置|set up later/i })
    await skip.waitFor({ timeout: 12_000 }).catch((error) => {
      if (error.name !== 'TimeoutError') throw error
    })
    if (await skip.isVisible()) await skip.click()
    await main.waitForFunction(
      () =>
        !window.dispatchEvent(
          new CustomEvent('cherry:open-main-route', {
            cancelable: true,
            detail: { path: '/app/notes' }
          })
        ),
      undefined,
      { timeout: 20_000, polling: 300 }
    )
    const notes = main.locator('[data-ui="notes.editor"]')
    await notes.waitFor()
    await notes.getByRole('button', { name: /create a new note|新建笔记/i }).click()
    const view = notes.locator('.tiptap').first()
    await view.waitFor()
    const result = await view.evaluate((element) => {
      const editor = element.editor
      const source = '---\n'.repeat(8448)
      const samples = []
      let count
      for (let i = 0; i < 4; i++) {
        editor.commands.setContent('start', { contentType: 'markdown', emitUpdate: false })
        const start = performance.now()
        editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false })
        count = element.querySelectorAll('hr').length
        if (count <= 8000) throw new Error('NOVA Studio rendered an incomplete note')
        if (i > 0) samples.push(performance.now() - start)
      }
      return { horizontalRules: count, medianMs: samples.sort((a, b) => a - b)[1] }
    })
    console.log(JSON.stringify(result))
    if (result.medianMs >= 3000) throw new Error('NOVA Studio exceeded the 3000 ms native rendering budget')
  } finally {
    if (browser) await browser.close()
    if (app.exitCode === null && app.signalCode === null) app.kill()
  }
}

verifyNoteRenderer(process.argv[2]).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
