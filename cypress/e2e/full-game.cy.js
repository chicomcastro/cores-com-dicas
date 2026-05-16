/// <reference types="cypress" />

/**
 * Drives a full game from Alice's UI perspective. Bob and Carol are headless
 * socket drivers spawned via cy.task — they auto-play whatever role the game
 * assigns them. Alice plays through Cypress: enters home, creates a room,
 * starts the game, and proceeds through every phase until the game ends.
 *
 * Captures a screenshot at each meaningful state.
 */

describe('Cores com Dicas — fluxo completo', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.window().then((w) => { try { w.sessionStorage.clear(); } catch (e) {} });
  });

  it('home → criar sala → lobby → jogo → fim', () => {
    cy.visit('/player');

    cy.onScreen('login');
    cy.snap('01-login');
    cy.get('#join-name-input').type('Alice');
    cy.get('#join-btn').click();

    cy.onScreen('home');
    cy.contains('Olá, Alice!').should('be.visible');
    cy.snap('02-home');

    cy.get('#home-create-btn').click();
    cy.onScreen('create-room');
    cy.snap('03-create-room');
    cy.get('#create-room-btn').click();

    cy.onScreen('waiting');
    cy.get('#lobby-room-code').should('not.contain', '—').and('not.be.empty');
    cy.snap('04-lobby-solo');

    cy.get('#lobby-room-code').invoke('text').then((code) => {
      cy.task('startDriver', { code, name: 'Bob' });
      cy.task('startDriver', { code, name: 'Carol' });
      cy.contains('.lobby-player-item', 'Bob');
      cy.contains('.lobby-player-item', 'Carol');
      cy.snap('05-lobby-three');

      cy.get('#lobby-start-btn').should('not.be.disabled').click();
      cy.get('#game-layout', { timeout: 8000 }).should('not.have.class', 'hidden');

      // Drive Alice through every remaining phase until the game ends.
      // The function decides what to do based on which screen is active.
      const MAX_STEPS = 80;
      const screenshots = new Set();

      const step = (i) => {
        if (i > MAX_STEPS) throw new Error('Exceeded max steps before reaching #end');
        cy.get('body', { timeout: 20000 }).then(($b) => {
          if ($b.find('#end.active').length > 0) {
            cy.snap('09-end');
            return;
          }
          if ($b.find('#secret.active').length > 0) {
            if (!screenshots.has('secret')) { screenshots.add('secret'); cy.snap('06-secret'); }
            cy.get('#secret #clue-input').then(($inp) => {
              if ($inp.length) {
                cy.wrap($inp).clear({ force: true }).type('manso');
                cy.get('#secret #clue-send').click({ force: true });
              }
            });
          } else if ($b.find('#place-marker.active').length > 0) {
            if (!screenshots.has('place-marker')) { screenshots.add('place-marker'); cy.snap('07-place-marker'); }
            const cells = $b.find('#game-board-host .bv-cell');
            const target = Math.min(40, Math.max(0, cells.length - 1));
            cy.get('#game-board-host .bv-cell').eq(target).click({ force: true });
            cy.get('#pm-confirm').then(($btn) => {
              if ($btn.length && !$btn.is(':disabled')) cy.wrap($btn).click({ force: true });
            });
          } else if ($b.find('#reveal.active').length > 0) {
            if (!screenshots.has('reveal')) { screenshots.add('reveal'); cy.snap('08-reveal'); }
            cy.get('#reveal #next-round-btn').then(($btn) => {
              if ($btn.length && !$btn.hasClass('hidden') && !$btn.is(':disabled')) {
                cy.wrap($btn).click({ force: true });
              }
            });
          }
          // wait-turn / other: drivers progress the state, just wait
          cy.wait(500);
          step(i + 1);
        });
      };
      step(0);
    });
  });
});
