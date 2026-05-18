import { useState, useRef, useEffect } from 'react'
import { Settings, Play, Square, X, Minimize2, ChevronsUpDown, Wifi, WifiOff } from 'lucide-react'
import type { AppSettings } from '../App'

interface SubtitleWindowProps {
  settings: AppSettings
  subtitle: { text: string; translation: string }
  isCapturing: boolean
  isConnected: boolean
  onToggleCapture: () => void
  onOpenSettings: () => void
  onClose?: () => void
}

function SubtitleWindow({
  settings,
  subtitle,
  isCapturing,
  isConnected,
  onToggleCapture,
  onOpenSettings,
  onClose
}: SubtitleWindowProps) {
  const [collapsed, setCollapsed] = useState(false)
  const textRef = useRef<HTMLDivElement>(null)
  const prevTextLen = useRef(0)

  useEffect(() => {
    const text = subtitle.text + subtitle.translation
    if (text.length === prevTextLen.current) return
    prevTextLen.current = text.length

    if (collapsed) return

    const el = textRef.current
    if (!el) return

    requestAnimationFrame(() => {
      const scrollH = el.scrollHeight
      const controlH = 38
      const padding = 24
      const totalH = Math.min(scrollH + controlH + padding, 300)
      const minH = collapsed ? controlH : 80

      const height = Math.max(minH, totalH)
      const width = Math.min(Math.max(text.length * settings.fontSize * 0.65 + 40, 400), 1200)

      window.electronAPI?.resizeWindow(Math.round(width), Math.round(height))
    })
  }, [subtitle.text, subtitle.translation, collapsed, settings.fontSize])

  const handleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    if (next) {
      window.electronAPI?.resizeWindow(400, 38)
    } else {
      window.electronAPI?.resizeWindow(800, 120)
    }
  }

  const renderContent = () => {
    const { displayMode } = settings

    if (!subtitle.text && !subtitle.translation) {
      return (
        <span className="placeholder-text">
          {!isConnected ? '正在连接服务...' : isCapturing ? '正在监听...' : '点击 ▶ 开始捕获音频'}
        </span>
      )
    }

    if (displayMode === 'original') {
      return subtitle.text
    }

    if (displayMode === 'translation') {
      return subtitle.translation || subtitle.text
    }

    return (
      <>
        {subtitle.text && <div>{subtitle.text}</div>}
        {subtitle.translation && (
          <div className="translation-line">{subtitle.translation}</div>
        )}
      </>
    )
  }

  return (
    <div
      className="subtitle-window"
      style={{
        backgroundColor: settings.backgroundColor,
        opacity: settings.opacity
      }}
    >
      <div className="drag-bar">
        <span className="drag-hint">
          <ChevronsUpDown size={14} />
          拖动移动
        </span>

        <div className="status-dot">
          {isConnected ? (
            <span className="dot green" title="已连接" />
          ) : (
            <span className="dot red" title="未连接" />
          )}
        </div>

        <div className="action-buttons">
          <button
            className="action-btn"
            onClick={onToggleCapture}
            disabled={!isConnected}
            title={isCapturing ? '停止捕获' : '开始捕获'}
          >
            {isCapturing ? <Square size={15} /> : <Play size={15} />}
          </button>

          <button className="action-btn" onClick={onOpenSettings} title="设置">
            <Settings size={15} />
          </button>

          <button className="action-btn" onClick={handleCollapse} title={collapsed ? '展开' : '收起'}>
            <Minimize2 size={15} />
          </button>

          <button className="action-btn danger" onClick={onClose} title="退出应用">
            <X size={15} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          ref={textRef}
          className="text-area"
          style={{
            fontSize: settings.fontSize,
            color: settings.textColor
          }}
        >
          {renderContent()}
        </div>
      )}
    </div>
  )
}

export default SubtitleWindow