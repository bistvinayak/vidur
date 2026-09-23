import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../lib/storage'
import { ANTHROPIC_MODELS, OPENAI_MODELS, OPENROUTER_FREE_MODELS } from '../lib/types'
import type { FreeModelOption, Provider, Settings } from '../lib/types'

const PROVIDER_INFO: Record<Provider, { label: string; models: FreeModelOption[]; keyHint: string; keyPlaceholder: string }> = {
  openrouter: {
    label: 'OpenRouter (free)',
    models: OPENROUTER_FREE_MODELS,
    keyHint: 'Free account at openrouter.ai/keys.',
    keyPlaceholder: 'sk-or-v1-…',
  },
  anthropic: {
    label: 'Claude (Anthropic, paid)',
    models: ANTHROPIC_MODELS,
    keyHint: 'Your own Anthropic API key — usage is billed to your account.',
    keyPlaceholder: 'sk-ant-…',
  },
  openai: {
    label: 'GPT (OpenAI, paid)',
    models: OPENAI_MODELS,
    keyHint: 'Your own OpenAI API key — usage is billed to your account.',
    keyPlaceholder: 'sk-…',
  },
}

const KEY_FIELD: Record<Provider, keyof Settings> = {
  openrouter: 'openrouterApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
}
const MODEL_FIELD: Record<Provider, keyof Settings> = {
  openrouter: 'openrouterModel',
  anthropic: 'anthropicModel',
  openai: 'openaiModel',
}

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

  const info = PROVIDER_INFO[settings.provider]
  const keyField = KEY_FIELD[settings.provider]
  const modelField = MODEL_FIELD[settings.provider]

  return (
    <div>
      <h1>Vidur — Settings</h1>

      <div className="field">
        <label htmlFor="provider">Model provider</label>
        <select
          id="provider"
          value={settings.provider}
          onChange={(e) => setSettings({ ...settings, provider: e.target.value as Provider })}
        >
          {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_INFO[p].label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="model">Model</label>
        <select
          id="model"
          value={settings[modelField] as string}
          onChange={(e) => setSettings({ ...settings, [modelField]: e.target.value })}
        >
          {info.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.recommended ? ' — Recommended' : ''}
            </option>
          ))}
        </select>
        <p className="hint">{info.models.find((m) => m.id === settings[modelField])?.note}</p>
        {settings.provider === 'openrouter' && (
          <p className="hint">If this model is unavailable, the other free models above are tried automatically as fallback.</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="key">{info.label} API key</label>
        <input
          id="key"
          type="password"
          value={settings[keyField] as string}
          onChange={(e) => setSettings({ ...settings, [keyField]: e.target.value })}
          placeholder={info.keyPlaceholder}
        />
        <p className="hint">{info.keyHint} Stored only in this browser (chrome.storage.local) — never bundled with the extension.</p>
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
        <p className="hint">Vidur only ever runs when you click it — this list is an extra opt-out for sensitive sites.</p>
      </div>

      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={settings.langfuseEnabled}
            onChange={(e) => setSettings({ ...settings, langfuseEnabled: e.target.checked })}
          />{' '}
          Send traces to Langfuse
        </label>
        <p className="hint">
          Off by default — enabling this sends the full prompt and response for every summary and follow-up to your
          Langfuse project, so you can inspect exactly what each conversation thread sent and got back. This is a real
          data-sharing decision, not just a debug toggle.
        </p>
      </div>

      {settings.langfuseEnabled && (
        <>
          <div className="field">
            <label htmlFor="lf-public">Langfuse public key</label>
            <input
              id="lf-public"
              value={settings.langfusePublicKey}
              onChange={(e) => setSettings({ ...settings, langfusePublicKey: e.target.value })}
              placeholder="pk-lf-…"
            />
          </div>
          <div className="field">
            <label htmlFor="lf-secret">Langfuse secret key</label>
            <input
              id="lf-secret"
              type="password"
              value={settings.langfuseSecretKey}
              onChange={(e) => setSettings({ ...settings, langfuseSecretKey: e.target.value })}
              placeholder="sk-lf-…"
            />
          </div>
          <div className="field">
            <label htmlFor="lf-host">Langfuse host</label>
            <input
              id="lf-host"
              value={settings.langfuseHost}
              onChange={(e) => setSettings({ ...settings, langfuseHost: e.target.value })}
              placeholder="https://cloud.langfuse.com"
            />
            <p className="hint">Change this if you're self-hosting Langfuse instead of using their cloud.</p>
          </div>
        </>
      )}

      <button className="primary-btn" onClick={handleSave}>
        Save
      </button>
      {saved && <p className="saved">Saved.</p>}
    </div>
  )
}
