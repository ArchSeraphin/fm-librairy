// Déclaration TypeScript minimale pour permettre l'import de la règle ESLint
// JS depuis les tests (TS strict refuse sinon les fichiers .js sans types).
import type { Rule } from 'eslint';

declare const rule: Rule.RuleModule;
export default rule;
