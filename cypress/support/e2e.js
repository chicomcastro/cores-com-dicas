// Global Cypress setup.
import './commands';

// Avoid uncaught exceptions in the app failing tests for noisy console errors
Cypress.on('uncaught:exception', () => false);

afterEach(() => {
  cy.task('stopAllDrivers', null, { log: false });
});
