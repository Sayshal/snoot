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
    ui.notifications.success('SNOOT.Scan.Complete', { localize: true, duration: 3000 });
    DataSniffer.#warnOrphanedFlags(flags, compendiumFlags);
    return { settings, flags, compendiumFlags };
  }

  /**
   * Log a console warning for any flag scopes whose module is not installed.
   * @param {object} worldFlags - World flags grouped by scope.
   * @param {object} compendiumFlags - Compendium flags grouped by scope.
   * @private
   */
  static #warnOrphanedFlags(worldFlags, compendiumFlags) {
    for (const [type, scopes] of [
      ['world', worldFlags],
      ['compendium', compendiumFlags]
    ]) {
      for (const [scope, data] of Object.entries(scopes)) {
        if (data.status !== 'orphaned') continue;
        console.warn(`Snoot | Orphaned ${type} flag scope "${scope}" (${data.documents.length} documents)`);
      }
    }
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
      ui.notifications.warn('SNOOT.Notify.SettingNotFound', { localize: true, format: { key } });
      return;
    }
    await setting.delete();
    ui.notifications.clear();
    ui.notifications.info('SNOOT.Notify.DeletedSetting', { localize: true, format: { key } });
  }

  /**
   * Delete all world settings for a given namespace.
   * @param {string} namespace - Module namespace to delete settings for.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.silent] - Suppress progress/info notifications.
   */
  static async deleteSettingsForModule(namespace, { silent = false } = {}) {
    const worldSettings = game.settings.storage.get('world');
    const toDelete = worldSettings.filter((s) => s.key.startsWith(`${namespace}.`));
    const progress = silent ? null : ui.notifications.info('SNOOT.Progress.DeletingSettings', { localize: true, progress: true });
    let done = 0;
    for (const setting of toDelete) {
      await setting.delete();
      done++;
      progress?.update({ pct: toDelete.length ? done / toDelete.length : 1, message: setting.key });
    }
    if (silent) return;
    ui.notifications.clear();
    ui.notifications.success('SNOOT.Notify.DeletedSettings', { localize: true, format: { count: toDelete.length, namespace }, duration: 3000 });
  }

  /**
   * Remove all flags of a scope from a single document.
   * @param {Document} doc - The Foundry document to update.
   * @param {string} scope - Flag scope to remove.
   */
  static async removeFlagsFromDocument(doc, scope) {
    await doc.update({ flags: { [scope]: _del } });
    ui.notifications.clear();
    ui.notifications.info('SNOOT.Notify.RemovedFlagsFrom', { localize: true, format: { scope, name: doc.name || doc.uuid } });
  }

  /**
   * Batch-remove a flag scope from resolved documents, grouped into one write per collection.
   * @param {Document[]} docs - Resolved documents to update.
   * @param {string} scope - Flag scope to remove.
   * @returns {Promise<number>} Count of documents updated.
   * @private
   */
  static async #removeFlagFromDocuments(docs, scope) {
    const topLevel = new Map();
    const embedded = new Map();
    for (const doc of docs) {
      const update = { _id: doc.id, flags: { [scope]: _del } };
      if (doc.parent) {
        const key = `${doc.parent.uuid}|${doc.documentName}`;
        if (!embedded.has(key)) embedded.set(key, { parent: doc.parent, name: doc.documentName, updates: [] });
        embedded.get(key).updates.push(update);
      } else {
        const key = `${doc.documentName}|${doc.pack ?? ''}`;
        if (!topLevel.has(key)) topLevel.set(key, { cls: doc.constructor, pack: doc.pack ?? null, updates: [] });
        topLevel.get(key).updates.push(update);
      }
    }
    let count = 0;
    for (const { cls, pack, updates } of topLevel.values()) {
      try {
        await cls.updateDocuments(updates, pack ? { pack } : {});
        count += updates.length;
      } catch (err) {
        console.error(`Snoot | Failed to remove "${scope}" flags from ${updates.length} ${cls.documentName} document(s)`, err);
      }
    }
    for (const { parent, name, updates } of embedded.values()) {
      try {
        await parent.updateEmbeddedDocuments(name, updates);
        count += updates.length;
      } catch (err) {
        console.error(`Snoot | Failed to remove "${scope}" flags from ${updates.length} embedded ${name} document(s) on ${parent.uuid}`, err);
      }
    }
    return count;
  }

  /**
   * Drop a flag scope from a pack's cached in-memory index so a rescan reflects the deletion.
   * @param {object} pack - The compendium pack.
   * @param {Document[]} docs - Documents whose flags were just removed.
   * @param {string} scope - Flag scope that was removed.
   * @private
   */
  static #purgeIndexFlag(pack, docs, scope) {
    for (const doc of docs) {
      if (doc.parent) {
        const child = pack.index.get(doc.parent.id)?.[doc.collectionName]?.find((c) => c._id === doc.id);
        delete child?.flags?.[scope];
      } else {
        delete pack.index.get(doc.id)?.flags?.[scope];
      }
    }
  }

  /**
   * Remove all flags of a scope from every flagged world document in the report.
   * @param {string} scope - Flag scope to remove.
   * @param {object} report - The scan report.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.silent] - Suppress progress/info notifications.
   */
  static async removeFlagsForScope(scope, report, { silent = false } = {}) {
    const entries = report.flags[scope]?.documents ?? [];
    const progress = silent ? null : ui.notifications.info('SNOOT.Progress.RemovingFlags', { localize: true, progress: true });
    const docs = [];
    for (const entry of entries) {
      const doc = await fromUuid(entry.uuid);
      if (doc) docs.push(doc);
    }
    const count = await DataSniffer.#removeFlagFromDocuments(docs, scope);
    progress?.update({ pct: 1 });
    if (silent) return;
    ui.notifications.clear();
    ui.notifications.success('SNOOT.Notify.RemovedFlags', { localize: true, format: { scope, count }, duration: 3000 });
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
      ui.notifications.error('SNOOT.Notify.DocNotFound', { localize: true, format: { uuid } });
      return;
    }
    const pack = doc.compendium;
    const wasLocked = pack.locked;
    await pack.configure({ locked: false });
    await doc.update({ flags: { [scope]: _del } });
    if (wasLocked) await pack.configure({ locked: true });
    ui.notifications.clear();
    ui.notifications.info('SNOOT.Notify.RemovedFlagsFrom', { localize: true, format: { scope, name: doc.name || uuid } });
  }

  /**
   * Remove all flags of a scope from every compendium document in the report. Handles pack lock/unlock.
   * @param {string} scope - Flag scope to remove.
   * @param {object} report - The scan report.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.silent] - Suppress progress/info notifications.
   */
  static async removeCompendiumFlagsForScope(scope, report, { silent = false } = {}) {
    const entries = report.compendiumFlags[scope]?.documents ?? [];
    const byPack = {};
    for (const entry of entries) {
      if (!byPack[entry.packCollection]) byPack[entry.packCollection] = [];
      byPack[entry.packCollection].push(entry.uuid);
    }
    const packEntries = Object.entries(byPack);
    const total = packEntries.length;
    const progress = silent ? null : ui.notifications.info('SNOOT.Progress.RemovingCompendiumFlags', { localize: true, progress: true });
    let count = 0;
    let done = 0;
    for (const [collection, uuids] of packEntries) {
      const pack = game.packs.get(collection);
      done++;
      if (!pack) {
        progress?.update({ pct: total ? done / total : 1 });
        continue;
      }
      progress?.update({ pct: total ? done / total : 1, message: game.i18n.format('SNOOT.Progress.Pack', { label: pack.metadata.label }) });
      const wasLocked = pack.locked;
      await pack.configure({ locked: false });
      const docs = [];
      for (const uuid of uuids) {
        const doc = await fromUuid(uuid);
        if (doc) docs.push(doc);
      }
      count += await DataSniffer.#removeFlagFromDocuments(docs, scope);
      DataSniffer.#purgeIndexFlag(pack, docs, scope);
      if (wasLocked) await pack.configure({ locked: true });
    }
    if (silent) return;
    ui.notifications.clear();
    ui.notifications.success('SNOOT.Notify.RemovedCompendiumFlags', { localize: true, format: { scope, count }, duration: 3000 });
  }

  /**
   * Clean all data (settings, world flags, compendium flags) for a single module.
   * @param {string} moduleId - Module namespace to clean.
   * @param {object} report - The scan report.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.silent] - Suppress progress/info notifications.
   */
  static async cleanModule(moduleId, report, { silent = false } = {}) {
    const progress = silent ? null : ui.notifications.info('SNOOT.Progress.CleaningModule', { localize: true, progress: true });
    progress?.update({ pct: 0, message: game.i18n.localize('SNOOT.Progress.Stage.Settings') });
    await DataSniffer.deleteSettingsForModule(moduleId, { silent: true });
    progress?.update({ pct: 0.34, message: game.i18n.localize('SNOOT.Progress.Stage.WorldFlags') });
    if (report.flags[moduleId]) await DataSniffer.removeFlagsForScope(moduleId, report, { silent: true });
    progress?.update({ pct: 0.67, message: game.i18n.localize('SNOOT.Progress.Stage.CompendiumFlags') });
    if (report.compendiumFlags[moduleId]) await DataSniffer.removeCompendiumFlagsForScope(moduleId, report, { silent: true });
    progress?.update({ pct: 1 });
    if (silent) return;
    ui.notifications.clear();
    ui.notifications.success('SNOOT.Notify.CleanedModule', { localize: true, format: { module: moduleId }, duration: 3000 });
  }

  /**
   * Clean all data for every namespace of a given status in the report.
   * @param {object} report - The scan report.
   * @param {'orphaned'|'inactive'} status - Status to filter by.
   * @param {string} startMessageKey - Localization key for the initial progress message.
   * @param {string} completeMessageKey - Localization key for the final success notification.
   * @private
   */
  static async #cleanAllByStatus(report, status, startMessageKey, completeMessageKey) {
    const namespaces = new Set();
    for (const [ns, data] of Object.entries(report.settings)) if (data.status === status) namespaces.add(ns);
    for (const [ns, data] of Object.entries(report.flags)) if (data.status === status) namespaces.add(ns);
    for (const [ns, data] of Object.entries(report.compendiumFlags)) if (data.status === status) namespaces.add(ns);
    const total = namespaces.size;
    const progress = ui.notifications.info(startMessageKey, { localize: true, progress: true });
    let done = 0;
    for (const ns of namespaces) {
      progress.update({ pct: total ? done / total : 1, message: game.i18n.format('SNOOT.Progress.Module', { module: ns }) });
      await DataSniffer.cleanModule(ns, report, { silent: true });
      done++;
    }
    progress.update({ pct: 1 });
    ui.notifications.clear();
    ui.notifications.success(completeMessageKey, { localize: true, format: { count: total }, duration: 3000 });
  }

  /**
   * Clean all data for every orphaned namespace in the report.
   * @param {object} report - The scan report.
   */
  static async cleanAllOrphaned(report) {
    await DataSniffer.#cleanAllByStatus(report, 'orphaned', 'SNOOT.Progress.CleaningOrphaned', 'SNOOT.Notify.CleanedOrphaned');
  }

  /**
   * Clean all data for every inactive namespace in the report.
   * @param {object} report - The scan report.
   */
  static async cleanAllInactive(report) {
    await DataSniffer.#cleanAllByStatus(report, 'inactive', 'SNOOT.Progress.CleaningInactive', 'SNOOT.Notify.CleanedInactive');
  }

  /**
   * Delete all stale (unregistered) settings across every namespace.
   * @param {object} report - The scan report.
   */
  static async cleanAllStale(report) {
    const stale = [];
    for (const [, data] of Object.entries(report.settings)) for (const entry of data.entries) if (entry.isStale) stale.push(entry);
    const total = stale.length;
    const progress = ui.notifications.info('SNOOT.Progress.CleaningStale', { localize: true, progress: true });
    const worldSettings = game.settings.storage.get('world');
    let count = 0;
    let done = 0;
    for (const entry of stale) {
      const setting = worldSettings.find((s) => s.key === entry.key);
      done++;
      if (setting) {
        await setting.delete();
        count++;
      }
      progress.update({ pct: total ? done / total : 1, message: entry.key });
    }
    ui.notifications.clear();
    ui.notifications.success('SNOOT.Notify.DeletedStale', { localize: true, format: { count }, duration: 3000 });
  }
}
