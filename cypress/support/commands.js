// Snapshot helper: full-page screenshot under a stable name
Cypress.Commands.add('snap', (name) => {
  cy.screenshot(name, { overwrite: true, capture: 'viewport' });
});

// Waits for the player session to settle on a given screen id
Cypress.Commands.add('onScreen', (screenId) => {
  cy.get('#' + screenId, { timeout: 12000 }).should('have.class', 'active');
});
