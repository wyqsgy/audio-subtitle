import { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import http from 'http'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backendProcess: ChildProcess | null = null
let isQuitting = false
let backendRestartAttempts = 0
let backendRestartTimer: ReturnType<typeof setTimeout> | null = null

const BACKEND_PORT = 8765
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`
const WS_URL = `ws://127.0.0.1:${BACKEND_PORT}/ws`
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const POSITION_FILE = path.join(app.getPath('userData'), 'window-position.json')

function getBackendExePath(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'build-resources', 'audiosubtitle-backend.exe')
  }

  const candidates = [
    path.join(process.resourcesPath, 'backend', 'audiosubtitle-backend.exe'),
    path.join(path.dirname(app.getPath('exe')), 'resources', 'backend', 'audiosubtitle-backend.exe'),
    path.join(process.resourcesPath, 'audiosubtitle-backend.exe'),
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  return candidates[0]
}

function healthCheck(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => { req.destroy(); resolve(false) })
  })
}

async function waitForBackend(maxRetries = 30, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await healthCheck()) return true
    if (backendProcess?.exitCode !== null) {
      console.error('[Main] Backend died during startup')
      return false
    }
    await new Promise(r => setTimeout(r, delayMs))
  }
  return false
}

function startBackend(): Promise<boolean> {
  return new Promise((resolve) => {
    const isDev = !app.isPackaged

    if (isDev) {
      const backendDir = path.join(app.getAppPath(), 'backend')
      console.log('[Main] Dev mode — launching Python backend')

      backendProcess = spawn('python', [
        '-m', 'uvicorn', 'main:app',
        '--host', '127.0.0.1',
        '--port', String(BACKEND_PORT),
        '--log-level', 'warning'
      ], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } else {
      const exePath = getBackendExePath()
      console.log('[Main] Production mode — launching:', exePath)

      if (!fs.existsSync(exePath)) {
        console.error('[Main] Backend exe not found:', exePath)
        resolve(false)
        return
      }

      backendProcess = spawn(exePath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    }

    backendProcess.stdout?.on('data', (d: Buffer) => {
      const t = d.toString().trim()
      if (t) console.log('[Backend]', t)
    })

    backendProcess.stderr?.on('data', (d: Buffer) => {
      const t = d.toString().trim()
      if (t) console.error('[Backend]', t)
    })

    backendProcess.on('error', (err) => {
      console.error('[Main] Backend spawn error:', err.message)
      backendProcess = null
      resolve(false)
    })

    backendProcess.on('exit', (code) => {
      console.log('[Main] Backend exited:', code)
      backendProcess = null
      if (!isQuitting) {
        scheduleBackendRestart()
      }
    })

    waitForBackend().then(resolve)
  })
}

function stopBackend() {
  if (backendRestartTimer) {
    clearTimeout(backendRestartTimer)
    backendRestartTimer = null
  }
  if (!backendProcess) return

  if (backendProcess.pid) {
    try {
      execSync(`taskkill /pid ${backendProcess.pid} /f /t 2>nul`, { windowsHide: true })
    } catch { /* already dead */ }
  }

  backendProcess = null
}

function loadWindowPosition(): { x?: number; y?: number } | null {
  try {
    if (fs.existsSync(POSITION_FILE)) {
      return JSON.parse(fs.readFileSync(POSITION_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return null
}

function saveWindowPosition(x: number, y: number) {
  try {
    fs.writeFileSync(POSITION_FILE, JSON.stringify({ x, y }), 'utf-8')
  } catch { /* ignore */ }
}

function scheduleBackendRestart() {
  if (isQuitting) return
  if (backendRestartAttempts >= 5) {
    console.error('[Main] Backend restart limit reached')
    return
  }

  const delay = Math.min(2000 * Math.pow(2, backendRestartAttempts), 30000)
  backendRestartAttempts++
  console.log(`[Main] Scheduling backend restart in ${delay}ms (attempt ${backendRestartAttempts}/5)`)

  backendRestartTimer = setTimeout(async () => {
    backendRestartTimer = null
    console.log('[Main] Restarting backend...')
    const ok = await startBackend()
    if (ok) {
      backendRestartAttempts = 0
      console.log('[Main] Backend restarted successfully')
    } else {
      scheduleBackendRestart()
    }
  }, delay)
}

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const winW = 800
  const winH = 120

  const saved = loadWindowPosition()
  const defaultX = Math.round((screenW - winW) / 2)
  const defaultY = screenH - winH - 60

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: saved?.x ?? defaultX,
    y: saved?.y ?? defaultY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function createSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 620,
    frame: false,
    transparent: false,
    backgroundColor: '#1a1a2e',
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(`${VITE_DEV_SERVER_URL}#/settings`)
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/settings' })
  }

  settingsWindow.on('closed', () => { settingsWindow = null })
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAASdEVYdFNvZnR3YXJlAEdyZWVuc2hvdF5VCAUAAADOSURBVDhPY2RgYGD4z0ABYKBgPAONgP+sDFDA9B8mSg0DcBkApQVINwAXC6QECA2ABYEYFwuIAawMpBsADgAoQ2AWkM4AoBQEBgY4A1ByHqEBKBCAAQYGnC5gxCNRlARIEqE8YCYqwOsFPAYA/QBMJAwEGENUqiYrFjCMAA8jAFRDBFAiJA2G3AAAAd0BUBMIjUVUIacwII8BwIABpXNYByFAMDH3AM4LFIb8G5AAg1iLsAFcLqA4ADC8IGEvKAwCds3dg32p2UgR8XAYMGAeAAD0vMqWGvDWFAAAAABJRU5ErkJggg=='
  )
  icon.resize({ width: 16, height: 16 })
  tray = new Tray(icon)

  const updateMenu = () => {
    const visible = mainWindow?.isVisible() ?? false
    const menu = Menu.buildFromTemplate([
      {
        label: visible ? '隐藏字幕窗口' : '显示字幕窗口',
        click: () => visible ? mainWindow?.hide() : (mainWindow?.show(), mainWindow?.focus())
      },
      { label: '设置', click: createSettingsWindow },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; stopBackend(); app.quit() } }
    ])
    tray?.setContextMenu(menu)
  }

  updateMenu()
  tray.setToolTip('Audio Subtitle - 音频字幕')
  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : (mainWindow?.show(), mainWindow?.focus())
    updateMenu()
  })
  setInterval(updateMenu, 2000)
}

app.whenReady().then(async () => {
  console.log('[Main] Starting backend...')
  const backendReady = await startBackend()

  if (backendReady) {
    console.log('[Main] Backend ready')
  } else {
    console.error('[Main] Backend failed to start — showing app anyway')
  }

  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  stopBackend()
})

app.on('window-all-closed', () => {
  stopBackend()
})

ipcMain.handle('open-settings', () => createSettingsWindow())
ipcMain.handle('get-backend-url', () => BACKEND_URL)
ipcMain.handle('get-ws-url', () => WS_URL)
ipcMain.handle('minimize-window', () => mainWindow?.minimize())
ipcMain.handle('hide-window', () => mainWindow?.hide())
ipcMain.handle('show-window', () => {
  mainWindow?.show()
  mainWindow?.focus()
})

ipcMain.handle('resize-window', (_event, width: number, height: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition()
    const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
    mainWindow.setBounds({ x, y: Math.min(y, screenH - height - 30), width, height }, true)
    saveWindowPosition(x, Math.min(y, screenH - height - 30))
  }
  return { success: true }
})

ipcMain.handle('save-window-position', (_event, x: number, y: number) => {
  saveWindowPosition(x, y)
})

ipcMain.handle('get-window-position', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition()
    return { x, y }
  }
  return loadWindowPosition()
})

ipcMain.handle('quit-app', () => {
  isQuitting = true
  stopBackend()
  app.quit()
})