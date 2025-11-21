import { Model, ObjectHash } from '../../common';
import { getPrevValue } from '../../helpers/getPrevValue';
import type { JsonPatch } from '../../utils/jsonDiff';
import { diffObjects } from '../../utils/jsonDiff';

const PATCH_PATH_BLACKLIST = [/^\/traits\b/, /^\/__data_values\b/, /^\/docEl\b/, /^\/head\b/, /^\/toolbar\b/];

function isBlacklistedPath(path: string) {
  return PATCH_PATH_BLACKLIST.some((rx) => rx.test(path));
}

export default class ModelWithPatches<T extends ObjectHash = any, S = any> extends Model<T, S> {
  patchObjectType = '';
  patchTrackedKeys?: string[];
  patchIgnoredKeys?: string[];

  set(key: any, val?: any, opts?: any) {
    const { em } = this as any;
    const P = em?.Patches;

    const props = typeof key === 'string' ? { [key]: val } : key;
    const options = typeof key === 'string' ? opts || {} : val || {};

    if (
      !P?.isEnabled ||
      (P as any)['isApplyingExternal'] ||
      options.fromUndo ||
      options.noUndo ||
      options.avoidStore ||
      options._skipPatches
    ) {
      return super.set(props, options);
    }

    let keys = Object.keys(props || {});
    if (!keys.length) {
      return super.set(props, options);
    }

    const hasGet = typeof (this as any).get === 'function';
    const undoCfg = hasGet ? (this as any).get('_undo') : undefined;
    const undoExc = hasGet ? (this as any).get('_undoexc') : undefined;

    if (Array.isArray(undoCfg)) {
      keys = keys.filter((k) => undoCfg.includes(k));
    } else if (!undoCfg) {
      keys = [];
    }

    if (Array.isArray(this.patchTrackedKeys) && this.patchTrackedKeys.length) {
      keys = keys.filter((k) => this.patchTrackedKeys!.includes(k));
    }

    if (Array.isArray(this.patchIgnoredKeys) && this.patchIgnoredKeys.length) {
      keys = keys.filter((k) => !this.patchIgnoredKeys!.includes(k));
    }

    if (Array.isArray(undoExc) && undoExc.length) {
      keys = keys.filter((k) => !undoExc.includes(k));
    }

    if (!keys.length) {
      return super.set(props, options);
    }

    const before: any = {};
    let jsonBefore: any;

    try {
      jsonBefore = this.toJSON();
    } catch {
      jsonBefore = this.attributes;
    }

    keys.forEach((k) => {
      before[k] = jsonBefore ? jsonBefore[k] : undefined;
    });

    super.set(props, options);

    const after: any = {};
    let jsonAfter: any;

    try {
      jsonAfter = this.toJSON();
    } catch {
      jsonAfter = this.attributes;
    }

    keys.forEach((k) => {
      after[k] = jsonAfter ? jsonAfter[k] : undefined;
    });

    const rawPatches = diffObjects(before, after);
    if (!rawPatches.length) return this;

    const id = this.id ?? this.cid;
    const type = this.patchObjectType;
    if (!type || !id) return this;

    const forward: JsonPatch[] = [];
    const reverse: JsonPatch[] = [];

    for (const p of rawPatches) {
      if (isBlacklistedPath(p.path)) continue;
      if ((p.op === 'add' || p.op === 'replace') && typeof (p as any).value === 'undefined') continue;

      const prefixed: JsonPatch = { ...p, path: `/${type}/${id}${p.path}` };
      forward.push(prefixed);

      const prevVal = getPrevValue(before, p.path);

      switch (p.op) {
        case 'add':
          reverse.unshift({ op: 'remove', path: prefixed.path });
          break;
        case 'remove':
          reverse.unshift({ op: 'add', path: prefixed.path, value: prevVal });
          break;
        case 'replace':
          reverse.unshift({ op: 'replace', path: prefixed.path, value: prevVal });
          break;
      }
    }

    if (!forward.length || !reverse.length) return this;

    P.collect(forward, reverse);
    return this;
  }
}
