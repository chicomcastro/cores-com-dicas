# Cores com Dicas

Jogo web multiplayer inspirado em **Hues and Cues**. Um tablet funciona
como tabuleiro central e cada jogador usa o próprio dispositivo para ver sua cor
secreta e enviar dicas.

## Jogar Online

Acesse o tabuleiro em qualquer navegador:

**[cores-com-dicas-4oo37yjdva-rj.a.run.app/board](https://cores-com-dicas-4oo37yjdva-rj.a.run.app/board)**

Um código de sala será gerado. Compartilhe com os jogadores para que entrem pelo link ou QR Code.

## Rodar local

Pré-requisito: Node.js 18+.

```bash
npm install
npm start
```

O servidor abre na porta `3000`. Conecte todos os dispositivos à mesma rede
(não precisa de internet).

- **Tabuleiro (tablet/desktop):** `http://<ip-local>:3000`
- **Jogador (celular/qualquer dispositivo):** escaneie o QR Code exibido no tabuleiro ou abra `http://<ip-local>:3000/player`

## Como jogar

1. Os jogadores abrem o link ou escaneiam o QR Code, digitam o código da sala e seus nomes (2 a 10).
2. No tabuleiro, escolha o tamanho do grid (Fácil 15×9, Médio 20×12, Difícil 30×18) e clique em **Iniciar Jogo**.
3. O jogo sorteia uma cor secreta para o jogador da vez. Ele dá uma dica de
   1 palavra (e depois uma de até 2 palavras).
4. Os outros jogadores vão até o tabuleiro e tocam na cor que acham ser a secreta.
5. A cor correta é revelada e os pontos são calculados:

| Zona | Pontos |
|------|--------|
| Acerto exato | 3 pts |
| Quadrado 3×3 ao redor | 2 pts |
| Quadrado 5×5 externo | 1 pt |
| Dica: por marcador no 3×3 | +1 pt (máx. 9) |

6. O jogo dura 2 rodadas (2–6 jogadores) ou 1 rodada (7+).

## Stack

- **Server:** Node.js + Express + Socket.IO
- **Front:** HTML / CSS / JS puros (sem framework, sem build)
- **Persistência:** Firestore (opcional, para cloud)
- **Deploy:** Cloud Run (serverless, com WebSocket)
- **QR Code:** `qrcode` (npm)
- **Estado:** 100% no servidor, validações server-side
- **Tema:** dark warm pastel com fonte Nunito

## Recursos

- Salas com código aleatório — isolamento de partidas
- Lobby com auto-registro — jogadores entram pelo próprio dispositivo
- QR Code gerado automaticamente
- Grid configurável em 3 tamanhos
- Layout responsivo para tablet (portrait e landscape) e celular
- Animações, sons e vibrações
- Reconexão automática e proteção contra multi-tab
- Persistência Firestore para sobreviver a restarts (cloud)
