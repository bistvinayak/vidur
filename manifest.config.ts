import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
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
})
