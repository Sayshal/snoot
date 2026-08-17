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

  /** @param {object} [options] - Application options. */
  constructor(options = {}) {
    super(options);
    if (!game.user.isGM) this.tabGroups.primary = 'flagsUsers';
  }

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
      deleteUserSetting: SnootApp.#onDeleteUserSetting,
      deleteClientSetting: SnootApp.#onDeleteClientSetting,
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
    howTo: { template: TEMPLATES.HOW_TO, scrollable: [''] },
    overview: { template: TEMPLATES.OVERVIEW, scrollable: [''] },
    settings: { template: TEMPLATES.SETTINGS, scrollable: [''] },
    flagsWorld: { template: TEMPLATES.FLAGS_WORLD, scrollable: [''] },
    flagsCompendiums: { template: TEMPLATES.FLAGS_COMPENDIUMS, scrollable: [''] },
    flagsUsers: { template: TEMPLATES.FLAGS_USERS, scrollable: [''] },
    footer: { template: TEMPLATES.FOOTER }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: 'howTo', group: 'primary', icon: 'fas fa-circle-question', label: 'SNOOT.Tab.HowTo' },
        { id: 'overview', group: 'primary', icon: 'fas fa-chart-pie', label: 'SNOOT.Tab.Overview' },
        { id: 'settings', group: 'primary', icon: 'fas fa-cogs', label: 'SNOOT.Tab.Settings' },
        { id: 'flagsWorld', group: 'primary', icon: 'fas fa-flag', label: 'SNOOT.Tab.FlagsWorld' },
        { id: 'flagsCompendiums', group: 'primary', icon: 'fas fa-atlas', label: 'SNOOT.Tab.FlagsCompendiums' },
        { id: 'flagsUsers', group: 'primary', icon: 'fas fa-users', label: 'SNOOT.Tab.Users' }
      ],
      initial: 'howTo'
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.#report) this.#report = await DataSniffer.scan();
    const report = this.#report;
    const totals = { orphanedSettings: 0, orphanedWorldFlags: 0, orphanedCompendiumFlags: 0, staleSettings: 0, totalSettings: 0, totalWorldFlags: 0, totalCompendiumFlags: 0 };
    const moduleMap = {};
    const addModule = (ns, data, type, n) => {
      if (!moduleMap[ns]) {
        const statusLabel = _loc(`SNOOT.Status.${data.status}`);
        const statusHint = _loc(`SNOOT.StatusHint.${data.status}`);
        moduleMap[ns] = {
          id: ns,
          status: data.status,
          statusLabel,
          statusHint,
          badgeClass: BADGE_CLASS[data.status],
          hasSettings: false,
          hasWorldFlags: false,
          hasCompendiumFlags: false,
          hasUserData: false,
          hasStaleSettings: false,
          count: 0,
          canClean: !['active', 'system'].includes(data.status)
        };
      }
      moduleMap[ns][`has${type}`] = true;
      moduleMap[ns].count += n;
    };
    for (const [ns, data] of Object.entries(report.settings)) {
      addModule(ns, data, 'Settings', data.entries.length);
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
      addModule(ns, data, 'WorldFlags', data.documents.length);
      totals.totalWorldFlags += data.documents.length;
      if (data.status === 'orphaned') totals.orphanedWorldFlags += data.documents.length;
    }
    for (const [ns, data] of Object.entries(report.compendiumFlags)) {
      addModule(ns, data, 'CompendiumFlags', data.documents.length);
      totals.totalCompendiumFlags += data.documents.length;
      if (data.status === 'orphaned') totals.orphanedCompendiumFlags += data.documents.length;
    }
    const userDataByNamespace = {};
    for (const branch of report.users.users) {
      for (const entry of branch.entries) {
        if (!userDataByNamespace[entry.namespace]) userDataByNamespace[entry.namespace] = { status: entry.status, count: 0 };
        userDataByNamespace[entry.namespace].count++;
      }
    }
    for (const [ns, data] of Object.entries(userDataByNamespace)) addModule(ns, data, 'UserData', data.count);
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
        statusLabel: _loc(`SNOOT.Status.${data.status}`),
        badgeClass: BADGE_CLASS[data.status],
        canClean: !['active', 'system'].includes(data.status),
        hasStale: staleCount > 0,
        staleCount,
        count: data.entries.length
      };
    });
    const worldFlagsGroups = Object.entries(report.flags).map(([scope, data]) => ({
      scope,
      status: data.status,
      statusLabel: _loc(`SNOOT.Status.${data.status}`),
      badgeClass: BADGE_CLASS[data.status],
      canClean: !['active', 'system'].includes(data.status),
      count: data.documents.length
    }));
    const compendiumFlagsGroups = Object.entries(report.compendiumFlags).map(([scope, data]) => ({
      scope,
      status: data.status,
      statusLabel: _loc(`SNOOT.Status.${data.status}`),
      badgeClass: BADGE_CLASS[data.status],
      canClean: !['active', 'system'].includes(data.status),
      count: data.documents.length
    }));
    const usersGroups = report.users.users.filter((branch) => branch.entries.length).map((branch) => ({ key: `user:${branch.id}`, label: branch.name, count: branch.entries.length, isClient: false }));
    if (report.users.clientSettings.length) usersGroups.push({ key: 'client', label: _loc('SNOOT.Users.ClientStorage'), count: report.users.clientSettings.length, isClient: true });
    const hasSettings = settingsGroups.length > 0;
    const hasWorldFlags = worldFlagsGroups.length > 0;
    const hasCompendiumFlags = compendiumFlagsGroups.length > 0;
    const hasUsers = usersGroups.length > 0;
    return {
      ...context,
      totals,
      modules,
      hasOrphaned,
      hasInactive,
      hasStale,
      settingsGroups,
      hasSettings,
      worldFlagsGroups,
      hasWorldFlags,
      compendiumFlagsGroups,
      hasCompendiumFlags,
      usersGroups,
      hasUsers,
      isPlayerView: !game.user.isGM
    };
  }

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (game.user.isGM) return parts;
    return { tabs: parts.tabs, flagsUsers: parts.flagsUsers, footer: parts.footer };
  }

  /** @override */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (!config || game.user.isGM) return config;
    return { ...config, tabs: config.tabs.filter((t) => t.id === 'flagsUsers'), initial: 'flagsUsers' };
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const tabParts = ['howTo', 'overview', 'settings', 'flagsWorld', 'flagsCompendiums', 'flagsUsers'];
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
   * Restore expanded sections after a re-render and lazy-render their rows.
   * @private
   */
  #restoreExpandedSections() {
    for (const [key, expanded] of this.#expandedSections) {
      if (!expanded) continue;
      const group = this.element.querySelector(`.namespace-group[data-namespace="${key}"]`);
      if (!group) continue;
      group.classList.remove('collapsed');
      this.#renderGroupRows(group);
    }
  }

  /**
   * Build a settings row HTML string.
   * @param {object} entry - Setting entry from the report.
   * @returns {string} Row HTML.
   * @private
   */
  #settingRowHtml(entry) {
    const esc = foundry.utils.escapeHTML;
    const stale = entry.isStale ? 'stale-row' : '';
    const tip = esc(_loc(entry.isStale ? 'SNOOT.Tooltip.Stale' : 'SNOOT.Tooltip.Registered'));
    const iconClass = entry.isStale ? 'fa-times-circle stale-icon' : 'fa-check-circle registered-icon';
    const del = esc(_loc('SNOOT.Action.Delete'));
    return `<tr class="${stale}"><td class="setting-key"><code>${esc(entry.settingKey)}</code></td><td class="setting-value"><code>${esc(entry.displayValue)}</code></td><td class="col-btn"><i class="fas ${iconClass}" data-tooltip aria-label="${tip}"></i></td><td class="col-btn"><a data-action="deleteSetting" data-key="${esc(entry.key)}" data-tooltip aria-label="${del}"><i class="fas fa-trash"></i></a></td></tr>`;
  }

  /**
   * Build a world-flags row HTML string.
   * @param {object} doc - Document entry from the report.
   * @param {string} scope - The flag scope.
   * @returns {string} Row HTML.
   * @private
   */
  #worldFlagRowHtml(doc, scope) {
    const esc = foundry.utils.escapeHTML;
    const remove = esc(_loc('SNOOT.Action.Remove'));
    const keys = esc(doc.flagKeys.join(', '));
    return `<tr><td class="doc-name">${esc(doc.name)}</td><td>${esc(doc.type)}</td><td class="flag-keys"><code>${keys}</code></td><td class="col-btn"><a data-action="removeDocFlag" data-uuid="${esc(doc.uuid)}" data-scope="${esc(scope)}" data-tooltip aria-label="${remove}"><i class="fas fa-trash"></i></a></td></tr>`;
  }

  /**
   * Build a compendium-flags row HTML string.
   * @param {object} doc - Document entry from the report.
   * @param {string} scope - The flag scope.
   * @returns {string} Row HTML.
   * @private
   */
  #compendiumFlagRowHtml(doc, scope) {
    const esc = foundry.utils.escapeHTML;
    const remove = esc(_loc('SNOOT.Action.Remove'));
    const keys = esc(doc.flagKeys.join(', '));
    return `<tr><td class="doc-name">${esc(doc.name)}</td><td>${esc(doc.type)}</td><td class="pack-label">${esc(doc.packLabel)}</td><td class="flag-keys"><code>${keys}</code></td><td class="col-btn"><a data-action="removeCompendiumDocFlag" data-uuid="${esc(doc.uuid)}" data-scope="${esc(scope)}" data-tooltip aria-label="${remove}"><i class="fas fa-trash"></i></a></td></tr>`;
  }

  /**
   * Look up the cached user-branch entries for a users-tab group key.
   * @param {string} key - Group key, either 'user:<id>' or 'client'.
   * @returns {object[]} Cached entries for that group.
   * @private
   */
  #userEntries(key) {
    if (key === 'client') return this.#report?.users?.clientSettings ?? [];
    return this.#report?.users?.users?.find((branch) => `user:${branch.id}` === key)?.entries ?? [];
  }

  /**
   * Build a users-tab row HTML string for a flag, user setting, or client setting entry.
   * @param {object} entry - User-branch entry from the report.
   * @param {string|null} userId - Owning user ID, or null for client storage.
   * @returns {string} Row HTML.
   * @private
   */
  #userRowHtml(entry, userId) {
    const esc = foundry.utils.escapeHTML;
    const kind = esc(_loc(`SNOOT.Kind.${entry.kind}`));
    const badge = `<span class="tag badge ${BADGE_CLASS[entry.status]}">${esc(_loc(`SNOOT.Status.${entry.status}`))}</span>`;
    if (entry.kind === 'flag') {
      const remove = esc(_loc('SNOOT.Action.Remove'));
      const keys = esc(entry.flagKeys.join(', '));
      return `<tr><td class="row-kind">${kind}</td><td class="setting-key">${badge} <code>${esc(entry.namespace)}</code></td><td class="flag-keys"><code>${keys}</code></td><td class="col-btn"></td><td class="col-btn"><a data-action="removeDocFlag" data-uuid="${esc(entry.uuid)}" data-scope="${esc(entry.namespace)}" data-tooltip aria-label="${remove}"><i class="fas fa-trash"></i></a></td></tr>`;
    }
    const stale = entry.isStale ? 'stale-row' : '';
    const tip = esc(_loc(entry.isStale ? 'SNOOT.Tooltip.Stale' : 'SNOOT.Tooltip.Registered'));
    const iconClass = entry.isStale ? 'fa-times-circle stale-icon' : 'fa-check-circle registered-icon';
    const del = esc(_loc('SNOOT.Action.Delete'));
    const action = entry.kind === 'client' ? 'deleteClientSetting' : 'deleteUserSetting';
    return `<tr class="${stale}"><td class="row-kind">${kind}</td><td class="setting-key">${badge} <code>${esc(entry.key)}</code></td><td class="setting-value"><code>${esc(entry.displayValue)}</code></td><td class="col-btn"><i class="fas ${iconClass}" data-tooltip aria-label="${tip}"></i></td><td class="col-btn"><a data-action="${action}" data-key="${esc(entry.key)}" data-user-id="${esc(userId ?? '')}" data-tooltip aria-label="${del}"><i class="fas fa-trash"></i></a></td></tr>`;
  }

  /**
   * Lazily populate a namespace group's tbody with rows from the cached report.
   * @param {HTMLElement} groupEl - The .namespace-group element.
   * @private
   */
  #renderGroupRows(groupEl) {
    if (!groupEl || groupEl.dataset.loaded === 'true') return;
    const tbody = groupEl.querySelector('tbody');
    if (!tbody) return;
    const ns = groupEl.dataset.namespace;
    const tab = groupEl.closest('.tab');
    let html = '';
    if (tab?.classList.contains('settings-tab')) {
      const data = this.#report?.settings?.[ns];
      if (data) html = data.entries.map((e) => this.#settingRowHtml(e)).join('');
    } else if (tab?.classList.contains('flags-world-tab')) {
      const data = this.#report?.flags?.[ns];
      if (data) html = data.documents.map((d) => this.#worldFlagRowHtml(d, ns)).join('');
    } else if (tab?.classList.contains('flags-compendiums-tab')) {
      const data = this.#report?.compendiumFlags?.[ns];
      if (data) html = data.documents.map((d) => this.#compendiumFlagRowHtml(d, ns)).join('');
    } else if (tab?.classList.contains('flags-users-tab')) {
      const userId = ns.startsWith('user:') ? ns.slice(5) : null;
      html = this.#userEntries(ns)
        .map((e) => this.#userRowHtml(e, userId))
        .join('');
    }
    tbody.innerHTML = html;
    groupEl.dataset.loaded = 'true';
  }

  /**
   * Look up cached entries for a namespace group and return those matching a query.
   * @param {HTMLElement} tab - The active tab element.
   * @param {string} ns - Namespace/scope id.
   * @param {string} query - Lowercased search query.
   * @returns {boolean} True if any cached entry matches.
   * @private
   */
  #hasCachedMatch(tab, ns, query) {
    if (tab.classList.contains('settings-tab')) {
      const entries = this.#report?.settings?.[ns]?.entries ?? [];
      return entries.some(
        (e) =>
          e.settingKey.toLowerCase().includes(query) ||
          String(e.displayValue ?? '')
            .toLowerCase()
            .includes(query)
      );
    }
    if (tab.classList.contains('flags-world-tab')) {
      const docs = this.#report?.flags?.[ns]?.documents ?? [];
      return docs.some(
        (d) =>
          String(d.name ?? '')
            .toLowerCase()
            .includes(query) ||
          String(d.type ?? '')
            .toLowerCase()
            .includes(query) ||
          d.flagKeys.join(',').toLowerCase().includes(query)
      );
    }
    if (tab.classList.contains('flags-compendiums-tab')) {
      const docs = this.#report?.compendiumFlags?.[ns]?.documents ?? [];
      return docs.some(
        (d) =>
          String(d.name ?? '')
            .toLowerCase()
            .includes(query) ||
          String(d.type ?? '')
            .toLowerCase()
            .includes(query) ||
          String(d.packLabel ?? '')
            .toLowerCase()
            .includes(query) ||
          d.flagKeys.join(',').toLowerCase().includes(query)
      );
    }
    if (tab.classList.contains('flags-users-tab')) {
      return this.#userEntries(ns).some(
        (e) =>
          e.namespace.toLowerCase().includes(query) ||
          String(e.key ?? '')
            .toLowerCase()
            .includes(query) ||
          String(e.displayValue ?? '')
            .toLowerCase()
            .includes(query) ||
          (e.flagKeys ?? []).join(',').toLowerCase().includes(query)
      );
    }
    return false;
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
      const ns = group.dataset.namespace;
      if (!query) {
        group.style.display = '';
        if (!this.#expandedSections.get(ns)) group.classList.add('collapsed');
        else group.classList.remove('collapsed');
        for (const row of group.querySelectorAll('tbody tr')) row.style.display = '';
        continue;
      }
      const headerText = group.querySelector('.namespace-header').textContent.toLowerCase();
      const headerMatch = headerText.includes(query);
      const groupVisible = headerMatch || this.#hasCachedMatch(tab, ns, query);
      group.style.display = groupVisible ? '' : 'none';
      if (!groupVisible) continue;
      this.#renderGroupRows(group);
      group.classList.remove('collapsed');
      for (const row of group.querySelectorAll('tbody tr')) {
        if (headerMatch) row.style.display = '';
        else row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none';
      }
    }
  }

  /**
   * Prompt the user to rescan after a cleanup.
   * @private
   */
  async #invalidateAndRender() {
    const rescan = await DialogV2.confirm({
      window: { title: 'SNOOT.Confirm.Rescan.Title' },
      content: _loc('SNOOT.Confirm.Rescan.Content'),
      yes: { label: 'SNOOT.Action.Rescan', default: true },
      no: { label: 'SNOOT.Action.Skip' }
    });
    if (!rescan) return;
    this.#report = null;
    this.render();
  }

  /**
   * Count user-branch entries matching a predicate. Client-storage rows are never included.
   * @param {Function} match - Predicate run against each user entry.
   * @returns {number} Matching entry count.
   * @private
   */
  #countUserData(match) {
    let count = 0;
    for (const branch of this.#report?.users?.users ?? []) count += branch.entries.filter(match).length;
    return count;
  }

  /**
   * Ask whether a bulk clean should also delete user-scoped data.
   * @param {Function} match - Predicate identifying the user entries in scope.
   * @returns {Promise<boolean>} True if the user opted in.
   * @private
   */
  async #confirmUserData(match) {
    const count = this.#countUserData(match);
    if (!count) return false;
    return DialogV2.confirm({
      window: { title: 'SNOOT.Confirm.IncludeUserData.Title' },
      content: _loc('SNOOT.Confirm.IncludeUserData.Content', { count }),
      yes: { label: 'SNOOT.Action.IncludeUserData' },
      no: { label: 'SNOOT.Action.SkipUserData', default: true }
    });
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
    if (group.classList.contains('collapsed')) this.#renderGroupRows(group);
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
      window: { title: 'SNOOT.Confirm.CleanModule.Title' },
      content: _loc('SNOOT.Confirm.CleanModule.Content', { module: moduleId })
    });
    if (!confirmed) return;
    const includeUserData = await this.#confirmUserData((e) => e.namespace === moduleId);
    await DataSniffer.cleanModule(moduleId, this.#report, { includeUserData });
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
      window: { title: 'SNOOT.Confirm.CleanAll.Title' },
      content: _loc('SNOOT.Confirm.CleanAll.Content')
    });
    if (!confirmed) return;
    const includeUserData = await this.#confirmUserData((e) => e.status === 'orphaned');
    await DataSniffer.cleanAllOrphaned(this.#report, includeUserData);
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
      window: { title: 'SNOOT.Confirm.CleanInactive.Title' },
      content: _loc('SNOOT.Confirm.CleanInactive.Content')
    });
    if (!confirmed) return;
    const includeUserData = await this.#confirmUserData((e) => e.status === 'inactive');
    await DataSniffer.cleanAllInactive(this.#report, includeUserData);
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
      window: { title: 'SNOOT.Confirm.CleanStale.Title' },
      content: _loc('SNOOT.Confirm.CleanStale.Content')
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
      window: { title: 'SNOOT.Confirm.DeleteSetting.Title' },
      content: _loc('SNOOT.Confirm.DeleteSetting.Content', { key })
    });
    if (!confirmed) return;
    await DataSniffer.deleteSetting(key);
    await this.#invalidateAndRender();
  }

  /**
   * Delete a single user-scoped setting.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-key and data-user-id.
   * @private
   */
  static async #onDeleteUserSetting(_event, target) {
    const { key, userId } = target.dataset;
    const confirmed = await DialogV2.confirm({
      window: { title: 'SNOOT.Confirm.DeleteSetting.Title' },
      content: _loc('SNOOT.Confirm.DeleteUserSetting.Content', { key, user: game.users.get(userId)?.name ?? userId })
    });
    if (!confirmed) return;
    await DataSniffer.deleteSetting(key, userId);
    await this.#invalidateAndRender();
  }

  /**
   * Delete a single client-scoped setting from this browser's storage.
   * @param {Event} _event - The triggering event.
   * @param {HTMLElement} target - The clicked element with data-key.
   * @private
   */
  static async #onDeleteClientSetting(_event, target) {
    const key = target.dataset.key;
    const confirmed = await DialogV2.confirm({
      window: { title: 'SNOOT.Confirm.DeleteSetting.Title' },
      content: _loc('SNOOT.Confirm.DeleteClientSetting.Content', { key })
    });
    if (!confirmed) return;
    DataSniffer.deleteClientSetting(key);
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
      window: { title: 'SNOOT.Confirm.DeleteModuleSettings.Title' },
      content: _loc('SNOOT.Confirm.DeleteModuleSettings.Content', { module: namespace })
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
      window: { title: 'SNOOT.Confirm.RemoveScope.Title' },
      content: _loc('SNOOT.Confirm.RemoveScope.Content', { scope })
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
      ui.notifications.error('SNOOT.Notify.DocNotFound', { localize: true, format: { uuid } });
      return;
    }
    const confirmed = await DialogV2.confirm({
      window: { title: 'SNOOT.Confirm.RemoveDocFlag.Title' },
      content: _loc('SNOOT.Confirm.RemoveDocFlag.Content', { scope, name: doc.name || uuid })
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
      window: { title: 'SNOOT.Confirm.RemoveCompendiumScope.Title' },
      content: _loc('SNOOT.Confirm.RemoveCompendiumScope.Content', { scope })
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
      window: { title: 'SNOOT.Confirm.RemoveDocFlag.Title' },
      content: _loc('SNOOT.Confirm.RemoveDocFlag.Content', { scope, name: uuid })
    });
    if (!confirmed) return;
    await DataSniffer.removeCompendiumDocFlag(uuid, scope);
    await this.#invalidateAndRender();
  }
}
