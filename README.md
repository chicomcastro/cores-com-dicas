# Cores com Dicas

Jogo web multiplayer local inspirado em **Hues and Cues**, com arquitetura
mestre/cliente: um tablet funciona como tabuleiro central e cada jogador usa o
celular para ver sua cor secreta e enviar palpites.

## Como rodar

Pré-requisito: Node.js 18+.

```bash
npm install
npm start
```

O servidor abre na porta `3000`. Conecte todos os dispositivos à mesma rede
Wi-Fi (não precisa de internet).

- **Tablet (tabuleiro):** `http://<ip-local>:3000/board`
- **Celular (jogador):** `http://<ip-local>:3000/player`

A tela do tablet exibe um QR Code apontando para a URL dos jogadores.

## Como jogar

1. No tablet, adicione os nomes dos jogadores (3 a 10) e clique em
   **Iniciar Jogo**.
2. Cada celular acessa `/player`, vê a lista de nomes e seleciona o seu.
3. O jogo sorteia uma cor secreta para o jogador da vez. Ele dá uma dica de
   1 palavra (e depois uma de até 2 palavras).
4. Os outros jogadores tocam no tablet para colocar marcadores na cor que
   acham ser a secreta.
5. A revelação anima a cor correta no grid e calcula os pontos:
   - Acerto exato: 3 pts
   - Quadrado 3×3 ao redor: 2 pts
   - Quadrado 5×5 externo: 1 pt
   - Dica: +1 por marcador dentro do 3×3 (máx. 9)
6. O jogo dura 2 rodadas (4–6 jogadores) ou 1 rodada (7+).

## Stack

- Node.js + Express + Socket.IO
- HTML/CSS/JS puros no front (sem framework)
- `qrcode` para gerar o QR Code
- Estado em memória, totalmente no servidor
