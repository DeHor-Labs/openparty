# OpenParty - Spec da Fase 1: Web App Universal de Watch Party

> Status: aprovado no brainstorming (2026-06-18). Proximo passo: plano de implementacao.
> Autor: Nikolas de Hor. Licenca do projeto: MIT.

## 1. Contexto e objetivo

OpenParty e um "Teleparty open source": assistir videos sincronizados com outras pessoas a distancia, com chat em grupo. E um produto hibrido construido em fases:

- **Fase 1 (este spec):** web app universal, self-hostavel, que constroi o nucleo reutilizavel (salas + motor de sincronizacao + chat). Suporta YouTube e URLs diretas de video.
- **Fase 2 (spec futuro):** extensao de navegador que reusa o mesmo nucleo (`packages/protocol`) para sincronizar servicos de terceiros.

**Objetivo principal:** vitrine OSS / portfolio. Prioriza qualidade de codigo, design, DX de self-host, README forte e um deploy demo. Sem objetivo comercial e sem paywall.

## 2. Visao do produto

O usuario cria uma **sala por link** (sem cadastro), cola uma URL de **YouTube** ou de **video direto (MP4/WebM)**, compartilha o link, e assiste sincronizado: play/pause/seek de um refletem em todos, com **chat lateral**, **lista de presenca** e **reacoes de emoji flutuantes**. Tema claro/escuro.

## 3. Escopo

### 3.1 Must-have (MVP da Fase 1)

| Feature | Detalhe |
|---|---|
| Criar sala e gerar link | `POST /rooms` retorna `roomId` via `nanoid` (nao enumeravel) + URL copiavel |
| Entrar via link sem cadastro | Abrir a URL carrega o player e abre o WebSocket |
| Nickname + avatar emoji | Escolhidos antes de entrar; guardados na sessao do WebSocket |
| Lista de presenca em tempo real | Eventos `join`/`leave` atualizam a sidebar |
| Player YouTube (IFrame Player API) | Controle de play/pause/seek e leitura de tempo via API oficial |
| Player HTML5 `<video>` | Para URLs diretas `.mp4` / `.webm` |
| Sincronizacao de playback | Protocolo `play`/`pause`/`seek`/`room-state` + calibracao de relogio |
| Chat em tempo real | Texto + emojis, feed na sidebar |
| Reacoes de emoji flutuantes | Emojis que sobem sobre o player; reforcam presenca sem camera |
| Tema claro/escuro | Via Tailwind + shadcn/ui |
| Toggle host-lock | Host escolhe "so eu controlo" ou "todos controlam" |
| Transferencia de host | Se o host sai, o servidor promove outro participante |
| Reconexao automatica | Cliente reconecta e recebe `room-state` com a posicao atual |

### 3.2 Nice-to-have (pos-MVP, ainda Fase 1 se sobrar tempo)

- Indicador de buffering do grupo (quem esta carregando)
- Compartilhar sala por QR code
- Copiar link com feedback visual e atalhos de teclado

### 3.3 Fora de escopo (decidido)

- Netflix / Disney+ / Prime / HBO (DRM + ToS) - fica para a Fase 2 (extensao), sob responsabilidade do usuario
- Voz/video dos participantes via WebRTC (usuarios ja usam Discord/WhatsApp)
- App nativo iOS/Android
- Playlist colaborativa
- Salas persistentes em banco de dados (estado em memoria basta no MVP)
- Paywall / premium
- HLS/DASH e upload de arquivo (cole uma URL) - candidatos a fase posterior

## 4. Arquitetura

### 4.1 Monorepo (pnpm workspaces + Turborepo)

```
openparty/
├── apps/
│   ├── web/                    # React + Vite + Tailwind + shadcn/ui
│   │   └── src/
│   │       ├── components/
│   │       │   ├── room/       # RoomPlayer, RoomChat, RoomSidebar, RoomControls, ReactionsLayer
│   │       │   └── ui/         # shadcn/ui
│   │       ├── hooks/
│   │       │   ├── useRoom.ts  # conexao WS + estado da sala
│   │       │   ├── useSync.ts  # loop de drift correction
│   │       │   └── useClock.ts # calibracao de offset (NTP-like)
│   │       └── lib/
│   │           ├── players/
│   │           │   ├── youtube.ts   # wrapper YouTube IFrame API
│   │           │   └── html5.ts     # wrapper <video>
│   │           └── ws-client.ts
│   └── server/                 # Bun + Hono + WebSocket nativo
│       └── src/
│           ├── index.ts
│           ├── rooms.ts        # Map<roomId, Room> + broadcast
│           └── handlers/
│               ├── sync.ts     # play/pause/seek/room-state
│               ├── chat.ts     # chat + reacoes
│               └── clock.ts    # ping/pong de calibracao
├── packages/
│   ├── protocol/               # NUCLEO: tipos compartilhados do protocolo WS
│   │   └── src/
│   │       ├── events.ts       # SyncEvent, ChatEvent, PresenceEvent, ClockEvent, ReactionEvent
│   │       └── index.ts
│   └── ui/                     # componentes reutilizaveis (preparacao para a Fase 2)
├── docker-compose.yml          # server + web; Redis opcional via REDIS_URL
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

`packages/protocol/src/events.ts` e o contrato central: servidor, web e (Fase 2) a extensao consomem os mesmos tipos. Sem copia, sem drift de interface.

### 4.2 Stack

| Camada | Escolha | Justificativa |
|---|---|---|
| Runtime backend | Bun v1.x | Throughput alto, imagem Docker enxuta, stack diferenciada para portfolio 2026 |
| Framework backend | Hono | Helper de WebSocket nativo; portavel (Bun/Node/Workers) |
| Realtime | WebSocket nativo (sem Socket.IO) | Protocolo explicito e legivel em `packages/protocol`, sem lock-in |
| Frontend | React + Vite | SPA realtime; SSR nao agrega valor aqui |
| UI | Tailwind + shadcn/ui | Previsivel para revisores OSS; dark mode embutido |
| Monorepo | pnpm workspaces + Turborepo | Tipos compartilhados entre server/web/extensao |
| Linguagem | TypeScript end-to-end | Um unico contrato de tipos para todo o sistema |
| Demo | Railway | WebSocket nativo, sem sleep, botao "Deploy to Railway" no README |
| Self-host | docker-compose | Sem dependencias externas obrigatorias; Redis opcional |

## 5. Sincronizacao de playback (o coracao)

### 5.1 Estado da sala (servidor como fonte da verdade, sem timer)

```ts
interface RoomState {
  roomId: string
  mediaUrl: string
  mediaType: 'youtube' | 'mp4'
  playing: boolean
  positionSecs: number
  lastEventAt: number     // Date.now() do servidor
  playbackRate: number    // padrao 1.0
  hostId: string
}
```

O servidor nao "roda" o video. Cada cliente calcula a posicao atual:

```ts
const elapsed = (serverNow() - room.lastEventAt) / 1000
const currentPos = room.positionSecs + (room.playing ? elapsed * room.playbackRate : 0)
```

### 5.2 Calibracao de relogio (NTP-like, obrigatoria)

Na entrada, enviar ~8 pings e usar a amostra de menor RTT:

```
offset = ((t2 - t1) + (t3 - t4)) / 2
serverNow = () => Date.now() + offset
```

Recalibrar a cada 60s (3 amostras em manutencao).

### 5.3 Drift correction (loop de 1.5s enquanto playing)

- Desvio < 0.3s: ignorar (ruido)
- Desvio 0.3s-0.5s: para `<video>` HTML5, ajuste suave via `playbackRate` (ex: `1 + drift * 0.5`); para YouTube, ignorar (rate discreto: 0.25/0.5/0.75/1/1.25/1.5/2)
- Desvio > 0.5s: seek imediato em ambos os players

### 5.4 Comandos com execucao agendada

Comandos de `play` carregam `when = serverNow() + 300ms`; todos recebem antes de executar e disparam no mesmo instante, anulando o efeito do RTT.

### 5.5 Protocolo de mensagens

Cliente -> Servidor:
```jsonc
{ "type": "play",  "time": 42.5 }
{ "type": "pause", "time": 42.5 }
{ "type": "seek",  "time": 120.0 }
{ "type": "clock-ping", "t1": 1718700000123 }
{ "type": "buffering-start" }
{ "type": "buffering-end" }
{ "type": "chat", "text": "oi" }
{ "type": "reaction", "emoji": "😂" }
```

Servidor -> Clientes:
```jsonc
{ "type": "room-state", "playing": true, "positionSecs": 42.5,
  "lastEventAt": 1718700000000, "mediaUrl": "dQw4w9WgXcQ",
  "mediaType": "youtube", "hostId": "abc123" }
{ "type": "play",  "time": 42.5, "when": 1718700000800 }
{ "type": "pause", "time": 67.2, "serverTime": 1718700001000 }
{ "type": "seek",  "time": 120.0 }
{ "type": "clock-pong", "t1": 1718700000123, "t2": 1718700000145, "t3": 1718700000146 }
{ "type": "join",  "userId": "x", "displayName": "Nikolas", "avatar": "🐉" }
{ "type": "leave", "userId": "x" }
{ "type": "host-change", "hostId": "newHostId" }
{ "type": "chat", "userId": "x", "displayName": "Nikolas", "text": "oi", "ts": 1718700001000 }
{ "type": "reaction", "userId": "x", "emoji": "😂", "ts": 1718700001000 }
```

## 6. Salas, host e identidade

- `roomId` gerado com `nanoid` (~149 bits de entropia); nenhuma rota lista salas.
- Identidade anonima: nickname + avatar emoji, sem conta nem camera.
- Host-lock: quando ligado, so o host emite comandos de sync; o servidor rejeita comandos de nao-host.
- Transferencia de host: ao sair o host, o servidor promove o socket conectado mais antigo e emite `host-change`.

## 7. UI / Design

- Layout: player a esquerda (16:9 responsivo) e sidebar a direita (abas Presenca/Chat) que colapsa no mobile.
- Reacoes flutuantes: camada sobre o player; emojis sobem e desaparecem (compositor-friendly: `transform`/`opacity`).
- Tema claro/escuro via tokens do Tailwind/shadcn; respeitar `prefers-color-scheme` e permitir toggle.
- Estados de hover/focus/active desenhados; acessibilidade basica (navegacao por teclado, contraste, `prefers-reduced-motion` para as reacoes).

## 8. Deploy e self-host

- **Demo:** Railway (TLS automatico, WebSocket nativo, sem sleep). Botao "Deploy to Railway" no README.
- **Self-host:** `docker-compose up` sobe server + web. `REDIS_URL` opcional ativa pub/sub para escala horizontal (o servidor detecta a variavel e troca o broadcaster).
- HTTPS sempre em producao (requisito do embedding do YouTube). Em local, usar `localhost` (permitido pelo YouTube para dev).

## 9. Riscos e mitigacoes

| Risco | Mitigacao no MVP |
|---|---|
| Drift acumulado em sessoes longas | Recalibrar offset a cada 60s; seek imediato acima de 0.5s |
| YouTube com playbackRate discreto | Sem ajuste suave no YouTube; so seek; documentar no README |
| Embedding/CORS do YouTube | HTTPS em prod (Railway) e `localhost` em dev |
| ToS de plataformas com DRM | MVP so YouTube oficial + arquivo proprio; documentar que nao ha suporte a DRM |
| Escala de conexoes WS | Suficiente para a vitrine; `REDIS_URL` opcional para escalar |
| Estado perdido em restart | Salas efemeras por design (documentado); reconexao do cliente mostra "sala encerrada" se nao houver server |
| Link previsivel | `nanoid`; nenhuma listagem de salas |

## 10. Criterios de aceite (Fase 1)

- [ ] Criar sala, copiar link e abrir em segunda aba: ambas sincronizadas com < 1s de desvio
- [ ] Play/pause/seek de quem controla reflete nos demais
- [ ] Mensagem de chat aparece em tempo real para todos
- [ ] Reacao de emoji aparece flutuando para todos
- [ ] Quem entra no meio recebe a posicao correta via `room-state`
- [ ] Se o host fecha a aba, outro participante e promovido automaticamente
- [ ] Tema claro/escuro funciona e persiste
- [ ] `docker-compose up` sobe o app em maquina limpa com Docker
- [ ] Deploy no Railway funciona pelo botao do README

## 11. Fora do escopo desta fase (vai para a Fase 2)

- Extensao de navegador (reusa `packages/protocol` e `packages/ui`)
- Suporte a HLS/DASH e upload de arquivo
- GroupWait (pausa de grupo durante buffering de alguem)
- Persistencia de salas (Redis com TTL ou SQLite)
- Voz/video via WebRTC

## 12. Referencias

- howardchung/watchparty (MIT) - referencia de arquitetura de rooms e entry sync
- dyc3/opentogethertube (AGPL-3.0) - referencia de design de provedores de video (apenas leitura/inspiracao)
- Hono - helper de WebSocket e estrutura de handlers
- YouTube IFrame Player API - metodos, eventos e limitacao de playbackRate discreto
- Jellyfin SyncPlay - algoritmos de SpeedToSync/SkipToSync e GroupWait
- enmasseio/timesync (MIT) - calibracao NTP-like no browser
