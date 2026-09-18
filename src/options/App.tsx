import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../lib/storage'
import type { Settings } from '../lib/types'

export default function App() {
  const [settings, setSettings] = useState<Settings | undefined>()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  if (!settings) return null

  async function handleSave() {
    await saveSettings(settings!)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      <h1>Page Copilot — Settings</h1>

      <div className="field">
        <label htmlFor="key">OpenRouter API key</label>
        <input
          id="key"
          type="password"
          value={settings.openrouterApiKey}
          onChange={(e) => setSettings({ ...settings, openrouterApiKey: e.target.value })}
          placeholder="sk-or-v1-…"
        />
        <p className="hint">
          Stored only in this browser (chrome.storage.local) — never bundled with the extension or sent
          anywhere but OpenRouter. Get a free key at openrouter.ai/keys.
        </p>
      </div>

      <div className="field">
        <label htmlFor="lang">Output language</label>
        <input
          id="lang"
          value={settings.outputLanguage}
          onChange={(e) => setSettings({ ...settings, outputLanguage: e.target.value })}
          placeholder="Leave blank to match the page's language"
        />
      </div>

      <div className="field">
        <label htmlFor="blocked">Never read these domains</label>
        <textarea
          id="blocked"
          rows={3}
          value={settings.blockedDomains.join('\n')}
          onChange={(e) =>
            setSettings({
              ...settings,
              blockedDomains: e.target.value
                .split('\n')
                .map((d) => d.trim())
                .filter(Boolean),
            })
          }
          placeholder={'one domain per line, e.g.\nbank.com\nhealth.example.com'}
        />
        <p className="hint">Page Copilot only ever runs when you click it — this list is an extra opt-out for sensitive sites.</p>
      </div>

      <button className="primary-btn" onClick={handleSave}>
        Save
      </button>
      {saved && <p className="saved">Saved.</p>}
    </div>
  )
}
