import { configureValidationForBrowser } from '@sats-wars/shared';

// Runs once in every page bundle (imported by the root I18nProvider): no eval
// probe under the production CSP.
configureValidationForBrowser();
