/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_WHEEL_SENSITIVITY?: string
  readonly VITE_MAP_MIN_ZOOM?: string
  readonly VITE_MAP_MAX_ZOOM?: string
  readonly VITE_MAP_DEFAULT_THEME?: 'light' | 'dark'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
