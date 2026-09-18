import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../sidepanel/App.css'
import './options.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
