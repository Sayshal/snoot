/**
 * Data scanning and cleanup logic.
 * @module DataSniffer
 * @author Tyler
 */

import { MODULE, SETTINGS } from './constants.mjs';

/** Scans world data and cleans up orphaned module traces. */
export class DataSniffer {
  /**
   * Run a full scan of settings, world flags, and compendium flags.
   * @returns {Promise<object>} Complete scan report with settings, flags, and compendiumFlags keys.
   */
  static async scan() {
    const knownScopes = DataSniffer.#buildKnownScopes();
    const hiddenScopes = DataSniffer.#buildHiddenScopes();
    const progress = ui.notifications.info('SNOOT.Scan.Start', { localize: true, progress: true });
    const settings = DataSniffer.#scanSettings(knownScopes, hiddenScopes);
    const flags = DataSniffer.#scanFlags(knownScopes, hiddenScopes);
    const compendiumFlags = {};
    const packCount = game.packs.size;
    let completed = 0;
    for (const pack of game.packs) {
      try {
        await DataSniffer.#scanPack(pack, knownScopes, hiddenScopes, compendiumFlags);
      } catch (err) {
        console.warn(`Snoot | Failed to scan pack "${pack.metadata.label}":`, err);
      }
      completed++;
      progress.update({
        pct: completed / packCount,
        message: game.i18n.format('SNOOT.Scan.Pack', { label: pack.metadata.label })
      });
    }
    ui.notifications.clear();
    ui.notifications.success(game.i18n.localize('SNOOT.Scan.Complete'), { duration: 3000 });
    return { settings, flags, compendiumFlags };
  }

  /**
   * Build a set of scopes hidden by user settings.
   * @returns {Set<string>} Hidden scope IDs.
   * @private
   */
  static #buildHiddenScopes() {
    const hidden = new Set();
    if (!game.settings.get(MODULE.ID, SETTINGS.SHOW_CORE_FLAGS)) hidden.add('core');
    if (!game.settings.get(MODULE.ID, SETTINGS.SHOW_SYSTEM_FLAGS)) hidden.add(game.system.id);
    return hidden;
  }

  /**
   * Build a set of all known module and system scopes.
   * @returns {Set<string>} Known scope IDs.
   * @private
   */
  static #buildKnownScopes() {
    const scopes = new Set(['core', game.system.id]);
    for (const key of game.modules.keys()) scopes.add(key);
    return scopes;
  }

  /**
   * Classify a namespace based on whether its module is installed/active.
   * @param {string} namespace - Module or scope ID to classify.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @returns {'system'|'active'|'inactive'|'orphaned'} Status classification.
   * @private
   */
  static #classify(namespace, knownScopes) {
    if (namespace === 'core' || namespace === game.system.id) return 'system';
    if (!knownScopes.has(namespace)) return 'orphaned';
    const mod = game.modules.get(namespace);
    if (!mod) return 'orphaned';
    return mod.active ? 'active' : 'inactive';
  }

  /**
   * Check if a setting key is still registered.
   * @param {string} fullKey - Full setting key, e.g. 'module-id.settingName'.
   * @returns {boolean} True if the setting is registered.
   * @private
   */
  static #isSettingRegistered(fullKey) {
    return game.settings.settings.has(fullKey);
  }

  /**
   * Scan world settings storage, grouped by module namespace.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @param {Set<string>} hiddenScopes - Scopes to exclude from results.
   * @returns {object} Settings grouped by namespace with status and entries.
   * @private
   */
  static #scanSettings(knownScopes, hiddenScopes) {
    const byNamespace = {};
    const worldSettings = game.settings.storage.get('world');
    for (const setting of worldSettings) {
      const dotIndex = setting.key.indexOf('.');
      if (dotIndex === -1) continue;
      const namespace = setting.key.substring(0, dotIndex);
      if (hiddenScopes.has(namespace)) continue;
      const settingKey = setting.key.substring(dotIndex + 1);
      if (!byNamespace[namespace]) byNamespace[namespace] = { status: DataSniffer.#classify(namespace, knownScopes), entries: [] };
      let parsedValue;
      try {
        parsedValue = JSON.parse(setting.value);
      } catch {
        parsedValue = setting.value;
      }
      const isStale = !DataSniffer.#isSettingRegistered(setting.key);
      byNamespace[namespace].entries.push({ key: setting.key, settingKey, value: parsedValue, displayValue: JSON.stringify(parsedValue), isStale });
    }
    return byNamespace;
  }

  /**
   * Scan all world documents and their embedded children for flag scopes.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @param {Set<string>} hiddenScopes - Scopes to exclude from results.
   * @returns {object} Flags grouped by scope with status and document references.
   * @private
   */
  static #scanFlags(knownScopes, hiddenScopes) {
    const byScope = {};
    const processDoc = (doc) => {
      if (!doc.flags) return;
      for (const scope of Object.keys(doc.flags)) {
        if (hiddenScopes.has(scope)) continue;
        const flagData = doc.flags[scope];
        if (!flagData || typeof flagData !== 'object' || Object.keys(flagData).length === 0) continue;
        if (!byScope[scope]) byScope[scope] = { status: DataSniffer.#classify(scope, knownScopes), documents: [] };
        byScope[scope].documents.push({
          uuid: doc.uuid,
          name: doc.name || doc.title || doc.label || '(unnamed)',
          type: doc.documentName,
          collectionName: doc.collectionName,
          flagKeys: Object.keys(flagData)
        });
      }
    };
    const processEmbedded = (doc) => {
      for (const collectionName of Object.keys(doc.constructor.hierarchy)) {
        if (!doc[collectionName]?.size) continue;
        for (const child of doc[collectionName]) {
          processDoc(child);
          processEmbedded(child);
        }
      }
    };
    for (const collection of game.collections) {
      for (const doc of collection) {
        processDoc(doc);
        processEmbedded(doc);
      }
    }
    return byScope;
  }

  /**
   * Scan a single compendium pack for flag scopes using getIndex.
   * @param {object} pack - The compendium pack to scan.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @param {Set<string>} hiddenScopes - Scopes to exclude from results.
   * @param {object} byScope - Results are merged into this object.
   * @private
   */
  static async #scanPack(pack, knownScopes, hiddenScopes, byScope) {
    const cls = pack.documentClass;
    const hierarchy = cls.hierarchy ?? {};
    const embeddedNames = Object.keys(hierarchy);
    const fields = ['flags'];
    for (const name of embeddedNames) fields.push(`${name}.flags`, `${name}.name`);
    const index = await pack.getIndex({ fields });
    console.debug(`Snoot | Pack "${pack.metadata.label}" (${pack.collection}) -${index.size} entries, fields: [${fields}]`);
    for (const entry of index) {
      if (entry.flags && Object.keys(entry.flags).length) console.debug(`Snoot |   [${pack.documentName}] ${entry.name} -flag scopes: [${Object.keys(entry.flags)}]`);
      DataSniffer.#processCompendiumEntry(entry, pack.documentName, entry.uuid, pack, knownScopes, hiddenScopes, byScope);
      for (const name of embeddedNames) {
        if (!entry[name]?.length) continue;
        const childType = hierarchy[name].model.documentName;
        for (const child of entry[name]) {
          if (child.flags && Object.keys(child.flags).length) console.debug(`Snoot |     [${childType}] ${child.name || child._id} on "${entry.name}" -flag scopes: [${Object.keys(child.flags)}]`);
          const childUuid = `${entry.uuid}.${childType}.${child._id}`;
          DataSniffer.#processCompendiumEntry(child, childType, childUuid, pack, knownScopes, hiddenScopes, byScope);
        }
      }
    }
  }

  /**
   * Process a single compendium index entry for flag scopes.
   * @param {object} entry - Plain index object from getIndex.
   * @param {string} type - Document type name (e.g. 'Actor', 'Item').
   * @param {string} uuid - Full UUID for this entry.
   * @param {object} pack - The parent compendium pack.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @param {Set<string>} hiddenScopes - Scopes to exclude from results.
   * @param {object} byScope - Results are merged into this object.
   * @private
   */
  static #processCompendiumEntry(entry, type, uuid, pack, knownScopes, hiddenScopes, byScope) {
    if (!entry.flags) return;
    for (const scope of Object.keys(entry.flags)) {
      if (hiddenScopes.has(scope)) continue;
      const flagData = entry.flags[scope];
      if (!flagData || typeof flagData !== 'object' || Object.keys(flagData).length === 0) continue;
      if (!byScope[scope]) byScope[scope] = { status: DataSniffer.#classify(scope, knownScopes), documents: [] };
      byScope[scope].documents.push({ uuid, name: entry.name || '(unnamed)', type, packCollection: pack.collection, packLabel: pack.metadata.label, flagKeys: Object.keys(flagData) });
    }
  }

  /**
   * Delete a single world setting by key.
   * @param {string} key - Full setting key, e.g. 'module-id.settingName'.
   */
  static async deleteSetting(key) {
    const worldSettings = game.settings.storage.get('world');
    const setting = worldSettings.find((s) => s.key === key);
    if (!setting) {
      ui.notifications.clear();
      ui.notifications.warn(`Setting "${key}" not found.`);
      return;
    }
    await setting.delete();
    ui.notifications.clear();
    ui.notifications.info(`Deleted setting: ${key}`);
  }

  /**
   * Delete all world settings for a given namespace.
   * @param {string} namespace - Module namespace to delete settings for.
   */
  static async deleteSettingsForModule(namespace) {
    const worldSettings = game.settings.storage.get('world');
    const toDelete = worldSettings.filter((s) => s.key.startsWith(`${namespace}.`));
    for (const setting of toDelete) await setting.delete();
    ui.notifications.clear();
    ui.notifications.info(`Deleted ${toDelete.length} settings for "${namespace}".`);
  }

  /**
   * Remove all flags of a scope from a single document.
   * @param {Document} doc - The Foundry document to update.
   * @param {string} scope - Flag scope to remove.
   */
  static async removeFlagsFromDocument(doc, scope) {
    await doc.update({ [`flags.-=${scope}`]: null });
    ui.notifications.clear();
    ui.notifications.info(`Removed "${scope}" flags from ${doc.name || doc.uuid}.`);
  }

  /**
   * Remove all flags of a scope from every flagged world document in the report.
   * @param {string} scope - Flag scope to remove.
   * @param {object} report - The scan report.
   */
  static async removeFlagsForScope(scope, report) {
    const entries = report.flags[scope]?.documents ?? [];
    let count = 0;
    for (const entry of entries) {
      const doc = await fromUuid(entry.uuid);
      if (!doc) continue;
      await doc.update({ [`flags.-=${scope}`]: null });
      count++;
    }
    ui.notifications.clear();
    ui.notifications.info(`Removed "${scope}" flags from ${count} documents.`);
  }

  /**
   * Remove flags of a scope from a single compendium document. Handles pack lock/unlock.
   * @param {string} uuid - The document UUID.
   * @param {string} scope - Flag scope to remove.
   */
  static async removeCompendiumDocFlag(uuid, scope) {
    const doc = await fromUuid(uuid);
    if (!doc) {
      ui.notifications.clear();
      ui.notifications.error(`Document not found: ${uuid}`);
      return;
    }
    const pack = doc.compendium;
    const wasLocked = pack.locked;
    await pack.configure({ locked: false });
    await doc.update({ [`flags.-=${scope}`]: null });
    if (wasLocked) await pack.configure({ locked: true });
    ui.notifications.clear();
    ui.notifications.info(`Removed "${scope}" flags from ${doc.name || uuid}.`);
  }

  /**
   * Remove all flags of a scope from every compendium document in the report. Handles pack lock/unlock.
   * @param {string} scope - Flag scope to remove.
   * @param {object} report - The scan report.
   */
  static async removeCompendiumFlagsForScope(scope, report) {
    const entries = report.compendiumFlags[scope]?.documents ?? [];
    const byPack = {};
    for (const entry of entries) {
      if (!byPack[entry.packCollection]) byPack[entry.packCollection] = [];
      byPack[entry.packCollection].push(entry.uuid);
    }
    let count = 0;
    for (const [collection, uuids] of Object.entries(byPack)) {
      const pack = game.packs.get(collection);
      if (!pack) continue;
      const wasLocked = pack.locked;
      await pack.configure({ locked: false });
      for (const uuid of uuids) {
        const doc = await fromUuid(uuid);
        if (!doc) continue;
        await doc.update({ [`flags.-=${scope}`]: null });
        count++;
      }
      if (wasLocked) await pack.configure({ locked: true });
    }
    ui.notifications.clear();
    ui.notifications.info(`Removed "${scope}" flags from ${count} compendium documents.`);
  }

  /**
   * Clean all data (settings, world flags, compendium flags) for a single module.
   * @param {string} moduleId - Module namespace to clean.
   * @param {object} report - The scan report.
   */
  static async cleanModule(moduleId, report) {
    await DataSniffer.deleteSettingsForModule(moduleId);
    if (report.flags[moduleId]) await DataSniffer.removeFlagsForScope(moduleId, report);
    if (report.compendiumFlags[moduleId]) await DataSniffer.removeCompendiumFlagsForScope(moduleId, report);
  }

  /**
   * Clean all data for every orphaned namespace in the report.
   * @param {object} report - The scan report.
   */
  static async cleanAllOrphaned(report) {
    const orphanedNamespaces = new Set();
    for (const [ns, data] of Object.entries(report.settings)) if (data.status === 'orphaned') orphanedNamespaces.add(ns);
    for (const [ns, data] of Object.entries(report.flags)) if (data.status === 'orphaned') orphanedNamespaces.add(ns);
    for (const [ns, data] of Object.entries(report.compendiumFlags)) if (data.status === 'orphaned') orphanedNamespaces.add(ns);
    for (const ns of orphanedNamespaces) await DataSniffer.cleanModule(ns, report);
    ui.notifications.clear();
    ui.notifications.info(`Cleaned ${orphanedNamespaces.size} orphaned modules.`);
  }

  /**
   * Clean all data for every inactive namespace in the report.
   * @param {object} report - The scan report.
   */
  static async cleanAllInactive(report) {
    const inactiveNamespaces = new Set();
    for (const [ns, data] of Object.entries(report.settings)) if (data.status === 'inactive') inactiveNamespaces.add(ns);
    for (const [ns, data] of Object.entries(report.flags)) if (data.status === 'inactive') inactiveNamespaces.add(ns);
    for (const [ns, data] of Object.entries(report.compendiumFlags)) if (data.status === 'inactive') inactiveNamespaces.add(ns);
    for (const ns of inactiveNamespaces) await DataSniffer.cleanModule(ns, report);
    ui.notifications.clear();
    ui.notifications.info(`Cleaned ${inactiveNamespaces.size} inactive modules.`);
  }

  /**
   * Delete all stale (unregistered) settings across every namespace.
   * @param {object} report - The scan report.
   */
  static async cleanAllStale(report) {
    let count = 0;
    for (const [, data] of Object.entries(report.settings)) {
      for (const entry of data.entries) {
        if (!entry.isStale) continue;
        const worldSettings = game.settings.storage.get('world');
        const setting = worldSettings.find((s) => s.key === entry.key);
        if (setting) {
          await setting.delete();
          count++;
        }
      }
    }
    ui.notifications.clear();
    ui.notifications.info(`Deleted ${count} stale settings.`);
  }
}
