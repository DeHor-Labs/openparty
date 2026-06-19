/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base do servidor HTTP/WS. Ex: http://localhost:3000 (prod) ou omitir em dev com proxy */
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
