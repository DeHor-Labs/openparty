# OpenParty - Agent Guidance

## When to use / Quando usar

- Criar e sincronizar salas de watch party para YouTube e arquivos MP4 acessíveis via web.
- Assistir vídeos em conjunto com baixa latência e controle de reprodução compartilhado.

## When not to use / Quando não usar

- Não usar para streaming de arquivos locais sem URL pública ou vídeos protegidos por DRM comercial.
- Não usar como armazenamento permanente de mensagens ou banco de dados relacional.

## Authentication and access / Autenticação e acesso

- Acesso público e anônimo, sem autenticação, sem chaves e sem cadastro de usuário.
- Destructive actions: Nenhuma ação destrutiva em recursos compartilhados. As salas expiram ao fechar.

## Operational limits and fallbacks / Limites operacionais e fallbacks

- Limite de taxa por conexão para eventos de WebSocket.
- Fallback automático para re-sincronização do player em caso de perda temporária de pacotes.
