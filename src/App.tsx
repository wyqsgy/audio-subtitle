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
      resizeWindow: (width: number, height: number) => Promise<{ success: boolean }>
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
  localModel: 'base'
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
  const [audioDevices, setAudioDevices] = useState<Array<{ id: string; name: string; type: string }>>([])

  const wsRef = useRef<WebSocket | null>(null)
  const backendUrlRef = useRef('http://127.0.0.1:8765')
  const wsUrlRef = useRef('ws://127.0.0.1:8765/ws')

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash === '#/settings' ? 'settings' : 'main')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    localStorage.setItem('audio-subtitle-settings', JSON.stringify(settings))
  }, [settings])

  const sendSettings = useCallback((s: AppSettings, ws: WebSocket) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'settings',
      data: {
        api_key: s.apiKey,
        api_base_url: s.apiBaseUrl,
        source_language: s.sourceLanguage,
        target_language: s.targetLanguage,
        recognition_mode: s.recognitionMode,
        local_model: s.localModel
      }
    }))
  }, [])

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current

    try {
      if (window.electronAPI) {
        backendUrlRef.current = await window.electronAPI.getBackendUrl()
        wsUrlRef.current = await window.electronAPI.getWsUrl()
      }

      const ws = new WebSocket(wsUrlRef.current)

      ws.onopen = () => {
        setIsConnected(true)
        sendSettings(settings, ws)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'subtitle') {
            setSubtitle({
              text: msg.data.original || '',
              translation: msg.data.translation || ''
            })
          }
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = () => {
        setIsConnected(false)
        setIsCapturing(false)
      }

      wsRef.current = ws
      return ws
    } catch (err) {
      console.error('WebSocket connect failed:', err)
      return null
    }
  }, [settings, sendSettings])

  useEffect(() => {
    connect()
    return () => { wsRef.current?.close() }
  }, [connect])

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
      if (wsRef.current) sendSettings(next, wsRef.current)
      return next
    })
  }

  const handleToggleCapture = async () => {
    let ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws = await connect()
      if (!ws) return
    }

    if (isCapturing) {
      ws.send(JSON.stringify({ type: 'stop_capture' }))
      setIsCapturing(false)
    } else {
      const deviceId = settings.audioSource === 'microphone' ? 'default' : 'system'
      ws.send(JSON.stringify({
        type: 'start_capture',
        data: {
          device_id: deviceId,
          translate: settings.displayMode !== 'original' && settings.recognitionMode === 'api',
          chunk_duration: 4.0
        }
      }))
      setIsCapturing(true)
    }
  }

  const handleClose = async () => {
    wsRef.current?.send(JSON.stringify({ type: 'stop_capture' }))
    wsRef.current?.close()
    await window.electronAPI?.quitApp()
  }

  if (route === 'settings') {
    return (
      <SettingsPanel
        settings={settings}
        audioDevices={audioDevices}
        isConnected={isConnected}
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