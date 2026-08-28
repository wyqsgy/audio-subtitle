import { useState, useEffect, useRef, useCallback } from 'react'
import SubtitleWindow from './components/SubtitleWindow'
import SettingsPanel from './components/SettingsPanel'

declare global {
  interface Window {
    electronAPI: {
      openSettings: () => Promise<void>
      getBackendUrl: () => Promise<string>
      getWsUrl: () => Promise<string>
      minimizeWindow: () => Promise<void>
      hideWindow: () => Promise<void>
      showWindow: () => Promise<void>
      resizeWindow: (width: number, height: number) => Promise<{ success: boolean }>
      saveWindowPosition: (x: number, y: number) => Promise<void>
      getWindowPosition: () => Promise<{ x: number; y: number } | null>
      quitApp: () => Promise<void>
    }
  }
}

export interface AppSettings {
  audioSource: 'microphone' | 'system'
  displayMode: 'original' | 'translation' | 'both'
  recognitionMode: 'local' | 'api'
  sourceLanguage: string
  targetLanguage: string
  fontSize: number
  backgroundColor: string
  textColor: string
  opacity: number
  apiKey: string
  apiBaseUrl: string
  localModel: string
  enhanceSubtitles: boolean
}

const defaultSettings: AppSettings = {
  audioSource: 'system',
  displayMode: 'original',
  recognitionMode: 'local',
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  fontSize: 22,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  textColor: '#ffffff',
  opacity: 0.95,
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1',
  localModel: 'base',
  enhanceSubtitles: true
}

function App() {
  const [route, setRoute] = useState(() =>
    window.location.hash === '#/settings' ? 'settings' : 'main'
  )
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const raw = localStorage.getItem('audio-subtitle-settings')
      return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
    } catch {
      return defaultSettings
    }
  })
  const [subtitle, setSubtitle] = useState({ text: '', translation: '' })
  const [isCapturing, setIsCapturing] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [audioDevices, setAudioDevices] = useState<Array<{ id: string; name: string; type: string }>>([])
  const [modelStatus, setModelStatus] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const backendUrlRef = useRef('http://127.0.0.1:8765')
  const wsUrlRef = useRef('ws://127.0.0.1:8765/ws')
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const reconnectAttempts = useRef(0)
  const mountedRef = useRef(true)
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  })

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash === '#/settings' ? 'settings' : 'main')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    localStorage.setItem('audio-subtitle-settings', JSON.stringify(settings))
  }, [settings])

  const sendSettings = useCallback((ws: WebSocket, s?: AppSettings) => {
    if (ws.readyState !== WebSocket.OPEN) return
    const current = s || settingsRef.current
    ws.send(JSON.stringify({
      type: 'settings',
      data: {
        api_key: current.apiKey,
        api_base_url: current.apiBaseUrl,
        source_language: current.sourceLanguage,
        target_language: current.targetLanguage,
        recognition_mode: current.recognitionMode,
        local_model: current.localModel,
        enhance_subtitles: current.enhanceSubtitles
      }
    }))
  }, [])

  const createWS = useCallback(() => {
    if (!mountedRef.current) return null

    if (wsRef.current) {
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }

    const ws = new WebSocket(wsUrlRef.current)

    ws.onopen = () => {
      reconnectAttempts.current = 0
      setIsConnected(true)
      setModelStatus('')
      sendSettings(ws)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'subtitle') {
          setSubtitle({
            text: msg.data.original || '',
            translation: msg.data.translation || ''
          })
        } else if (msg.type === 'audio_level') {
          setAudioLevel(msg.data?.level ?? 0)
        } else if (msg.type === 'model_status') {
          setModelStatus(msg.data?.status || '')
        }
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      setIsConnected(false)
      setIsCapturing(false)
      wsRef.current = null

      if (!mountedRef.current) return

      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000)
      reconnectAttempts.current++
      reconnectTimer.current = setTimeout(createWS, delay)
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws
    return ws
  }, [sendSettings])

  useEffect(() => {
    mountedRef.current = true

    if (window.electronAPI) {
      window.electronAPI.getBackendUrl().then(u => { backendUrlRef.current = u })
      window.electronAPI.getWsUrl().then(u => { wsUrlRef.current = u })
    }

    createWS()

    return () => {
      mountedRef.current = false
      clearTimeout(reconnectTimer.current)
      try { wsRef.current?.close() } catch { /* ignore */ }
    }
  }, [createWS])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== document.body && (e.target as HTMLElement).tagName !== 'BODY') return

      if (e.code === 'Space') {
        e.preventDefault()
        handleToggleCapture()
      } else if (e.code === 'Escape') {
        e.preventDefault()
        if (route === 'settings') {
          window.location.hash = ''
          setRoute('main')
        } else if (isCapturing) {
          handleToggleCapture()
        }
      } else if (e.ctrlKey && e.code === 'KeyH') {
        e.preventDefault()
        if (isVisible) {
          window.electronAPI?.hideWindow()
        } else {
          window.electronAPI?.showWindow()
        }
        setIsVisible(!isVisible)
      } else if (!e.ctrlKey && e.code === 'KeyH') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('toggle-history'))
      } else if (!e.ctrlKey && e.code === 'KeyS') {
        e.preventDefault()
        if (window.electronAPI?.openSettings) {
          window.electronAPI.openSettings()
        } else {
          window.location.hash = '/settings'
          setRoute('settings')
        }
      } else if (!e.ctrlKey && e.code === 'KeyD') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('toggle-collapse'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route, isCapturing, isVisible])

  useEffect(() => {
    if (!isConnected || !backendUrlRef.current) return
    fetch(`${backendUrlRef.current}/devices`)
      .then(r => r.json())
      .then(setAudioDevices)
      .catch(() => setAudioDevices([
        { id: 'default', name: '默认麦克风', type: 'microphone' },
        { id: 'system', name: '系统音频', type: 'system' }
      ]))
  }, [isConnected])

  const handleSettingsChange = (patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        sendSettings(wsRef.current, next)
      }
      return next
    })
  }

  const handleToggleCapture = async () => {
    const ws = wsRef.current

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return
    }

    if (isCapturing) {
      ws.send(JSON.stringify({ type: 'stop_capture' }))
      setIsCapturing(false)
    } else {
      const s = settingsRef.current
      const deviceId = s.audioSource === 'microphone' ? 'default' : 'system'
      ws.send(JSON.stringify({
        type: 'start_capture',
        data: {
          device_id: deviceId,
          translate: s.displayMode !== 'original' && s.recognitionMode === 'api',
          chunk_duration: 4.0
        }
      }))
      setIsCapturing(true)
    }
  }

  const handleClose = async () => {
    wsRef.current?.send(JSON.stringify({ type: 'stop_capture' }))
    await new Promise(r => setTimeout(r, 100))
    mountedRef.current = false
    clearTimeout(reconnectTimer.current)
    try { wsRef.current?.close() } catch { /* ignore */ }
    await window.electronAPI?.quitApp()
  }

  if (route === 'settings') {
    return (
      <SettingsPanel
        settings={settings}
        audioDevices={audioDevices}
        isConnected={isConnected}
        modelStatus={modelStatus}
        onSettingsChange={handleSettingsChange}
        onClose={() => {
          window.location.hash = ''
          setRoute('main')
        }}
      />
    )
  }

  return (
    <SubtitleWindow
      settings={settings}
      subtitle={subtitle}
      isCapturing={isCapturing}
      isConnected={isConnected}
      audioLevel={audioLevel}
      onToggleCapture={handleToggleCapture}
      onOpenSettings={() => {
        if (window.electronAPI?.openSettings) {
          window.electronAPI.openSettings()
        } else {
          window.location.hash = '/settings'
          setRoute('settings')
        }
      }}
      onClose={handleClose}
    />
  )
}

export default App