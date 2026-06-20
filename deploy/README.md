# Deploy do Servidor de Sincronizacao OpenParty

Hospedagem: VPS Hostinger (76.13.164.69, Ubuntu 24.04 com Docker e Traefik)
Dominio: `openparty.dehor.com.br`
Arquivo de producao: `deploy/docker-compose.prod.yml`

---

## Arquitetura

```
Internet
  |
  v
Traefik :443 (TLS Let's Encrypt, HTTP-01 challenge)
  |
  v (rede Docker traefik_default)
openparty-server :3000 (Bun + Hono + WebSocket)
  - POST /rooms      -> cria sala de sincronizacao
  - GET  /health     -> healthcheck (retorna {"status":"ok"})
  - WS   /ws/:roomId -> canal WebSocket de sincronizacao
  - GET  /*          -> web estatico (build Vite embutido via Dockerfile.allinone)
```

O Traefik ja estava instalado na VPS (template Hostinger). O OpenParty nao sobe
um reverse proxy proprio: usa as labels Docker para se registrar automaticamente.

WebSocket funciona via WSS (wss://openparty.dehor.com.br/ws/:roomId) porque o
Traefik transparentemente faz upgrade da conexao HTTP/HTTPS para WS/WSS.

DNS: A record `openparty.dehor.com.br -> 76.13.164.69` no Cloudflare (NAO proxied -
obrigatorio para WebSocket de longa duracao; CF proxied encerra conexoes WS em ~100s).

---

## Pre-requisitos na VPS

- Docker e Docker Compose instalados (ja disponivel no template Hostinger)
- Traefik rodando e conectado a rede `traefik_default` (ja em `/docker/traefik/`)
- Portas 80 e 443 abertas no firewall do sistema (o Traefik as utiliza)
- DNS `openparty.dehor.com.br` apontando para o IP da VPS (sem proxy Cloudflare)

Verificar:

```bash
docker network ls | grep traefik
docker ps | grep traefik
```

---

## Primeiro deploy (setup inicial)

```bash
# 1. Clonar ou atualizar o codigo na VPS
ssh root@76.13.164.69
mkdir -p /docker/openparty
cd /docker/openparty
git clone https://github.com/DeHor-Labs/openparty.git src
# ou: cd src && git pull

# 2. Copiar o docker-compose de producao para a raiz de deploy
cp src/deploy/docker-compose.prod.yml /docker/openparty/docker-compose.yml

# 3. (Opcional) Criar .env se quiser sobrescrever os defaults
cat > /docker/openparty/.env << 'EOF'
ALLOWED_ORIGIN=https://openparty.dehor.com.br
REDIS_URL=
EOF

# 4. Build e subida do container
cd /docker/openparty
docker compose up -d --build

# 5. Verificar saude
docker ps | grep openparty
curl -s http://localhost:32835/health   # porta efemera alocada pelo Docker
curl -s https://openparty.dehor.com.br/health   # via Traefik/TLS
```

---

## Atualizar codigo em producao

```bash
ssh root@76.13.164.69
cd /docker/openparty/src
git pull
cd /docker/openparty
docker compose up -d --build --no-deps server
```

O `--no-deps` garante que apenas o container `server` seja recriado.
O `--build` forca o rebuild da imagem com o codigo novo.
O container antigo continua aceitando conexoes WS ate o novo estar healthy
(o Docker finaliza o antigo so quando o novo passa o healthcheck).

---

## Verificacao pos-deploy

```bash
# Saude via HTTP interno
curl -s http://localhost:$(docker port openparty-server 3000 | cut -d: -f2)/health

# Saude via HTTPS publico (confirma TLS e roteamento Traefik)
curl -s https://openparty.dehor.com.br/health

# Certificado TLS
curl -vI https://openparty.dehor.com.br/health 2>&1 | grep -E "SSL|issuer|expire"

# Teste de WebSocket (requer websocat ou wscat)
# wscat -c wss://openparty.dehor.com.br/ws/test-room
```

---

## Observacoes de seguranca

- NAO usar `ports:` no compose de producao. O Traefik acessa o container
  via rede Docker interna; expor a porta ao host aumenta superficie de ataque.
- `ALLOWED_ORIGIN` restringe o CORS. Em producao, definir o dominio exato.
- NAO ativar o proxy Cloudflare (laranja) para este subdominio: o Cloudflare
  encerra conexoes WebSocket em ~100 segundos de inatividade, o que causa
  desconexoes nas salas de sincronizacao.
- O container usa restart: unless-stopped. Para manutencao planejada,
  executar `docker stop openparty-server` manualmente antes de editar configs.

---

## Estrutura de arquivos na VPS

```
/docker/openparty/
  docker-compose.yml       <- copia de deploy/docker-compose.prod.yml
  .env                     <- variaveis de ambiente (opcional, ALLOWED_ORIGIN etc)
  src/                     <- clone do repositorio GitHub
    apps/server/
    apps/web/
    packages/protocol/
    deploy/
      docker-compose.prod.yml   <- fonte de verdade da config de producao
      README.md                 <- este arquivo
```
