---
title: OpenParty
description: Aplicação para criar salas temporárias e assistir a vídeos do YouTube ou MP4 em sincronia por WebSocket, com chat e reações em tempo real.
canonical: https://openparty.dehor.com.br/
last-updated: 2026-09-04
lang: pt-BR
---

# OpenParty

> Aplicação para criar salas temporárias e assistir a vídeos em sincronia por WebSocket.

Crie uma sala para assistir a vídeos do YouTube ou de arquivos MP4 junto com outras pessoas, tudo
sincronizado, com chat, reações e sem precisar instalar plugin nem criar conta. Basta colar a URL
do vídeo, escolher um nickname e compartilhar o link da sala.

## Como funciona

1. Uma pessoa informa a URL de um vídeo e cria a sala.
2. O servidor mantém o estado de reprodução e distribui eventos por WebSocket.
3. Participantes entram com nickname e avatar, conversam e recebem os mesmos eventos de play, pause e seek.

## Quando usar

- Assistir a um vídeo do YouTube ou MP4 junto com outra pessoa, com sincronia de play/pause/seek.
- Fazer uma sala rápida, sem cadastro, apenas com nickname e avatar.
- Conversar por chat e reagir com emoji durante a exibição.

Não é indicado para hospedar vídeos, contornar DRM ou guardar histórico de sala: nada disso é feito
pelo OpenParty, que só sincroniza a reprodução de uma URL já pública informada pela própria pessoa.

## Evidência técnica

O projeto possui testes para criação e ciclo de vida de salas, relógio, sincronização, WebSocket,
chat, reações e troca de host. Isso demonstra o comportamento do software em ambiente controlado,
não a disponibilidade do serviço público em todo momento.

## Dados e limites

- Nickname e avatar ficam na sessão do navegador.
- A URL do vídeo, o estado da sala, chat e reações vivem na memória do servidor.
- A sala é removida quando a última pessoa sai.
- Serviços com DRM dependem da extensão e de um adaptador compatível.

## Páginas

- [Sobre](https://openparty.dehor.com.br/sobre)
- [Contato](https://openparty.dehor.com.br/contato)
- [Privacidade](https://openparty.dehor.com.br/privacidade.html)
- [Guia para agentes (llms.txt)](https://openparty.dehor.com.br/llms.txt)
- [Sitemap](https://openparty.dehor.com.br/sitemap.xml)
