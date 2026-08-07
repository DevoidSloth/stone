/// <reference types="vite/client" />

import type { StoneApi } from '../../preload'

declare global {
  interface Window {
    stone: StoneApi
  }
}

export {}
