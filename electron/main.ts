import { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backendProcess: ChildProcess | null = null
let isQuitting = false

const BACKEND_URL = 'http://127.0.0.1:8765'
const WS_URL = 'ws://127.0.0.1:8765/ws'
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

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

function startBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const isDev = !app.isPackaged

    if (isDev) {
      const backendDir = path.join(app.getAppPath(), 'backend')
      console.log('[Main] Dev mode — launching Python backend from:', backendDir)

      backendProcess = spawn('python', [
        '-m', 'uvicorn', 'main:app',
        '--host', '127.0.0.1', '--port', '8765',
        '--log-level', 'warning'
      ], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } else {
      const exePath = getBackendExePath()
      console.log('[Main] Production mode — launching:', exePath)

      if (!fs.existsSync(exePath)) {
        console.error('[Main] Backend executable not found:', exePath)
        reject(new Error(`Backend not found: ${exePath}`))
        return
      }

      backendProcess = spawn(exePath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    }

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) console.log('[Backend]', text)
    })

    backendProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) console.error('[Backend]', text)
    })

    backendProcess.on('error', (err) => {
      console.error('[Main] Backend error:', err.message)
      reject(err)
    })

    backendProcess.on('exit', (code) => {
      console.log('[Main] Backend exited:', code)
      backendProcess = null
    })

    setTimeout(() => resolve(), 2000)
  })
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
}

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const winW = 800
  const winH = 120

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round((screenW - winW) / 2),
    y: screenH - winH - 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
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
    const isVisible = mainWindow?.isVisible() ?? false
    const menu = Menu.buildFromTemplate([
      {
        label: isVisible ? '隐藏字幕窗口' : '显示字幕窗口',
        click: () => isVisible ? mainWindow?.hide() : (mainWindow?.show(), mainWindow?.focus())
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
  try { await startBackend() } catch (e) { console.error('[Main] Backend start failed:', e) }

  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { isQuitting = true; stopBackend() })
app.on('window-all-closed', () => { stopBackend() })

ipcMain.handle('open-settings', () => createSettingsWindow())
ipcMain.handle('get-backend-url', () => BACKEND_URL)
ipcMain.handle('get-ws-url', () => WS_URL)
ipcMain.handle('minimize-window', () => mainWindow?.minimize())
ipcMain.handle('hide-window', () => mainWindow?.hide())

ipcMain.handle('resize-window', (_event, width: number, height: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition()
    const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
    mainWindow.setBounds({ x, y: Math.min(y, screenH - height - 30), width, height }, true)
  }
  return { success: true }
})

ipcMain.handle('quit-app', () => { isQuitting = true; stopBackend(); app.quit() })