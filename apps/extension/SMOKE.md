# OpenParty Extension - Roteiro de Smoke Manual (Sprint 2)

Este roteiro cobre o fluxo básico de sincronização de YouTube via extensão.
Não há automação E2E possível sem carregar a extensão no Chrome e ter YouTube logado.

## Pré-requisitos

- Chrome 116+
- Servidor `apps/server` rodando localmente (ou URL de staging configurada)
- Duas janelas/perfis do Chrome (simular dois usuários)

## Passo 1 - Build e carregamento

```bash
cd apps/extension
pnpm build
```

1. Abrir `chrome://extensions`
2. Ativar "Modo do desenvolvedor" (canto superior direito)
3. Clicar em "Carregar sem compactação"
4. Selecionar a pasta `apps/extension/dist/`
5. Confirmar que "OpenParty" aparece na lista com status ativo
6. Repetir nos dois perfis/janelas do Chrome

## Passo 2 - Configurar servidor

1. Clicar no ícone da extensão > botão "..." > "Opções"
2. Preencher "URL do servidor WebSocket" com `ws://localhost:3000/ws` (ou URL do servidor)
3. Preencher "Nome de exibição" (ex: "Alice" e "Bob" nos dois perfis)
4. Clicar em "Salvar configurações"
5. Verificar mensagem "Configurações salvas"

> Nota: a URL de produção deve usar `wss://` (TLS obrigatório). O prefixo `ws://`
> só é aceito para localhost e 127.0.0.1.

## Passo 3 - Criar sala (Perfil A - Alice)

1. Abrir `https://www.youtube.com/watch?v=<qualquer-video>`
2. Aguardar o vídeo carregar (player deve estar visível)
3. Clicar no ícone do OpenParty na barra de ferramentas
4. Clicar em "Criar nova sala"
5. Verificar que a tela muda para "Sala ativa" com:
   - Status: "Conectado" (ícone verde)
   - "1 participante"
   - Link de convite preenchido
6. Clicar em "Copiar" e verificar que o link é copiado

## Passo 4 - Entrar na sala (Perfil B - Bob)

1. Abrir o MESMO vídeo do YouTube no Perfil B
2. Clicar no ícone do OpenParty
3. Colar o link copiado no campo "Entrar com link ou código"
4. Clicar em "Entrar"
5. Verificar que a tela muda para "Sala ativa" com "2 participantes"
6. No Perfil A, verificar que a contagem também atualizou para "2 participantes"

## Passo 5 - Verificar sync de play/pause

1. No Perfil A (Alice/host), dar play no vídeo
2. Verificar que o vídeo no Perfil B (Bob) também inicia automaticamente
3. No Perfil A, dar pause
4. Verificar que o vídeo no Perfil B também pausa
5. Verificar que a diferença de posição entre os dois vídeos é menor que 1 segundo

## Passo 6 - Verificar sync de seek

1. No Perfil A, arrastar o scrubber para um ponto diferente do vídeo (ex: ir para 2:30)
2. Verificar que o vídeo no Perfil B salta para a mesma posição (tolerância: 1s)
3. Repetir no sentido inverso (B -> A, se não houver host-lock)

## Passo 7 - Verificar comportamento durante anúncio

1. Iniciar um vídeo que exiba anúncio pre-roll no Perfil A
2. Verificar que o Perfil B não é afetado pelo andamento do anúncio
3. Após o anúncio terminar, verificar que o sync é retomado automaticamente

## Passo 8 - Verificar sincronização após navegação SPA

1. No Perfil A, clicar em outro vídeo recomendado (sem recarregar a página)
2. Verificar que o adapter re-liga automaticamente ao novo vídeo
3. Repetir teste de play/pause do Passo 5 no novo vídeo

## Passo 9 - Sair da sala

1. No Perfil B, clicar em "Sair da sala"
2. Verificar que a tela volta para "Criar sala / Entrar"
3. No Perfil A, verificar que a contagem cai para "1 participante"
4. Continuar assistindo no Perfil A sem interferência

## Resultados esperados

| Ação | Resultado esperado |
|---|---|
| Criar sala | Link de convite gerado, status verde |
| Entrar na sala | Contador de participantes atualiza nos dois lados |
| Play (host) | Vídeo inicia em todos os clientes em < 500ms |
| Pause (host) | Vídeo pausa em todos os clientes em < 500ms |
| Seek (host) | Todos os clientes saltam para a mesma posição |
| Anúncio | Sync suspenso durante o anúncio, retomado após |
| Navegação SPA | Adapter re-liga ao novo vídeo sem recarregar a extensão |
| Sair | Cliente removido da sala sem impactar os demais |

## Limitações conhecidas (Sprint 2)

- O overlay de chat e reações não está implementado (Sprint 3)
- A sincronização durante anúncio é suspensa, mas usuários com anúncios diferentes
  ficam dessincronizados até o próximo seek manual
- Apenas YouTube é suportado nesta sprint; Netflix e demais serviços chegam na Sprint 3
- A calibração de clock assume latência simétrica (NTP-like); links assimétricos
  podem ter offset residual de alguns milissegundos
