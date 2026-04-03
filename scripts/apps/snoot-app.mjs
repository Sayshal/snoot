/**
 * Main Snoot application window.
 * @module Applications/SnootApp
 * @author Tyler
 */

import { TEMPLATES } from '../constants.mjs';
import { DataSniffer } from '../sniffer.mjs';

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** @type {Object<string, string>} Map module status to Foundry badge CSS class. */
const BADGE_CLASS = { system: 'neutral', active: 'success', inactive: 'warning', orphaned: 'error' };

/** Application for inspecting and cleaning module data. */
export class SnootApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * Cached scan report.
   * @type {object|null}
   * @private
   */
  #report = null;

  /**
   * Tracks which namespace groups are expanded.
   * @type {Map<string, boolean>}
   * @private
   */
  #expandedSections = new Map();

  static DEFAULT_OPTIONS = {
    id: 'snoot-app',
    tag: 'form',
    classes: ['snoot', 'standard-form'],
    position: { width: 1300, height: 750 },
    window: { title: 'SNOOT.App.Title', icon: 'fas fa-dog', resizable: true },
    actions: {
      rescan: SnootApp.#onRescan,
      cleanModule: SnootApp.#onCleanModule,
      cleanAllOrphaned: SnootApp.#onCleanAllOrphaned,
      cleanAllInactive: SnootApp.#onCleanAllInactive,
      cleanAllStale: SnootApp.#onCleanAllStale,
      deleteSetting: SnootApp.#onDeleteSetting,
      deleteModuleSettings: SnootApp.#onDeleteModuleSettings,
      removeScopeFlags: SnootApp.#onRemoveScopeFlags,
      removeDocFlag: SnootApp.#onRemoveDocFlag,
      removeCompendiumScopeFlags: SnootApp.#onRemoveCompendiumScopeFlags,
      removeCompendiumDocFlag: SnootApp.#onRemoveCompendiumDocFlag,
      toggleSection: SnootApp.#onToggleSection
    }
  };

  static PARTS = {
    tabs: { template: 'templates/generic/tab-navigation.hbs' },
    overview: { template: TEMPLATES.OVERVIEW, scrollable: [''] },
    settings: { template: TEMPLATES.SETTINGS, scrollable: [''] },
    flagsWorld: { template: TEMPLATES.FLAGS_WORLD, scrollable: [''] },
    flagsCompendiums: { template: TEMPLATES.FLAGS_COMPENDIUMS, scrollable: [''] },
    footer: { template: TEMPLATES.FOOTER }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: 'overview', group: 'primary', icon: 'fas fa-chart-pie', label: 'SNOOT.Tab.Overview' },
        { id: 'settings', group: 'primary', icon: 'fas fa-cogs', label: 'SNOOT.Tab.Settings' },
        { id: 'flagsWorld', group: 'primary', icon: 'fas fa-flag', label: 'SNOOT.Tab.FlagsWorld' },
        { id: 'flagsCompendiums', group: 'primary', icon: 'fas fa-atlas', label: 'SNOOT.Tab.FlagsCompendiums' }
      ],
      initial: 'overview'
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.#report) this.#report = await DataSniffer.scan();
    const report = this.#report;
    const totals = { orphanedSettings: 0, orphanedWorldFlags: 0, orphanedCompendiumFlags: 0, staleSettings: 0, totalSettings: 0, totalWorldFlags: 0, totalCompendiumFlags: 0 };
    const moduleMap = {};
    const addModule = (ns, data, type) => {
      if (!moduleMap[ns]) {
        const statusLabel = game.i18n.localize(`SNOOT.Status.${data.status}`);
        const statusHint = game.i18n.localize(`SNOOT.StatusHint.${data.status}`);
        moduleMap[ns] = {
          id: ns,
          status: data.status,
          statusLabel,
          statusHint,
          badgeClass: BADGE_CLASS[data.status],
          hasSettings: false,
          hasWorldFlags: false,
          hasCompendiumFlags: false,
          hasStaleSettings: false,
          canClean: !['active', 'system'].includes(data.status)
        };
      }
      moduleMap[ns][`has${type}`] = true;
    };
    for (const [ns, data] of Object.entries(report.settings)) {
      addModule(ns, data, 'Settings');
      totals.totalSettings += data.entries.length;
      if (data.status === 'orphaned') totals.orphanedSettings += data.entries.length;
      const staleCount = data.entries.filter((e) => e.isStale).length;
      if (staleCount > 0) {
        totals.staleSettings += staleCount;
        moduleMap[ns].hasStaleSettings = true;
        if (data.status === 'active') moduleMap[ns].canClean = true;
      }
    }
    for (const [ns, data] of Object.entries(report.flags)) {
      addModule(ns, data, 'WorldFlags');
      totals.totalWorldFlags += data.documents.length;
      if (data.status === 'orphaned') totals.orphanedWorldFlags += data.documents.length;
    }
    for (const [ns, data] of Object.entries(report.compendiumFlags)) {
      addModule(ns, data, 'CompendiumFlags');
      totals.totalCompendiumFlags += data.documents.length;
      if (data.status === 'orphaned') totals.orphanedCompendiumFlags += data.documents.length;
    }
    const statusOrder = { orphaned: 0, inactive: 1, active: 2, system: 3 };
    const modules = Object.values(moduleMap).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.id.localeCompare(b.id));
    const hasOrphaned = totals.orphanedSettings > 0 || totals.orphanedWorldFlags > 0 || totals.orphanedCompendiumFlags > 0;
    const hasInactive = modules.some((m) => m.status === 'inactive');
    const hasStale = totals.staleSettings > 0;
    const settingsGroups = Object.entries(report.settings).map(([ns, data]) => {
      const staleCount = data.entries.filter((e) => e.isStale).length;
      return {
        namespace: ns,
        status: data.status,
        statusLabel: game.i18n.localize(`SNOOT.Status.${data.status}`),
        badgeClass: BADGE_CLASS[data.status],
        canClean: !['active', 'system'].includes(data.status),
        hasStale: staleCount > 0,
        staleCount,
        count: data.entries.length,
        entries: data.entries
      };
    });
    const worldFlagsGroups = Object.entries(report.flags).map(([scope, data]) => ({
      scope,
      status: data.status,
      statusLabel: game.i18n.localize(`SNOOT.Status.${data.status}`),
      badgeClass: BADGE_CLASS[data.status],
      canClean: !['active', 'system'].includes(data.status),
      count: data.documents.length,
      documents: data.documents.map((d) => ({ ...d, flagKeysDisplay: d.flagKeys.join(', ') }))
    }));
    const compendiumFlagsGroups = Object.entries(report.compendiumFlags).map(([scope, data]) => ({
      scope,
      status: data.status,
      statusLabel: game.i18n.localize(`SNOOT.Status.${data.status}`),
      badgeClass: BADGE_CLASS[data.status],
      canClean: !['active', 'system'].includes(data.status),
      count: data.documents.length,
      documents: data.documents.map((d) => ({ ...d, flagKeysDisplay: d.flagKeys.join(', ') }))
    }));
    const hasSettings = settingsGroups.length > 0;
    const hasWorldFlags = worldFlagsGroups.length > 0;
    const hasCompendiumFlags = compendiumFlagsGroups.length > 0;
    return { ...context, totals, modules, hasOrphaned, hasInactive, hasStale, settingsGroups, hasSettings, worldFlagsGroups, hasWorldFlags, compendiumFlagsGroups, hasCompendiumFlags };
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const tabParts = ['overview', 'settings', 'flagsWorld', 'flagsCompendiums'];
    if (tabParts.includes(partId)) context.tab = context.tabs?.[partId];
    return context;
  }

  /** @override */
  _replaceHTML(result, content, options) {
    super._replaceHTML(result, content, options);
    this.#restoreExpandedSections();
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#bindSearchInputs();
  }

  /**
   * Restore expanded sections after a re-render.
   * @private
   */
  #restoreExpandedSections() {
    for (const [key, expanded] of this.#expandedSections) {
      if (!expanded) continue;
      const group = this.element.querySelector(`.namespace-group[data-namespace="${key}"]`);
      if (group) group.classList.remove('collapsed');
    }
  }

  /**
   * Bind search input listeners on all tabs.
   * @private
   */
  #bindSearchInputs() {
    const inputs = this.element.querySelectorAll('.tab-search input');
    for (const input of inputs) input.addEventListener('input', this.#onSearchInput.bind(this));
  }

  /**
   * Filter visible content by search query.
   * @param {Event} event - The input event.
   * @private
   */
  #onSearchInput(event) {
    const input = event.currentTarget;
    const query = input.value.trim().toLowerCase();
    const tab = input.closest('.tab');
    if (!tab) return;
    const isOverview = tab.classList.contains('overview');
    if (isOverview) {
      const rows = tab.querySelectorAll('tbody tr');
      for (const row of rows) {
        const text = row.textContent.toLowerCase();
        row.style.display = !query || text.includes(query) ? '' : 'none';
      }
      return;
    }
    const groups = tab.querySelectorAll('.namespace-group');
    for (const group of groups) {
      const headerText = group.querySelector('.namespace-header').textContent.toLowerCase();
      const rows = group.querySelectorAll('tbody tr');
      let anyRowMatch = false;
      if (!query) {
        group.style.display = '';
        for (const row of rows) row.style.display = '';
        const ns = group.dataset.namespace;
        if (!this.#expandedSections.get(ns)) group.classList.add('collapsed');
        else group.classList.remove('collapsed');
        continue;
      }
      const headerMatch = headerText.includes(query);
      for (const row of rows) {
        const rowText = row.textContent.toLowerCase();
        const rowMatch = headerMatch || rowText.includes(query);
        row.style.display = rowMatch ? '' : 'none';
        if (rowMatch) anyRowMatch = true;
      }
      const groupVisible = headerMatch || anyRowMatch;
      group.style.display = groupVisible ? '' : 'none';
      if (groupVisible) group.classList.remove('collapsed');
    }
  }

  /**
   * Clear the cached report and re-render.
   * @private
   */
  async #invalidateAndRender() {
    this.#report = null;
    this.render();
  }

  /**
   * Re-scan all data.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} _target - The clicked element.
   * @private
   */
  static async #onRescan(_event, _target) {
    this.#report = null;
    this.render();
  }

  /**
   * Toggle collapsed state on a namespace group.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element.
   * @private
   */
  static #onToggleSection(_event, target) {
    const group = target.closest('.namespace-group');
    if (!group) return;
    const ns = group.dataset.namespace;
    const isCollapsed = group.classList.toggle('collapsed');
    this.#expandedSections.set(ns, !isCollapsed);
  }

  /**
   * Clean all data for a single module.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-module-id.
   * @private
   */
  static async #onCleanModule(_event, target) {
    const moduleId = target.dataset.moduleId;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.CleanModule.Title') },
      content: game.i18n.format('SNOOT.Confirm.CleanModule.Content', { module: moduleId })
    });
    if (!confirmed) return;
    await DataSniffer.cleanModule(moduleId, this.#report);
    await this.#invalidateAndRender();
  }

  /**
   * Clean all orphaned module data.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} _target - The clicked element.
   * @private
   */
  static async #onCleanAllOrphaned(_event, _target) {
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.CleanAll.Title') },
      content: game.i18n.localize('SNOOT.Confirm.CleanAll.Content')
    });
    if (!confirmed) return;
    await DataSniffer.cleanAllOrphaned(this.#report);
    await this.#invalidateAndRender();
  }

  /**
   * Clean all inactive module data.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} _target - The clicked element.
   * @private
   */
  static async #onCleanAllInactive(_event, _target) {
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.CleanInactive.Title') },
      content: game.i18n.localize('SNOOT.Confirm.CleanInactive.Content')
    });
    if (!confirmed) return;
    await DataSniffer.cleanAllInactive(this.#report);
    await this.#invalidateAndRender();
  }

  /**
   * Delete all stale settings.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} _target - The clicked element.
   * @private
   */
  static async #onCleanAllStale(_event, _target) {
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.CleanStale.Title') },
      content: game.i18n.localize('SNOOT.Confirm.CleanStale.Content')
    });
    if (!confirmed) return;
    await DataSniffer.cleanAllStale(this.#report);
    await this.#invalidateAndRender();
  }

  /**
   * Delete a single setting.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-key.
   * @private
   */
  static async #onDeleteSetting(_event, target) {
    const key = target.dataset.key;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.DeleteSetting.Title') },
      content: game.i18n.format('SNOOT.Confirm.DeleteSetting.Content', { key })
    });
    if (!confirmed) return;
    await DataSniffer.deleteSetting(key);
    await this.#invalidateAndRender();
  }

  /**
   * Delete all settings for a module namespace.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-namespace.
   * @private
   */
  static async #onDeleteModuleSettings(_event, target) {
    const namespace = target.dataset.namespace;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.DeleteModuleSettings.Title') },
      content: game.i18n.format('SNOOT.Confirm.DeleteModuleSettings.Content', { module: namespace })
    });
    if (!confirmed) return;
    await DataSniffer.deleteSettingsForModule(namespace);
    await this.#invalidateAndRender();
  }

  /**
   * Remove all world flags of a scope from every document.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-scope.
   * @private
   */
  static async #onRemoveScopeFlags(_event, target) {
    const scope = target.dataset.scope;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.RemoveScope.Title') },
      content: game.i18n.format('SNOOT.Confirm.RemoveScope.Content', { scope })
    });
    if (!confirmed) return;
    await DataSniffer.removeFlagsForScope(scope, this.#report);
    await this.#invalidateAndRender();
  }

  /**
   * Remove world flags of a scope from a single document.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-uuid and data-scope.
   * @private
   */
  static async #onRemoveDocFlag(_event, target) {
    const { uuid, scope } = target.dataset;
    const doc = await fromUuid(uuid);
    if (!doc) {
      ui.notifications.error(`Document not found: ${uuid}`);
      return;
    }
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.RemoveDocFlag.Title') },
      content: game.i18n.format('SNOOT.Confirm.RemoveDocFlag.Content', { scope, name: doc.name || uuid })
    });
    if (!confirmed) return;
    await DataSniffer.removeFlagsFromDocument(doc, scope);
    await this.#invalidateAndRender();
  }

  /**
   * Remove all compendium flags of a scope from every document.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-scope.
   * @private
   */
  static async #onRemoveCompendiumScopeFlags(_event, target) {
    const scope = target.dataset.scope;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.RemoveCompendiumScope.Title') },
      content: game.i18n.format('SNOOT.Confirm.RemoveCompendiumScope.Content', { scope })
    });
    if (!confirmed) return;
    await DataSniffer.removeCompendiumFlagsForScope(scope, this.#report);
    await this.#invalidateAndRender();
  }

  /**
   * Remove compendium flags of a scope from a single document.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-uuid and data-scope.
   * @private
   */
  static async #onRemoveCompendiumDocFlag(_event, target) {
    const { uuid, scope } = target.dataset;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('SNOOT.Confirm.RemoveDocFlag.Title') },
      content: game.i18n.format('SNOOT.Confirm.RemoveDocFlag.Content', { scope, name: uuid })
    });
    if (!confirmed) return;
    await DataSniffer.removeCompendiumDocFlag(uuid, scope);
    await this.#invalidateAndRender();
  }
}
