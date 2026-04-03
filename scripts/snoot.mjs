/**
 * Snoot
 * @module Snoot
 * @author Tyler
 */

import { TEMPLATES } from './constants.mjs';
import { registerSettings } from './settings.mjs';

Hooks.once('init', () => {
  registerSettings();
  foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});
