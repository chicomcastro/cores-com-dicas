/// <reference types="cypress" />

/**
 * Visual catalog: snapshots of all the standalone pre-game screens
 * plus the spectator /board on lobby state.
 */

describe('Catálogo de evidências visuais', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.window().then((w) => { try { w.sessionStorage.clear(); } catch (e) {} });
  });

  it('player login → home → criar sala → entrar em sala', () => {
    cy.visit('/player');
    cy.onScreen('login');
    cy.snap('player-login');
    cy.get('#join-name-input').type('Tester');
    cy.get('#join-btn').click();
    cy.onScreen('home');
    cy.snap('player-home');
    cy.get('#home-create-btn').click();
    cy.onScreen('create-room');
    cy.snap('player-create-room');
    cy.get('#create-back-btn').click();
    cy.onScreen('home');
    cy.get('#home-join-btn').click();
    cy.onScreen('join-room');
    cy.snap('player-join-room');
  });

  it('board (espectador) entry screen', () => {
    cy.visit('/board');
    cy.contains('Espectador').should('be.visible');
    cy.snap('board-entry');
  });

  it('lobby do player com share button e QR code', () => {
    cy.visit('/player');
    cy.get('#join-name-input').type('Tester');
    cy.get('#join-btn').click();
    cy.onScreen('home');
    cy.get('#home-create-btn').click();
    cy.get('#create-room-btn').click();
    cy.onScreen('waiting');
    cy.snap('player-lobby-collapsed');
    cy.get('#lobby-qr-toggle').click();
    cy.get('#lobby-qr-wrap').should('not.have.class', 'hidden');
    cy.get('#lobby-qr-img').should('have.attr', 'src').and('include', 'data:image/png');
    cy.snap('player-lobby-with-qr');
  });
});
