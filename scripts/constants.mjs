/**
 * Shared constants and template paths.
 * @module Constants
 * @author Tyler
 */

export const MODULE = { ID: 'snoot' };

export const SETTINGS = { SHOW_CORE_FLAGS: 'showCoreFlags', SHOW_SYSTEM_FLAGS: 'showSystemFlags' };

export const TEMPLATES = {
  OVERVIEW: `modules/${MODULE.ID}/templates/tabs/overview.hbs`,
  SETTINGS: `modules/${MODULE.ID}/templates/tabs/settings-tab.hbs`,
  FLAGS_WORLD: `modules/${MODULE.ID}/templates/tabs/flags-world-tab.hbs`,
  FLAGS_COMPENDIUMS: `modules/${MODULE.ID}/templates/tabs/flags-compendiums-tab.hbs`,
  FOOTER: `modules/${MODULE.ID}/templates/footer.hbs`
};
