import { useState, useRef, useEffect } from 'react'
import { Settings, Play, Square, X, Minimize2, ChevronsUpDown, History, Keyboard, Sparkles, Download, Trash2 } from 'lucide-react'
import type { AppSettings } from '../App'

interface SubtitleWindowProps {
  settings: AppSettings
  subtitle: { text: string; translation: string }
  isCapturing: boolean
  isConnected: boolean
  audioLevel: number
  onToggleCapture: () => void
  onOpenSettings: () => void
  onClose?: () => void
}

interface HistoryItem {
  id: number
  text: string
  translation: string
  timestamp: number
}

interface SessionSummary {
  summary: string
  key_points: string[]
}

let idCounter = 0

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function SubtitleWindow({
  settings,
  subtitle,
  isCapturing,
  isConnected,
  audioLevel,
  onToggleCapture,
  onOpenSettings,
  onClose
}: SubtitleWindowProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [currentItem, setCurrentItem] = useState<HistoryItem | null>(null)
  const [fadeState, setFadeState] = useState<'enter' | 'show' | 'exit'>('enter')
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const textRef = useRef<HTMLDivElement>(null)
  const prevKey = useRef('')
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>()

  const getBackendUrl = async (): Promise<string> => {
    if (window.electronAPI?.getBackendUrl) return window.electronAPI.getBackendUrl()
    return 'http://127.0.0.1:8765'
  }

  const handleSummary = async () => {
    setSummaryLoading(true)
    setSummaryError('')
    try {
      const base = await getBackendUrl()
      const res = await fetch(`${base}/summary`, { method: 'POST' })
      const json = await res.json()
      if (json.status === 'ok') {
        setSummary(json.data)
      } else {
        setSummaryError(json.message || '纪要生成失败')
      }
    } catch (e) {
      setSummaryError((e as Error).message || '网络错误')
    } finally {
      setSummaryLoading(false)
    }
  }

  const handleExportSrt = async () => {
    try {
      const base = await getBackendUrl()
      const res = await fetch(`${base}/session/export`)
      const json = await res.json()
      if (json.format !== 'srt' || !json.content) {
        setSummaryError(json.message || '暂无可导出的字幕')
        return
      }
      const blob = new Blob([json.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `subtitle-session-${Date.now()}.srt`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setSummaryError((e as Error).message || '导出失败')
    }
  }

  const handleClearSession = async () => {
    try {
      const base = await getBackendUrl()
      await fetch(`${base}/session/clear`, { method: 'POST' })
      setHistory([])
      setSummary(null)
      setSummaryError('')
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const key = subtitle.text + '|' + subtitle.translation
    if (!key || key === prevKey.current) return
    prevKey.current = key

    const item: HistoryItem = {
      id: ++idCounter,
      text: subtitle.text,
      translation: subtitle.translation,
      timestamp: Date.now()
    }

    clearTimeout(fadeTimer.current)

    if (currentItem && currentItem.text) {
      setFadeState('exit')
      fadeTimer.current = setTimeout(() => {
        setCurrentItem(item)
        setHistory(prev => [item, ...prev].slice(0, 50))
        setFadeState('enter')
        fadeTimer.current = setTimeout(() => setFadeState('show'), 50)
      }, 200)
    } else {
      setCurrentItem(item)
      setHistory(prev => [item, ...prev].slice(0, 50))
      setFadeState('enter')
      fadeTimer.current = setTimeout(() => setFadeState('show'), 50)
    }
  }, [subtitle.text, subtitle.translation])

  useEffect(() => {
    return () => clearTimeout(fadeTimer.current)
  }, [])

  useEffect(() => {
    const onToggleHistory = () => setShowHistory(prev => !prev)
    const onToggleCollapse = () => {
      setCollapsed(prev => {
        const next = !prev
        if (next) setShowHistory(false)
        window.electronAPI?.resizeWindow(400, next ? 38 : 120)
        return next
      })
    }

    window.addEventListener('toggle-history', onToggleHistory)
    window.addEventListener('toggle-collapse', onToggleCollapse)
    return () => {
      window.removeEventListener('toggle-history', onToggleHistory)
      window.removeEventListener('toggle-collapse', onToggleCollapse)
    }
  }, [])

  useEffect(() => {
    if (collapsed || showHistory) return
    const el = textRef.current
    if (!el || !currentItem) return

    requestAnimationFrame(() => {
      const fullText = currentItem.text + currentItem.translation
      const scrollH = el.scrollHeight
      const controlH = 38
      const padding = 24
      const totalH = Math.min(scrollH + controlH + padding, 300)
      const height = Math.max(80, totalH)
      const width = Math.min(Math.max(fullText.length * settings.fontSize * 0.6 + 40, 400), 1200)

      window.electronAPI?.resizeWindow(Math.round(width), Math.round(height))
    })
  }, [currentItem, collapsed, showHistory, settings.fontSize])

  useEffect(() => {
    if (showHistory) {
      window.electronAPI?.resizeWindow(520, 400)
    }
  }, [showHistory])

  const handleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    if (next) {
      setShowHistory(false)
    }
    window.electronAPI?.resizeWindow(400, next ? 38 : 120)
  }

  const handleHistoryToggle = () => {
    const next = !showHistory
    setShowHistory(next)
    if (next) {
      setCollapsed(false)
    }
  }

  const renderText = () => {
    if (!currentItem || (!currentItem.text && !currentItem.translation)) {
      return (
        <span className="placeholder-text">
          {!isConnected
            ? '等待服务连接...'
            : isCapturing
              ? <span className="listening-dots">监听中<span className="animated-dots" /></span>
              : (
                <span>
                  按 <kbd className="key-hint">Space</kbd> 开始捕获 &middot;
                  <kbd className="key-hint">H</kbd> 历史 &middot;
                  <kbd className="key-hint">S</kbd> 设置
                </span>
              )}
        </span>
      )
    }

    const { displayMode } = settings

    if (displayMode === 'original') {
      return currentItem.text
    }

    if (displayMode === 'translation') {
      return currentItem.translation || currentItem.text
    }

    return (
      <>
        {currentItem.text && <div>{currentItem.text}</div>}
        {currentItem.translation && (
          <div className="translation-line">{currentItem.translation}</div>
        )}
      </>
    )
  }

  const levelPercent = Math.min(audioLevel * 1.5, 1)

  return (
    <div
      className="subtitle-window"
      style={{
        backgroundColor: settings.backgroundColor,
        opacity: settings.opacity,
        transition: 'opacity 0.3s ease'
      }}
    >
      <div className="drag-bar">
        <span className="drag-hint">
          <ChevronsUpDown size={14} />
          拖动移动
        </span>

        <div className="status-area">
          {isCapturing && (
            <div className="audio-level-bar">
              <div
                className="audio-level-fill"
                style={{
                  width: `${levelPercent * 100}%`,
                  backgroundColor: levelPercent > 0.6 ? '#4ade80' : levelPercent > 0.2 ? '#fbbf24' : '#f87171'
                }}
              />
            </div>
          )}
          <span className={`status-pill ${isConnected ? 'online' : 'offline'}`} title={isConnected ? '已连接' : '未连接'}>
            {isConnected ? '●' : '○'} {isConnected ? '已连接' : '未连接'}
          </span>
          {isCapturing && <span className="status-pill capturing">录制中</span>}
        </div>

        <div className="action-buttons">
          <button
            className="action-btn" onClick={() => setShowShortcuts(!showShortcuts)}
            title="快捷键"
          >
            <Keyboard size={14} />
          </button>

          <button
            className={`action-btn ${showHistory ? 'active' : ''}`}
            onClick={handleHistoryToggle}
            title="历史记录"
          >
            <History size={15} />
          </button>

          <button
            className={`action-btn play-btn ${isCapturing ? 'active' : ''}`}
            onClick={onToggleCapture}
            disabled={!isConnected}
            title={isCapturing ? '停止捕获 (Space)' : '开始捕获 (Space)'}
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

      {showShortcuts && (
        <div className="shortcuts-panel">
          <div className="shortcuts-title">键盘快捷键</div>
          <div className="shortcuts-grid">
            <div><kbd className="kbd">Space</kbd> 开始 / 停止捕获</div>
            <div><kbd className="kbd">Esc</kbd> 停止捕获 / 关闭设置</div>
            <div><kbd className="kbd">Ctrl+H</kbd> 显示 / 隐藏窗口</div>
            <div><kbd className="kbd">H</kbd> 历史记录</div>
            <div><kbd className="kbd">S</kbd> 设置</div>
            <div><kbd className="kbd">D</kbd> 折叠 / 展开</div>
          </div>
        </div>
      )}

      {showHistory && !collapsed && (
        <div className="history-panel">
          <div className="history-header">
            <span>字幕历史</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="history-count">{history.length} 条</span>
              <button
                className="action-btn"
                onClick={handleSummary}
                disabled={summaryLoading}
                title="AI 生成会话纪要（需 API 模式）"
                style={{ opacity: summaryLoading ? 0.6 : 1 }}
              >
                <Sparkles size={13} />
                <span style={{ fontSize: 11, marginLeft: 4 }}>{summaryLoading ? '生成中…' : 'AI 纪要'}</span>
              </button>
              <button className="action-btn" onClick={handleExportSrt} title="导出会话字幕 (SRT)">
                <Download size={13} />
                <span style={{ fontSize: 11, marginLeft: 4 }}>导出</span>
              </button>
              <button className="action-btn danger" onClick={handleClearSession} title="清空会话">
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {(summary || summaryError) && (
            <div
              className="summary-panel"
              style={{
                margin: '10px 12px',
                padding: '12px 14px',
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: 10,
                fontSize: 12,
                lineHeight: 1.7,
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {summaryError && <div style={{ color: '#fca5a5' }}>{summaryError}</div>}
              {summary && (
                <>
                  <div style={{ color: '#c7d2fe', fontWeight: 600, marginBottom: 6 }}>✨ 会话纪要</div>
                  <div style={{ color: settings.textColor }}>{summary.summary}</div>
                  {summary.key_points?.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {summary.key_points.map((p, i) => (
                        <li key={i} style={{ color: settings.textColor, opacity: 0.9 }}>{p}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div className="history-list">
            {history.length === 0 ? (
              <div className="history-empty">暂无历史记录</div>
            ) : (
              history.map(item => (
                <div key={item.id} className="history-row">
                  <span className="history-time">{formatTime(item.timestamp)}</span>
                  <div className="history-text">
                    <div className="history-original">{item.text || '<空>'}</div>
                    {item.translation && (
                      <div className="history-translation">{item.translation}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {!collapsed && !showHistory && (
        <div
          ref={textRef}
          className={`text-area fade-${fadeState}`}
          style={{
            fontSize: settings.fontSize,
            color: settings.textColor,
            transition: 'opacity 0.18s ease, transform 0.18s ease'
          }}
        >
          {renderText()}
        </div>
      )}
    </div>
  )
}

export default SubtitleWindow