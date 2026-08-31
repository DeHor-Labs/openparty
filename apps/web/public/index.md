# OpenParty

> Sala temporária para assistir a vídeos em sincronia com outras pessoas, com chat, reações e controle de reprodução em tempo real.

Site: https://openparty.dehor.com.br/

## Como funciona

1. Uma pessoa informa a URL de um vídeo e cria a sala.
2. O servidor mantém o estado de reprodução e distribui eventos por WebSocket.
3. Participantes entram com nickname e avatar, conversam e recebem os mesmos eventos de play, pause e seek.

## Evidência técnica

O projeto possui testes para criação e ciclo de vida de salas, relógio, sincronização, WebSocket, chat, reações e troca de host. Isso demonstra o comportamento do software em ambiente controlado, não a disponibilidade do serviço público em todo momento.

## Dados e limites

- Nickname e avatar ficam na sessão do navegador.
- A URL do vídeo, o estado da sala, chat e reações vivem na memória do servidor.
- A sala é removida quando a última pessoa sai.
- Serviços com DRM dependem da extensão e de um adaptador compatível.

Leia o [Aviso de Privacidade](https://openparty.dehor.com.br/privacidade.html) para entender provedores, registros técnicos e exercício de direitos.
