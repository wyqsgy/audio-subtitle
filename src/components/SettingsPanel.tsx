import { useState } from 'react'
import { X, Mic, Speaker, Languages, Palette, Globe, Cpu, Cloud, RotateCcw, Check } from 'lucide-react'
import type { AppSettings } from '../App'

interface Props {
  settings: AppSettings
  audioDevices: Array<{ id: string; name: string; type: string }>
  isConnected: boolean
  modelStatus: string
  onSettingsChange: (s: Partial<AppSettings>) => void
  onClose: () => void
}

const languages = [
  { code: 'auto', name: '自动检测' },
  { code: 'zh', name: '中文' },
  { code: 'en', name: '英语' },
  { code: 'ja', name: '日语' },
  { code: 'ko', name: '韩语' },
  { code: 'fr', name: '法语' },
  { code: 'de', name: '德语' },
  { code: 'es', name: '西班牙语' },
  { code: 'ru', name: '俄语' }
]

const models = [
  { code: 'tiny', name: 'Tiny（最快，~39MB）' },
  { code: 'base', name: 'Base（推荐，~74MB）' },
  { code: 'small', name: 'Small（~244MB）' },
  { code: 'medium', name: 'Medium（~769MB）' },
  { code: 'large', name: 'Large（最准，~1.5GB）' }
]

const defaults: AppSettings = {
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

export default function SettingsPanel({
  settings, isConnected, modelStatus, onSettingsChange, onClose
}: Props) {
  const [saved, setSaved] = useState(false)

  const flashSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleChange = (patch: Partial<AppSettings>) => {
    onSettingsChange(patch)
    flashSave()
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>设置</h2>
        <div className="header-right">
          {saved && <span className="save-badge"><Check size={13} />已保存</span>}
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>
      </div>

      <div className="settings-content">
        <div className="settings-group">
          <h3><Cpu size={16} /> 识别模式</h3>
          <div className="radio-group">
            <label className="radio-option">
              <input type="radio" name="mode" value="local"
                checked={settings.recognitionMode === 'local'}
                onChange={() => handleChange({ recognitionMode: 'local' })} />
              <Cpu size={15} />
              <div>
                <div className="option-title">本地识别</div>
                <span className="option-desc">完全离线，无需联网，免费使用</span>
              </div>
            </label>
            <label className="radio-option">
              <input type="radio" name="mode" value="api"
                checked={settings.recognitionMode === 'api'}
                onChange={() => handleChange({ recognitionMode: 'api' })} />
              <Cloud size={15} />
              <div>
                <div className="option-title">在线 API</div>
                <span className="option-desc">调用云端服务，需配置 API Key</span>
              </div>
            </label>
          </div>

          {settings.recognitionMode === 'local' && (
            <div className="form-row" style={{ marginTop: 12 }}>
              <label>本地模型</label>
              <select value={settings.localModel}
                onChange={e => handleChange({ localModel: e.target.value })}>
                {models.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
              <p className="hint-text">首次使用自动下载，请耐心等待</p>
              {modelStatus && <p className="model-status-text">{modelStatus}</p>}
            </div>
          )}
        </div>

        <div className="settings-group" style={{ marginTop: 18 }}>
          <h3><Speaker size={16} /> 音频源</h3>
          <div className="radio-group">
            <label className="radio-option">
              <input type="radio" name="src" value="microphone"
                checked={settings.audioSource === 'microphone'}
                onChange={() => handleChange({ audioSource: 'microphone' })} />
              <Mic size={15} /> <span>麦克风输入</span>
            </label>
            <label className="radio-option">
              <input type="radio" name="src" value="system"
                checked={settings.audioSource === 'system'}
                onChange={() => handleChange({ audioSource: 'system' })} />
              <Speaker size={15} /> <span>系统音频输出</span>
            </label>
          </div>

          <h3 style={{ marginTop: 20 }}><Languages size={16} /> 语言</h3>
          <div className="form-row">
            <label>源语言</label>
            <select value={settings.sourceLanguage}
              onChange={e => handleChange({ sourceLanguage: e.target.value })}>
              {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          {settings.recognitionMode === 'api' && (
            <div className="form-row">
              <label>翻译目标语言</label>
              <select value={settings.targetLanguage}
                onChange={e => handleChange({ targetLanguage: e.target.value })}>
                {languages.filter(l => l.code !== 'auto').map(l =>
                  <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="settings-group" style={{ marginTop: 18 }}>
          <h3>显示模式</h3>
          <div className="radio-group">
            <label className="radio-option">
              <input type="radio" name="disp" value="original"
                checked={settings.displayMode === 'original'}
                onChange={() => handleChange({ displayMode: 'original' })} />
              <span>仅原文</span>
            </label>
            {settings.recognitionMode === 'api' && (
              <>
                <label className="radio-option">
                  <input type="radio" name="disp" value="translation"
                    checked={settings.displayMode === 'translation'}
                    onChange={() => handleChange({ displayMode: 'translation' })} />
                  <span>仅翻译</span>
                </label>
                <label className="radio-option">
                  <input type="radio" name="disp" value="both"
                    checked={settings.displayMode === 'both'}
                    onChange={() => handleChange({ displayMode: 'both' })} />
                  <span>原文 + 翻译</span>
                </label>
              </>
            )}
          </div>

          <h3 style={{ marginTop: 20 }}><Palette size={16} /> 样式</h3>
          <div className="form-row">
            <label>字体大小：{settings.fontSize}px</label>
            <input type="range" min={12} max={48} value={settings.fontSize}
              onChange={e => handleChange({ fontSize: +e.target.value })} />
          </div>
          <div className="form-row">
            <label>透明度：{Math.round(settings.opacity * 100)}%</label>
            <input type="range" min={0.1} max={1} step={0.1} value={settings.opacity}
              onChange={e => handleChange({ opacity: +e.target.value })} />
          </div>
          <div className="color-row">
            <div className="form-row">
              <label>文字颜色</label>
              <input type="color" value={settings.textColor}
                onChange={e => handleChange({ textColor: e.target.value })} />
            </div>
            <div className="form-row">
              <label>背景颜色</label>
              <input type="color" value={settings.backgroundColor.replace(/rgba?\([^)]+\)/, '#000000')}
                onChange={e => handleChange({ backgroundColor: `${e.target.value}cc` })} />
            </div>
          </div>

          <button className="reset-btn" onClick={() => handleChange(defaults)}>
            <RotateCcw size={14} /> 恢复默认设置
          </button>
        </div>

        {settings.recognitionMode === 'api' && (
          <div className="settings-group" style={{ marginTop: 18 }}>
            <h3><Globe size={16} /> API 配置</h3>
            <p className="api-note">支持 OpenAI、智谱 GLM、DeepSeek 等</p>
            <div className="form-row">
              <label>Base URL</label>
              <input type="text" placeholder="https://api.openai.com/v1"
                value={settings.apiBaseUrl}
                onChange={e => handleChange({ apiBaseUrl: e.target.value })} />
            </div>
            <div className="form-row">
              <label>API Key</label>
              <input type="password" placeholder="sk-..." value={settings.apiKey}
                onChange={e => handleChange({ apiKey: e.target.value })} />
            </div>
            <div className="form-row">
              <label>AI 字幕优化</label>
              <div className="radio-group">
                <label className="radio-option">
                  <input type="radio" name="enhance" value="on"
                    checked={settings.enhanceSubtitles}
                    onChange={() => handleChange({ enhanceSubtitles: true })} />
                  <span>开启 — 修正错别字、补全标点、去除语气词</span>
                </label>
                <label className="radio-option">
                  <input type="radio" name="enhance" value="off"
                    checked={!settings.enhanceSubtitles}
                    onChange={() => handleChange({ enhanceSubtitles: false })} />
                  <span>关闭 — 保留原始识别结果</span>
                </label>
              </div>
            </div>
          </div>
        )}

        <div className="footer-bar">
          <span className={`status-dot-big ${isConnected ? 'ok' : 'err'}`} />
          <span className="footer-text">
            {isConnected ? '服务已连接' : '服务未连接'}
            {modelStatus ? ` · ${modelStatus}` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}