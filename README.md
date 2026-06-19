# OpenParty

Assista vídeos juntos, sincronizados, sem plugins. YouTube e MP4 direto no navegador.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/openparty)

---

## Início rápido

### Docker Compose (recomendado)

```bash
git clone https://github.com/nikolasdehor/openparty
cd openparty
docker-compose up --build
```

- Frontend: http://localhost:5173
- API/WS: http://localhost:3000

Cole a URL de um vídeo do YouTube ou de um arquivo MP4, escolha seu nickname e compartilhe o link da sala.

### Desenvolvimento local

```bash
pnpm install
pnpm turbo run dev
```

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `REDIS_URL` | _(vazio)_ | URL Redis opcional. Sem Redis, o broadcaster roda em memória (somente 1 instância). Com Redis, escala horizontalmente. |
| `VITE_SERVER_URL` | `http://localhost:3000` | URL do servidor vista pelo frontend |

---

## Protocolo WebSocket

A sala é acessada via WebSocket em `ws://<host>/ws/:roomId`.

O cliente envia um handshake de identidade no primeiro frame (JSON):

```json
{ "displayName": "Nikolas", "avatar": "🦊" }
```

O servidor responde com `room-state` completo e passa a retransmitir eventos.

### Eventos: Cliente -> Servidor

| Tipo | Campos extras | Descrição |
|------|---------------|-----------|
| `play` | `time: number` | Solicita play na posição `time` (segundos) |
| `pause` | `time: number` | Solicita pause na posição `time` |
| `seek` | `time: number` | Solicita salto para `time` |
| `clock-ping` | `t1: number` | Ping NTP-like para calibração de relógio |
| `buffering-start` | - | Informa que o cliente está bufferizando |
| `buffering-end` | - | Informa que o buffer foi preenchido |
| `chat` | `text: string` | Envia mensagem de chat |
| `reaction` | `emoji: string` | Envia reação emoji |

### Eventos: Servidor -> Clientes

| Tipo | Campos extras | Descrição |
|------|---------------|-----------|
| `room-state` | _(vide RoomState + peers)_ | Estado completo enviado ao entrar na sala |
| `play` | `time, when` | Play agendado para `when` (Date.now() + 300ms) |
| `pause` | `time, serverTime` | Pause imediato |
| `seek` | `time` | Seek imediato |
| `clock-pong` | `t1, t2, t3` | Resposta ao ping para cálculo de offset |
| `join` | `userId, displayName, avatar` | Novo participante entrou |
| `leave` | `userId` | Participante saiu |
| `host-change` | `hostId` | Novo host eleito |
| `chat` | `userId, displayName, text, ts` | Mensagem de chat retransmitida |
| `reaction` | `userId, emoji, ts` | Reação retransmitida |

### Nota sobre playbackRate no YouTube

A API do YouTube IFrame aceita apenas valores discretos de velocidade: `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2`. Ao acionar o ajuste fino de rate (modo drift 0.3-0.5s), o valor é arredondado para o mais próximo disponível, o que limita a precisão do sync suave para YouTube. Para MP4 via HTML5, qualquer valor decimal é aceito.

---

## Licença

MIT - Nikolas de Hor
