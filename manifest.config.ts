import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  // Pins the extension's ID (chrome-extension://cojjeeofpghidendcnemfpppjmcgbnah)
  // so it stays stable across reloads / moving the project folder — the
  // local web viewer needs to hardcode this ID to reach the extension via
  // externally_connectable. Generated once with openssl; see server/dev-key.pem
  // (gitignored, not needed for anything else — safe to regenerate if lost,
  // just also update EXTENSION_ID in server/public/index.html to match).
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAurTP/fn5CJXu4JUDQbZhcTQcFSFgGtaYLqvmwm72IOzH1AI1XTvzkSTqzWIe1FUEgwDHKpZpDmaoG1loSxluHSDVM7VJlm3Jb0UVqgCPhD/+wR0eT6IYdGC3nUXYCCIt5VenSAyglr2TuaQy9WMn2hNPORFLMpMR7FXTkrr9g/t4BmulOIPbhWd6cg+VjDszYVFtZmfpGTTJG8KxV9xUwd1oRRl5onVk1oaAX/xW9jlMlslTgNRIVSOwPOvn+Sf4+LqZHuCkHhSsCODicb6pi3rgVxjpdTuuUA3r8T5Mds1sQw5sF/Y08SK2aHnjB0K9siuCpuWsSffsfHejL3VYXQIDAQAB',
  name: 'Vidur',
  description: 'Summarizes the page you\'re on, surfaces what actually matters, and suggests the right follow-up.',
  version: pkg.version,
  action: {
    default_title: 'Vidur',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  // Deliberately no broad host_permissions / static content_scripts here.
  // activeTab + scripting means the extension only ever touches the page
  // the user explicitly invoked it on, and never runs in the background
  // on every site — see README for why. localhost is the one exception,
  // needed to mirror threads to the local web viewer (see server/).
  permissions: ['activeTab', 'scripting', 'storage', 'sidePanel'],
  host_permissions: ['http://localhost:4300/*'],
  // Lets the local web viewer message the background script directly
  // (chrome.runtime.sendMessage) instead of going through the HTTP mirror —
  // this is how replies typed on the web page reach the model.
  externally_connectable: {
    matches: ['http://localhost:4300/*'],
  },
})
