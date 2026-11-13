/**
 * Data scanning and cleanup logic.
 * @module DataSniffer
 * @author Tyler
 */

import { MODULE, SETTINGS } from './constants.mjs';

/** Scans world data and cleans up orphaned module traces. */
export class DataSniffer {
  /** Maximum items written per modifyBatch request. */
  static BATCH_SIZE = 100;

  /**
   * Run a full scan of settings, world flags, compendium flags, and user-scoped data.
   * @returns {Promise<object>} Complete scan report with settings, flags, compendiumFlags, and users keys.
   */
  static async scan() {
    const knownScopes = DataSniffer.#buildKnownScopes();
    const hiddenScopes = DataSniffer.#buildHiddenScopes();
    const users = DataSniffer.#scanUserData(knownScopes, hiddenScopes);
    if (!game.user.isGM) return { settings: {}, flags: {}, compendiumFlags: {}, users };
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
        ATLAS.log(2, `Failed to scan pack "${pack.metadata.label}":`, err);
      }
      completed++;
      progress.update({
        pct: completed / packCount,
        message: _loc('SNOOT.Scan.Pack', { label: pack.metadata.label })
      });
    }
    ui.notifications.clear();
    ui.notifications.success('SNOOT.Scan.Complete', { localize: true, duration: 3000 });
    DataSniffer.#warnOrphanedFlags(flags, compendiumFlags);
    return { settings, flags, compendiumFlags, users };
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
        ATLAS.log(2, `Orphaned ${type} flag scope "${scope}" (${data.documents.length} documents)`);
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
   * Check whether a document's sub-type is registered.
   * @param {string} documentName - Document class name, e.g. 'Item' or 'ActiveEffect'.
   * @param {string} [type] - Stored sub-type value.
   * @returns {boolean} True if the document can never accept a flag removal.
   * @private
   */
  static #isUnremovable(documentName, type) {
    if (!type) return false;
    const types = game.documentTypes[documentName];
    return !!types && !types.includes(type);
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
   * Parse a stored setting into a report entry.
   * @param {string} key - Full setting key, e.g. 'module-id.settingName'.
   * @param {string} rawValue - Serialized setting value.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @returns {object|null} Parsed entry, or null if the key has no namespace.
   * @private
   */
  static #parseSettingEntry(key, rawValue, knownScopes) {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) return null;
    let parsedValue;
    try {
      parsedValue = JSON.parse(rawValue);
    } catch {
      parsedValue = rawValue;
    }
    const namespace = key.substring(0, dotIndex);
    const status = DataSniffer.#classify(namespace, knownScopes);
    const isStale = !DataSniffer.#isSettingRegistered(key);
    return {
      key,
      namespace,
      settingKey: key.substring(dotIndex + 1),
      value: parsedValue,
      displayValue: JSON.stringify(parsedValue),
      status,
      isStale,
      isPendingRegistration: isStale && status === 'system',
      isActiveLeftover: isStale && status === 'active'
    };
  }

  /**
   * Scan world settings storage, grouped by module namespace. User-scoped settings are excluded.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @param {Set<string>} hiddenScopes - Scopes to exclude from results.
   * @returns {object} Settings grouped by namespace with status and entries.
   * @private
   */
  static #scanSettings(knownScopes, hiddenScopes) {
    const byNamespace = {};
    const worldSettings = game.settings.storage.get('world');
    for (const setting of worldSettings) {
      if (setting.user) continue;
      const entry = DataSniffer.#parseSettingEntry(setting.key, setting.value, knownScopes);
      if (!entry || hiddenScopes.has(entry.namespace)) continue;
      if (!byNamespace[entry.namespace]) byNamespace[entry.namespace] = { status: entry.status, entries: [] };
      byNamespace[entry.namespace].entries.push(entry);
    }
    return byNamespace;
  }

  /**
   * Scan User document flags plus user- and client-scoped settings. Non-GMs only see their own user.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @param {Set<string>} hiddenScopes - Scopes to exclude from results.
   * @returns {{users: object[], clientSettings: object[]}} Per-user branches and this client's stored settings.
   * @private
   */
  static #scanUserData(knownScopes, hiddenScopes) {
    const byUser = new Map();
    const branchFor = (userId) => {
      if (!byUser.has(userId)) byUser.set(userId, { id: userId, name: game.users.get(userId)?.name ?? _loc('SNOOT.Users.UnknownUser'), entries: [] });
      return byUser.get(userId);
    };
    const scanned = game.user.isGM ? game.users : [game.user];
    for (const user of scanned) {
      const flags = user._source.flags ?? {};
      for (const scope of Object.keys(flags)) {
        if (hiddenScopes.has(scope)) continue;
        const flagData = flags[scope];
        if (!flagData || typeof flagData !== 'object' || Object.keys(flagData).length === 0) continue;
        branchFor(user.id).entries.push({ kind: 'flag', namespace: scope, status: DataSniffer.#classify(scope, knownScopes), uuid: user.uuid, flagKeys: Object.keys(flagData) });
      }
    }
    for (const setting of game.settings.storage.get('world')) {
      if (!setting.user) continue;
      if (!game.user.isGM && setting.user !== game.user.id) continue;
      const entry = DataSniffer.#parseSettingEntry(setting.key, setting.value, knownScopes);
      if (!entry || hiddenScopes.has(entry.namespace)) continue;
      branchFor(setting.user).entries.push({ ...entry, kind: 'setting', userId: setting.user });
    }
    const storage = game.settings.storage.get('client');
    const clientSettings = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      const entry = DataSniffer.#parseSettingEntry(key, storage.getItem(key), knownScopes);
      if (!entry || hiddenScopes.has(entry.namespace)) continue;
      clientSettings.push({ ...entry, kind: 'client' });
    }
    const users = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { users, clientSettings };
  }

  /**
   * Scan all world documents and their embedded children for flag scopes. User documents are reported separately.
   * @param {Set<string>} knownScopes - All known scope IDs.
   * @param {Set<string>} hiddenScopes - Scopes to exclude from results.
   * @returns {object} Flags grouped by scope with status and document references.
   * @private
   */
  static #scanFlags(knownScopes, hiddenScopes) {
    const byScope = {};
    const processDoc = (doc) => {
      const flags = doc._source.flags;
      if (!flags) return;
      for (const scope of Object.keys(flags)) {
        if (hiddenScopes.has(scope)) continue;
        const flagData = flags[scope];
        if (!flagData || typeof flagData !== 'object' || Object.keys(flagData).length === 0) continue;
        if (!byScope[scope]) byScope[scope] = { status: DataSniffer.#classify(scope, knownScopes), documents: [] };
        byScope[scope].documents.push({
          uuid: doc.uuid,
          name: doc.name || doc.title || doc.label || (doc.documentName === 'ActorDelta' ? doc.parent?.name : null) || '(unnamed)',
          type: doc.documentName,
          collectionName: doc.collectionName,
          flagKeys: Object.keys(flagData)
        });
      }
    };
    const processEmbedded = (doc) => {
      for (const field of Object.values(doc.constructor.hierarchy)) {
        const collection = field.getCollection(doc);
        if (!collection.size) continue;
        for (const child of collection) {
          if (!collection.manages(child.id)) continue;
          processDoc(child);
          processEmbedded(child);
        }
      }
    };
    for (const collection of game.collections) {
      if (collection.documentName === 'User') continue;
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
    for (const name of embeddedNames) fields.push(`${name}.flags`, `${name}.name`, `${name}.type`);
    const index = await pack.getIndex({ fields });
    ATLAS.log(3, `Pack "${pack.metadata.label}" (${pack.collection}) -${index.size} entries, fields: [${fields}]`);
    for (const entry of index) {
      if (entry.flags && Object.keys(entry.flags).length) ATLAS.log(3, `  [${pack.documentName}] ${entry.name} -flag scopes: [${Object.keys(entry.flags)}]`);
      DataSniffer.#processCompendiumEntry(entry, pack.documentName, entry.uuid, pack, knownScopes, hiddenScopes, byScope);
      for (const name of embeddedNames) {
        if (!entry[name]?.length) continue;
        const childType = hierarchy[name].model.documentName;
        for (const child of entry[name]) {
          if (child.flags && Object.keys(child.flags).length) ATLAS.log(3, `    [${childType}] ${child.name || child._id} on "${entry.name}" -flag scopes: [${Object.keys(child.flags)}]`);
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
      byScope[scope].documents.push({
        uuid,
        name: entry.name || '(unnamed)',
        type,
        packCollection: pack.collection,
        packLabel: pack.metadata.label,
        flagKeys: Object.keys(flagData),
        unremovable: DataSniffer.#isUnremovable(type, entry.type)
      });
    }
  }

  /**
   * Delete a single world or user-scoped setting by key.
   * @param {string} key - Full setting key, e.g. 'module-id.settingName'.
   * @param {string|null} [userId] - Owning user ID for user-scoped settings.
   */
  static async deleteSetting(key, userId = null) {
    const worldSettings = game.settings.storage.get('world');
    const setting = worldSettings.find((s) => s.key === key && (s.user ?? null) === (userId || null));
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
   * Delete a single client-scoped setting from this browser's storage.
   * @param {string} key - Full setting key, e.g. 'module-id.settingName'.
   */
  static deleteClientSetting(key) {
    game.settings.storage.get('client').removeItem(key);
    ui.notifications.clear();
    ui.notifications.info('SNOOT.Notify.DeletedSetting', { localize: true, format: { key } });
  }

  /**
   * Create a per-item progress tracker. Each step advances the bar by one item.
   * @param {object|null} bar - Progress notification, or null to only log.
   * @param {number} total - Number of items the bar spans.
   * @returns {{step: Function, note: Function}} Tracker with step(label) and note(message).
   * @private
   */
  static #tracker(bar, total) {
    let done = 0;
    return {
      step: (label) => {
        done++;
        bar?.update({ pct: total ? Math.min(done / total, 1) : 1, message: label });
      },
      note: (message) => {
        bar?.update({ pct: total ? Math.min(done / total, 1) : 1, message });
      }
    };
  }

  /**
   * Count the settings and documents a module clean will touch, matching what cleanModule processes.
   * @param {string} namespace - Module namespace.
   * @param {object} report - The scan report.
   * @param {boolean} includeUserData - Whether user-scoped settings and User flags are included.
   * @returns {number} Item count.
   * @private
   */
  static #countModuleItems(namespace, report, includeUserData) {
    const settings = game.settings.storage.get('world').filter((s) => s.key.startsWith(`${namespace}.`) && (includeUserData || !s.user)).length;
    const worldDocs = report.flags[namespace]?.documents.length ?? 0;
    const packDocs = (report.compendiumFlags[namespace]?.documents ?? []).filter((e) => !e.unremovable).length;
    const userDocs = includeUserData ? (report.users?.users ?? []).filter((b) => b.entries.some((e) => e.kind === 'flag' && e.namespace === namespace)).length : 0;
    return settings + worldDocs + packDocs + userDocs;
  }

  /**
   * Write items through foundry.documents.modifyBatch in chunks. A rejected chunk is retried one item at a time
   * so a single bad document does not drop the rest.
   * @param {object[]} items - Items with action, documentName, parent, pack, data (update object or id), and label.
   * @param {object} tracker - Progress tracker from #tracker.
   * @returns {Promise<{count: number, failed: number}>} Items written and items that could not be written.
   * @private
   */
  static async #writeBatched(items, tracker) {
    const toOperations = (chunk) => {
      const operations = new Map();
      for (const item of chunk) {
        const key = `${item.action}|${item.documentName}|${item.parent?.uuid ?? ''}|${item.pack ?? ''}`;
        if (!operations.has(key)) {
          const operation = { action: item.action, documentName: item.documentName };
          if (item.parent) operation.parent = item.parent;
          if (item.pack) operation.pack = item.pack;
          operation[item.action === 'delete' ? 'ids' : 'updates'] = [];
          operations.set(key, operation);
        }
        const operation = operations.get(key);
        (operation.ids ?? operation.updates).push(item.data);
      }
      return [...operations.values()];
    };
    let count = 0;
    let failed = 0;
    for (let i = 0; i < items.length; i += DataSniffer.BATCH_SIZE) {
      const chunk = items.slice(i, i + DataSniffer.BATCH_SIZE);
      try {
        await foundry.documents.modifyBatch(toOperations(chunk));
        count += chunk.length;
        for (const item of chunk) {
          ATLAS.log(3, `Cleaned ${item.label}`);
          tracker.step(item.label);
        }
        continue;
      } catch (err) {
        ATLAS.log(2, `Batched write of ${chunk.length} item(s) failed; retrying one at a time`, err);
      }
      for (const item of chunk) {
        try {
          await foundry.documents.modifyBatch(toOperations([item]));
          count++;
          ATLAS.log(3, `Cleaned ${item.label}`);
        } catch (err) {
          failed++;
          ATLAS.log(1, `Failed to clean ${item.label}`, err);
        }
        tracker.step(item.label);
      }
    }
    return { count, failed };
  }

  /**
   * Build batch items that delete setting documents.
   * @param {object[]} settings - Setting documents to delete.
   * @returns {object[]} Batch items.
   * @private
   */
  static #settingItems(settings) {
    return settings.map((s) => ({ action: 'delete', documentName: 'Setting', data: s.id, label: s.key }));
  }

  /**
   * Build batch items that remove a flag scope from documents.
   * @param {Document[]} docs - Resolved documents to update.
   * @param {string} scope - Flag scope to remove.
   * @returns {object[]} Batch items.
   * @private
   */
  static #flagItems(docs, scope) {
    return docs.map((doc) => ({
      action: 'update',
      documentName: doc.documentName,
      parent: doc.parent,
      pack: doc.parent ? null : doc.pack,
      data: { _id: doc.id, flags: { [scope]: _del } },
      label: `${scope}: ${doc.name || doc.uuid}`
    }));
  }

  /**
   * Delete all user-scoped settings for a given namespace.
   * @param {string} namespace - Module namespace to delete settings for.
   * @param {object} tracker - Progress tracker.
   * @returns {Promise<{count: number, failed: number}>} Settings deleted and settings that could not be deleted.
   * @private
   */
  static async #deleteUserSettingsForModule(namespace, tracker) {
    const settings = game.settings.storage.get('world').filter((s) => s.user && s.key.startsWith(`${namespace}.`));
    return DataSniffer.#writeBatched(DataSniffer.#settingItems(settings), tracker);
  }

  /**
   * Remove a flag scope from every User document holding it in the report.
   * @param {string} scope - Flag scope to remove.
   * @param {object} report - The scan report.
   * @param {object} tracker - Progress tracker.
   * @returns {Promise<{count: number, failed: number}>} Users updated and users that could not be updated.
   * @private
   */
  static async #removeUserFlagsForScope(scope, report, tracker) {
    const docs = [];
    for (const branch of report.users?.users ?? []) {
      if (!branch.entries.some((e) => e.kind === 'flag' && e.namespace === scope)) continue;
      const user = game.users.get(branch.id);
      if (user) docs.push(user);
    }
    return DataSniffer.#writeBatched(DataSniffer.#flagItems(docs, scope), tracker);
  }

  /**
   * Delete all world settings for a given namespace. User-scoped settings are left alone.
   * @param {string} namespace - Module namespace to delete settings for.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.silent] - Suppress progress/info notifications.
   * @param {object} [options.tracker] - Shared progress tracker from a larger clean.
   * @returns {Promise<{count: number, failed: number}>} Settings deleted and settings that could not be deleted.
   */
  static async deleteSettingsForModule(namespace, { silent = false, tracker = null } = {}) {
    const toDelete = game.settings.storage.get('world').filter((s) => !s.user && s.key.startsWith(`${namespace}.`));
    const bar = silent ? null : ui.notifications.info('SNOOT.Progress.DeletingSettings', { localize: true, progress: true });
    const result = await DataSniffer.#writeBatched(DataSniffer.#settingItems(toDelete), tracker ?? DataSniffer.#tracker(bar, toDelete.length));
    if (silent) return result;
    ui.notifications.clear();
    if (result.failed) ui.notifications.warn('SNOOT.Notify.DeletedSettingsPartial', { localize: true, format: { ...result, namespace }, duration: 5000 });
    else ui.notifications.success('SNOOT.Notify.DeletedSettings', { localize: true, format: { count: result.count, namespace }, duration: 3000 });
    return result;
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
   * Drop a flag scope from a pack's cached in-memory index so a rescan reflects the deletion.
   * @param {object} pack - The compendium pack.
   * @param {Document[]} docs - Documents whose flags were just removed.
   * @param {string} scope - Flag scope that was removed.
   * @private
   */
  static #purgeIndexFlag(pack, docs, scope) {
    for (const doc of docs) {
      if (doc.parent) {
        const collection = pack.index.get(doc.parent.id)?.[doc.collectionName];
        const child = Array.isArray(collection) ? collection.find((c) => c._id === doc.id) : null;
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
   * @param {object} [options.tracker] - Shared progress tracker from a larger clean.
   * @returns {Promise<{count: number, failed: number}>} Documents updated and documents that could not be updated.
   */
  static async removeFlagsForScope(scope, report, { silent = false, tracker = null } = {}) {
    const entries = report.flags[scope]?.documents ?? [];
    const bar = silent ? null : ui.notifications.info('SNOOT.Progress.RemovingFlags', { localize: true, progress: true });
    const docs = [];
    for (const entry of entries) {
      const doc = await fromUuid(entry.uuid);
      if (doc) docs.push(doc);
    }
    const result = await DataSniffer.#writeBatched(DataSniffer.#flagItems(docs, scope), tracker ?? DataSniffer.#tracker(bar, docs.length));
    if (silent) return result;
    ui.notifications.clear();
    if (result.failed) ui.notifications.warn('SNOOT.Notify.RemovedFlagsPartial', { localize: true, format: { scope, ...result }, duration: 5000 });
    else ui.notifications.success('SNOOT.Notify.RemovedFlags', { localize: true, format: { scope, count: result.count }, duration: 3000 });
    return result;
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
   * Remove all flags of a scope from every compendium document in the report.
   * Each pack is processed in chunks: flagged documents are loaded in one request per chunk, then written through modifyBatch.
   * @param {string} scope - Flag scope to remove.
   * @param {object} report - The scan report.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.silent] - Suppress progress/info notifications.
   * @param {object} [options.tracker] - Shared progress tracker from a larger clean.
   * @returns {Promise<{count: number, failed: number}>} Documents updated and documents that could not be updated.
   */
  static async removeCompendiumFlagsForScope(scope, report, { silent = false, tracker = null } = {}) {
    const entries = (report.compendiumFlags[scope]?.documents ?? []).filter((e) => !e.unremovable);
    const byPack = {};
    for (const entry of entries) {
      if (!byPack[entry.packCollection]) byPack[entry.packCollection] = [];
      byPack[entry.packCollection].push(entry.uuid);
    }
    const bar = silent ? null : ui.notifications.info('SNOOT.Progress.RemovingCompendiumFlags', { localize: true, progress: true });
    tracker ??= DataSniffer.#tracker(bar, entries.length);
    let count = 0;
    let failed = 0;
    for (const [collection, uuids] of Object.entries(byPack)) {
      const pack = game.packs.get(collection);
      if (!pack) continue;
      tracker.note(_loc('SNOOT.Progress.Pack', { label: pack.metadata.label }));
      const wasLocked = pack.locked;
      await pack.configure({ locked: false });
      for (let i = 0; i < uuids.length; i += DataSniffer.BATCH_SIZE) {
        const chunk = uuids.slice(i, i + DataSniffer.BATCH_SIZE);
        const primaryIds = [...new Set(chunk.map((uuid) => foundry.utils.parseUuid(uuid)?.primaryId).filter(Boolean))];
        await pack.getDocuments({ _id__in: primaryIds });
        const docs = [];
        for (const uuid of chunk) {
          const doc = await fromUuid(uuid);
          if (doc) docs.push(doc);
        }
        const removed = await DataSniffer.#writeBatched(DataSniffer.#flagItems(docs, scope), tracker);
        count += removed.count;
        failed += removed.failed;
        DataSniffer.#purgeIndexFlag(pack, docs, scope);
      }
      if (wasLocked) await pack.configure({ locked: true });
    }
    const result = { count, failed };
    if (silent) return result;
    ui.notifications.clear();
    if (failed) ui.notifications.warn('SNOOT.Notify.RemovedCompendiumFlagsPartial', { localize: true, format: { scope, ...result }, duration: 5000 });
    else ui.notifications.success('SNOOT.Notify.RemovedCompendiumFlags', { localize: true, format: { scope, count }, duration: 3000 });
    return result;
  }

  /**
   * Clean all data (settings, world flags, compendium flags) for a single module.
   * @param {string} moduleId - Module namespace to clean.
   * @param {object} report - The scan report.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.silent] - Suppress progress/info notifications.
   * @param {boolean} [options.includeUserData] - Also delete user-scoped settings and User document flags.
   * @param {object} [options.tracker] - Shared progress tracker from a larger clean.
   * @returns {Promise<number>} Count of settings and documents that could not be cleaned.
   */
  static async cleanModule(moduleId, report, { silent = false, includeUserData = false, tracker = null } = {}) {
    if (!game.user.isGM) return 0;
    const bar = silent ? null : ui.notifications.info('SNOOT.Progress.CleaningModule', { localize: true, progress: true });
    tracker ??= DataSniffer.#tracker(bar, DataSniffer.#countModuleItems(moduleId, report, includeUserData));
    tracker.note(_loc('ATLAS.Common.Settings'));
    let failed = (await DataSniffer.deleteSettingsForModule(moduleId, { silent: true, tracker })).failed;
    tracker.note(_loc('SNOOT.Progress.Stage.WorldFlags'));
    if (report.flags[moduleId]) failed += (await DataSniffer.removeFlagsForScope(moduleId, report, { silent: true, tracker })).failed;
    tracker.note(_loc('SNOOT.Progress.Stage.CompendiumFlags'));
    if (report.compendiumFlags[moduleId]) failed += (await DataSniffer.removeCompendiumFlagsForScope(moduleId, report, { silent: true, tracker })).failed;
    if (includeUserData) {
      tracker.note(_loc('SNOOT.Progress.Stage.UserData'));
      failed += (await DataSniffer.#deleteUserSettingsForModule(moduleId, tracker)).failed;
      failed += (await DataSniffer.#removeUserFlagsForScope(moduleId, report, tracker)).failed;
    }
    if (silent) return failed;
    ui.notifications.clear();
    if (failed) ui.notifications.warn('SNOOT.Notify.CleanedModulePartial', { localize: true, format: { module: moduleId, failed }, duration: 5000 });
    else ui.notifications.success('SNOOT.Notify.CleanedModule', { localize: true, format: { module: moduleId }, duration: 3000 });
    return failed;
  }

  /**
   * Clean all data for every namespace of a given status in the report.
   * @param {object} report - The scan report.
   * @param {'orphaned'|'inactive'} status - Status to filter by.
   * @param {string} startMessageKey - Localization key for the initial progress message.
   * @param {string} completeMessageKey - Localization key for the final success notification.
   * @param {boolean} includeUserData - Also delete user-scoped settings and User document flags.
   * @private
   */
  static async #cleanAllByStatus(report, status, startMessageKey, completeMessageKey, includeUserData) {
    if (!game.user.isGM) return;
    const namespaces = new Set();
    for (const [ns, data] of Object.entries(report.settings)) if (data.status === status) namespaces.add(ns);
    for (const [ns, data] of Object.entries(report.flags)) if (data.status === status) namespaces.add(ns);
    for (const [ns, data] of Object.entries(report.compendiumFlags)) if (data.status === status) namespaces.add(ns);
    if (includeUserData) for (const branch of report.users?.users ?? []) for (const entry of branch.entries) if (entry.status === status) namespaces.add(entry.namespace);
    let totalItems = 0;
    for (const ns of namespaces) totalItems += DataSniffer.#countModuleItems(ns, report, includeUserData);
    const bar = ui.notifications.info(startMessageKey, { localize: true, progress: true });
    const tracker = DataSniffer.#tracker(bar, totalItems);
    let failed = 0;
    for (const ns of namespaces) {
      tracker.note(_loc('SNOOT.Progress.Module', { module: ns }));
      failed += await DataSniffer.cleanModule(ns, report, { silent: true, includeUserData, tracker });
    }
    bar.update({ pct: 1 });
    ui.notifications.clear();
    if (failed) ui.notifications.warn('SNOOT.Notify.CleanedPartial', { localize: true, format: { count: namespaces.size, failed }, duration: 5000 });
    else ui.notifications.success(completeMessageKey, { localize: true, format: { count: namespaces.size }, duration: 3000 });
  }

  /**
   * Clean all data for every orphaned namespace in the report.
   * @param {object} report - The scan report.
   * @param {boolean} [includeUserData] - Also delete user-scoped settings and User document flags.
   */
  static async cleanAllOrphaned(report, includeUserData = false) {
    await DataSniffer.#cleanAllByStatus(report, 'orphaned', 'SNOOT.Progress.CleaningOrphaned', 'SNOOT.Notify.CleanedOrphaned', includeUserData);
  }

  /**
   * Clean all data for every inactive namespace in the report.
   * @param {object} report - The scan report.
   * @param {boolean} [includeUserData] - Also delete user-scoped settings and User document flags.
   */
  static async cleanAllInactive(report, includeUserData = false) {
    await DataSniffer.#cleanAllByStatus(report, 'inactive', 'SNOOT.Progress.CleaningInactive', 'SNOOT.Notify.CleanedInactive', includeUserData);
  }

  /**
   * Delete all stale (unregistered) settings across every namespace.
   * A rejected delete is recorded and the remaining settings are still attempted.
   * @param {object} report - The scan report.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.includeActive] - Also delete stale settings of active modules.
   */
  static async cleanAllStale(report, { includeActive = false } = {}) {
    if (!game.user.isGM) return;
    const staleKeys = new Set();
    for (const data of Object.values(report.settings)) {
      for (const entry of data.entries) if (entry.isStale && !entry.isPendingRegistration && (includeActive || !entry.isActiveLeftover)) staleKeys.add(entry.key);
    }
    const toDelete = game.settings.storage.get('world').filter((s) => !s.user && staleKeys.has(s.key));
    const bar = ui.notifications.info('SNOOT.Progress.CleaningStale', { localize: true, progress: true });
    const { count, failed } = await DataSniffer.#writeBatched(DataSniffer.#settingItems(toDelete), DataSniffer.#tracker(bar, toDelete.length));
    bar.update({ pct: 1 });
    ui.notifications.clear();
    if (failed) ui.notifications.warn('SNOOT.Notify.DeletedStalePartial', { localize: true, format: { count, failed }, duration: 5000 });
    else ui.notifications.success('SNOOT.Notify.DeletedStale', { localize: true, format: { count }, duration: 3000 });
  }
}
