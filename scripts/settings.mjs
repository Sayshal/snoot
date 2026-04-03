/**
 * Module settings registration.
 * @module Settings
 * @author Tyler
 */

import { SnootApp } from './apps/snoot-app.mjs';
import { MODULE, SETTINGS } from './constants.mjs';

/**
 * Register all module settings and the settings menu.
 */
export function registerSettings() {
  game.settings.registerMenu(MODULE.ID, 'snootApp', {
    name: 'SNOOT.Settings.Menu.Name',
    label: 'SNOOT.Settings.Menu.Label',
    hint: 'SNOOT.Settings.Menu.Hint',
    icon: 'fas fa-dog',
    type: SnootApp,
    restricted: true
  });

  game.settings.register(MODULE.ID, SETTINGS.SHOW_CORE_FLAGS, {
    name: 'SNOOT.Settings.ShowCoreFlags.Name',
    hint: 'SNOOT.Settings.ShowCoreFlags.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE.ID, SETTINGS.SHOW_SYSTEM_FLAGS, {
    name: 'SNOOT.Settings.ShowSystemFlags.Name',
    hint: 'SNOOT.Settings.ShowSystemFlags.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });
}
