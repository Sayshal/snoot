/**
 * Snoot
 * @module Snoot
 * @author Tyler
 */

import { TEMPLATES } from './constants.mjs';
import { registerSettings } from './settings.mjs';

Hooks.once('init', () => {
  ATLAS.register('snoot', { title: 'Snoot', github: 'Sayshal/snoot', theme: { scope: '.snoot' } });
  registerSettings();
  foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});
