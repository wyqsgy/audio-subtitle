import { X, Mic, Speaker, Languages, Palette, Globe, Cpu, Cloud } from 'lucide-react'
import type { AppSettings } from '../App'

interface Props {
  settings: AppSettings
  audioDevices: Array<{ id: string; name: string; type: string }>
  isConnected: boolean
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

export default function SettingsPanel({ settings, isConnected, onSettingsChange, onClose }: Props) {
  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>设置</h2>
        <button className="close-btn" onClick={onClose}><X size={18} /></button>
      </div>

      <div className="settings-content">
        <div className="settings-group">
          <h3><Cpu size={16} /> 识别模式</h3>
          <div className="radio-group">
            <label className="radio-option">
              <input type="radio" name="mode" value="local"
                checked={settings.recognitionMode === 'local'}
                onChange={() => onSettingsChange({ recognitionMode: 'local' })} />
              <Cpu size={15} />
              <div>
                <div className="option-title">本地识别</div>
                <span className="option-desc">使用本地 Whisper 模型，无需联网，完全免费</span>
              </div>
            </label>
            <label className="radio-option">
              <input type="radio" name="mode" value="api"
                checked={settings.recognitionMode === 'api'}
                onChange={() => onSettingsChange({ recognitionMode: 'api' })} />
              <Cloud size={15} />
              <div>
                <div className="option-title">在线 API</div>
                <span className="option-desc">调用云端 API，需配置 API Key</span>
              </div>
            </label>
          </div>

          {settings.recognitionMode === 'local' && (
            <div className="form-row" style={{ marginTop: 12 }}>
              <label>本地模型</label>
              <select value={settings.localModel}
                onChange={e => onSettingsChange({ localModel: e.target.value })}>
                {models.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
              <p className="hint-text">首次使用将自动下载模型</p>
            </div>
          )}
        </div>

        <div className="settings-group" style={{ marginTop: 18 }}>
          <h3><Speaker size={16} /> 音频源</h3>
          <div className="radio-group">
            <label className="radio-option">
              <input type="radio" name="src" value="microphone"
                checked={settings.audioSource === 'microphone'}
                onChange={() => onSettingsChange({ audioSource: 'microphone' })} />
              <Mic size={15} />
              <span>麦克风输入</span>
            </label>
            <label className="radio-option">
              <input type="radio" name="src" value="system"
                checked={settings.audioSource === 'system'}
                onChange={() => onSettingsChange({ audioSource: 'system' })} />
              <Speaker size={15} />
              <span>系统音频输出（需要 Stereo Mix 设备）</span>
            </label>
          </div>

          <h3 style={{ marginTop: 20 }}><Languages size={16} /> 语言</h3>
          <div className="form-row">
            <label>源语言</label>
            <select value={settings.sourceLanguage}
              onChange={e => onSettingsChange({ sourceLanguage: e.target.value })}>
              {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          {settings.recognitionMode === 'api' && (
            <div className="form-row">
              <label>翻译目标语言</label>
              <select value={settings.targetLanguage}
                onChange={e => onSettingsChange({ targetLanguage: e.target.value })}>
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
                onChange={() => onSettingsChange({ displayMode: 'original' })} />
              <span>仅原文</span>
            </label>
            {settings.recognitionMode === 'api' && (
              <>
                <label className="radio-option">
                  <input type="radio" name="disp" value="translation"
                    checked={settings.displayMode === 'translation'}
                    onChange={() => onSettingsChange({ displayMode: 'translation' })} />
                  <span>仅翻译</span>
                </label>
                <label className="radio-option">
                  <input type="radio" name="disp" value="both"
                    checked={settings.displayMode === 'both'}
                    onChange={() => onSettingsChange({ displayMode: 'both' })} />
                  <span>原文 + 翻译</span>
                </label>
              </>
            )}
          </div>

          <h3 style={{ marginTop: 20 }}><Palette size={16} /> 样式</h3>
          <div className="form-row">
            <label>字体大小：{settings.fontSize}px</label>
            <input type="range" min={12} max={48} value={settings.fontSize}
              onChange={e => onSettingsChange({ fontSize: +e.target.value })} />
          </div>
          <div className="form-row">
            <label>透明度：{Math.round(settings.opacity * 100)}%</label>
            <input type="range" min={0.1} max={1} step={0.1} value={settings.opacity}
              onChange={e => onSettingsChange({ opacity: +e.target.value })} />
          </div>
          <div className="form-row">
            <label>文字颜色</label>
            <input type="color" value={settings.textColor}
              onChange={e => onSettingsChange({ textColor: e.target.value })} />
          </div>
          <div className="form-row">
            <label>背景颜色</label>
            <input type="color" value={settings.backgroundColor.replace(/rgba?\([^)]+\)/, '#000000')}
              onChange={e => onSettingsChange({ backgroundColor: `${e.target.value}cc` })} />
          </div>
        </div>

        {settings.recognitionMode === 'api' && (
          <div className="settings-group" style={{ marginTop: 18 }}>
            <h3><Globe size={16} /> API 配置</h3>
            <p className="api-note">支持 OpenAI、智谱 GLM、DeepSeek 等兼容接口</p>
            <div className="form-row">
              <label>API Base URL</label>
              <input type="text" placeholder="https://api.openai.com/v1" value={settings.apiBaseUrl}
                onChange={e => onSettingsChange({ apiBaseUrl: e.target.value })} />
            </div>
            <div className="form-row">
              <label>API Key</label>
              <input type="password" placeholder="sk-..." value={settings.apiKey}
                onChange={e => onSettingsChange({ apiKey: e.target.value })} />
            </div>
          </div>
        )}

        <div className="connection-status-box">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
          <span>后端：{isConnected ? '已连接' : '未连接'}</span>
        </div>
      </div>
    </div>
  )
}