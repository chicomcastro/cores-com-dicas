# Cores com Dicas

Jogo web multiplayer inspirado em **Hues and Cues**. Cada jogador usa o próprio
celular para jogar — o tabuleiro central (tablet/TV) é opcional e funciona como
espectador.

## Jogar Online

Acesse pelo celular ou computador:

**[cores-com-dicas-4oo37yjdva-rj.a.run.app/player](https://cores-com-dicas-4oo37yjdva-rj.a.run.app/player)**

Crie uma sala ou entre com o código de uma sala existente. Compartilhe o código com os outros jogadores.

Opcionalmente, abra o tabuleiro em uma TV ou tablet para acompanhar o jogo como espectador:

**[cores-com-dicas-4oo37yjdva-rj.a.run.app/board](https://cores-com-dicas-4oo37yjdva-rj.a.run.app/board)**

## Rodar local

Pré-requisito: Node.js 18+.

```bash
npm install
npm start
```

O servidor abre na porta `3000`. Conecte todos os dispositivos à mesma rede
(não precisa de internet).

- **Jogador (celular/desktop):** `http://<ip-local>:3000/player`
- **Tabuleiro / Espectador (opcional):** `http://<ip-local>:3000/board`

## Como jogar

1. Acesse `/player`, escolha seu nome e crie uma sala (com senha opcional) ou entre em uma existente.
2. Escolha o tamanho do grid (Fácil 15×9, Médio 20×12, Difícil 30×18) ao criar a sala.
3. Quando todos estiverem no lobby, qualquer jogador clica em **Iniciar Jogo**.
4. O jogo sorteia uma cor secreta para o jogador da vez. Ele dá uma dica de
   1 palavra (e depois uma de até 2 palavras), ou pode pular.
5. Todos os outros jogadores marcam simultaneamente no tabuleiro do próprio celular.
6. A cor correta é revelada com animação e os pontos são calculados:

| Zona | Pontos |
|------|--------|
| Acerto exato | 3 pts |
| Quadrado 3×3 ao redor | 2 pts |
| Quadrado 5×5 externo | 1 pt |
| Dica: por marcador no 3×3 | +1 pt (máx. 9) |

7. O jogo dura 2 rodadas (2–6 jogadores) ou 1 rodada (7+).

## Recursos

- **Player-first** — todo o jogo roda pelo celular, sem precisar de tela central
- **Tabuleiro espectador** — `/board` pode entrar em qualquer sala para exibir em TV
- Salas com código aleatório e senha opcional
- Marcação paralela — todos os jogadores marcam ao mesmo tempo
- Coordenadas no tabuleiro (A1, B2, ...) em todas as telas
- Reconexão automática (sala persistida em sessionStorage)
- QR Code e link para compartilhar sala
- Grid configurável em 3 tamanhos
- Layout responsivo para celular, tablet e desktop
- Animações, sons e vibrações
- Expiração automática de salas após 1 hora
- Persistência Firestore para sobreviver a restarts (cloud)

## Stack

- **Server:** Node.js + Express + Socket.IO
- **Front:** HTML / CSS / JS puros (sem framework, sem build)
- **Persistência:** Firestore (opcional, para cloud)
- **Deploy:** Cloud Run (serverless, com WebSocket)
- **QR Code:** `qrcode` (npm)
- **Estado:** 100% no servidor, validações server-side
- **Tema:** dark warm pastel com fonte Nunito
