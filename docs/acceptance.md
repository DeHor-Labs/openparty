# Roteiro de Aceite - OpenParty Fase 1

Executar com o app rodando via `docker-compose up --build`.
Usar `agent-browser` como ferramenta padrao para automacao visual.

Pre-requisito:

```bash
docker-compose up --build -d
agent-browser open http://localhost:5173
agent-browser set viewport 1440 900
```

---

## Verificacao 1 - Criacao de sala e desvio de sync < 1s

```bash
# Aba A: criar sala
agent-browser open http://localhost:5173
agent-browser find "input[placeholder*='youtube']" --fill "https://youtu.be/dQw4w9WgXcQ"
agent-browser find "input[placeholder*='ickname']" --fill "NikolasA"
agent-browser find "button[type='submit']" --click
agent-browser get url
# Copiar URL retornada (ex: http://localhost:5173/room/abc123)

# Aba B: entrar na mesma sala
agent-browser tabs create http://localhost:5173/room/abc123
agent-browser find "input[placeholder*='ickname']" --fill "NikolasB"
agent-browser find "button[type='submit']" --click

# Medir desvio: capturar currentTime das duas abas
agent-browser tabs select 1
agent-browser evaluate "document.querySelector('video')?.currentTime ?? window.__op_currentTime ?? 'N/A'"
agent-browser tabs select 2
agent-browser evaluate "document.querySelector('video')?.currentTime ?? window.__op_currentTime ?? 'N/A'"
```

Criterio: diferenca entre os dois valores < 1 segundo.

---

## Verificacao 2 - Play propaga em < 1s

```bash
# Na Aba A (host), clicar play
agent-browser tabs select 1
agent-browser find "button[aria-label='play']" --click
agent-browser screenshot /tmp/openparty-v2-before.png

# Aguardar propagacao e verificar na Aba B
agent-browser tabs select 2
agent-browser screenshot /tmp/openparty-v2-after.png
agent-browser evaluate "document.querySelector('video')?.paused === false"
```

Criterio: retorno `true` na Aba B em ate 1s apos o click.

---

## Verificacao 3 - Pause e seek propagam

```bash
# Aba A: pause
agent-browser tabs select 1
agent-browser find "button[aria-label='pause']" --click

# Verificar pause na Aba B
agent-browser tabs select 2
agent-browser evaluate "document.querySelector('video')?.paused === true"

# Aba A: seek para 30s via slider
agent-browser tabs select 1
agent-browser evaluate "document.querySelector('input[aria-label=\"seek\"]').value = 30; document.querySelector('input[aria-label=\"seek\"]').dispatchEvent(new Event('change', {bubbles:true}))"

# Verificar posicao na Aba B (tolerancia 2s)
agent-browser tabs select 2
agent-browser evaluate "Math.abs((document.querySelector('video')?.currentTime ?? 0) - 30) < 2"
```

Criterio: pause `true` e seek com diferenca < 2s.

---

## Verificacao 4 - Chat aparece em < 500ms

```bash
agent-browser tabs select 1
# Abrir aba chat na sidebar
agent-browser find "button[aria-label='Chat']" --click
agent-browser find "input[placeholder*='ensagem']" --fill "Oi, funciona?"
agent-browser find "form" --submit

agent-browser tabs select 2
agent-browser find "button[aria-label='Chat']" --click
agent-browser screenshot /tmp/openparty-v4-chat.png
agent-browser find "li" --contains "Oi, funciona?"
```

Criterio: elemento com texto "Oi, funciona?" visivel na Aba B.

---

## Verificacao 5 - Reacao emoji anima nas duas abas

```bash
agent-browser tabs select 1
agent-browser find "button[aria-label='❤️']" --click
agent-browser screenshot /tmp/openparty-v5-tab1.png

agent-browser tabs select 2
agent-browser screenshot /tmp/openparty-v5-tab2.png
agent-browser evaluate "document.querySelectorAll('.animate-float-up').length > 0 || document.querySelector('[data-emoji]') !== null"
```

Criterio: screenshot mostra emoji na Aba 2 OU evaluate retorna `true`.

---

## Verificacao 6 - Entrada no meio recebe posicao correta

```bash
# Aba A: pausar em 60s
agent-browser tabs select 1
agent-browser evaluate "document.querySelector('input[aria-label=\"seek\"]').value = 60; document.querySelector('input[aria-label=\"seek\"]').dispatchEvent(new Event('change', {bubbles:true}))"
agent-browser find "button[aria-label='pause']" --click

# Aba C: entrar na sala
ROOM_URL=$(agent-browser evaluate "location.href")
agent-browser tabs create "$ROOM_URL"
agent-browser find "input[placeholder*='ickname']" --fill "NikolasC"
agent-browser find "button[type='submit']" --click

# Verificar que recebeu room-state com posicao ~60s
agent-browser evaluate "Math.abs((document.querySelector('video')?.currentTime ?? 0) - 60) < 3"
```

Criterio: posicao inicial da Aba C dentro de 3s de 60s.

---

## Verificacao 7 - Host transfer ao fechar aba do host

```bash
# Fechar Aba A (host original)
agent-browser tabs select 1
agent-browser tabs close

# Verificar sidebar da Aba B mostra novo host
agent-browser tabs select 2
agent-browser screenshot /tmp/openparty-v7-hostchange.png
agent-browser evaluate "document.body.innerText.includes('NikolasB') || document.body.innerText.includes('host')"
```

Criterio: sidebar mostra "NikolasB" como host OU indicador de host atualizado.

---

## Verificacao 8 - Persistencia de tema dark/light

```bash
# Aba B: alternar para dark
agent-browser tabs select 2
agent-browser evaluate "document.documentElement.classList.contains('dark')"
# Se false, acionar toggle de tema (botao ou atalho)
agent-browser find "[aria-label*='tema'],[aria-label*='theme'],[aria-label*='dark']" --click
agent-browser evaluate "document.documentElement.classList.contains('dark')"

# Recarregar e verificar persistencia
agent-browser evaluate "location.reload()"
agent-browser evaluate "document.documentElement.classList.contains('dark')"
```

Criterio: `true` antes e depois do reload.

---

## Verificacao 9 - Build limpo via docker-compose

```bash
# Em diretorio limpo (sem node_modules, sem dist)
cd /tmp
git clone https://github.com/nikolasdehor/openparty openparty-clean
cd openparty-clean
docker-compose up --build -d

# Aguardar health check do servidor
until curl -sf http://localhost:3000/health; do sleep 2; done

# Repetir verificacao 1 de forma simplificada
agent-browser open http://localhost:5173
agent-browser screenshot /tmp/openparty-v9-home.png
agent-browser find "input[placeholder*='youtube']" --fill "https://youtu.be/dQw4w9WgXcQ"
agent-browser find "input[placeholder*='ickname']" --fill "Teste"
agent-browser find "button[type='submit']" --click
agent-browser screenshot /tmp/openparty-v9-room.png
agent-browser evaluate "location.pathname.startsWith('/room/')"
```

Criterio: URL muda para `/room/<id>` e screenshot mostra o player carregado.

---

## Resultado final

Todas as 9 verificacoes devem passar com os criterios acima para a Fase 1 ser considerada concluida.

Screenshots geradas em `/tmp/openparty-v*.png` para evidencia de aceite.
