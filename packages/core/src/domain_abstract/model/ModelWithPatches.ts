// src/domain_abstract/model/ModelWithPatches.ts
import Backbone from 'backbone';
import { enablePatches, produceWithPatches, Patch as ImmerPatch } from 'immer';
import type { JsonPatch } from '../../patch_manager/types';

enablePatches();

const PATCH_PATH_BLACKLIST = [
  /^\/traits\b/,
  /^\/__data_values\b/,
  /^\/docEl\b/,
  /^\/head\b/,
  /^\/toolbar\b/,
  /^\/selectors\b/,
];

const isBlacklistedPath = (path: string) => PATCH_PATH_BLACKLIST.some((rx) => rx.test(path));

const snapshotModel = (model: any) => {
  const res: any = {};
  const attrs = model?.attributes || {};
  Object.keys(attrs).forEach((key) => {
    res[key] = snapshotValue(attrs[key]);
  });
  return res;
};

const snapshotValue = (value: any): any => {
  if (value == null) return value;
  if ((value as any).models) {
    return (value as any).models.map((m: any) => snapshotModel(m));
  }
  if ((value as any).attributes) {
    return snapshotModel(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => snapshotValue(item));
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
  return value;
};

const escapeJsonPointer = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

const toPointer = (path: (string | number)[]) => path.map((seg) => escapeJsonPointer(String(seg))).join('/');

const getEditor = (model: any) => {
  try {
    return model?._module?.em || model?.em;
  } catch {
    return undefined;
  }
};

const getPatchManager = (model: any) => getEditor(model)?.Patches;

export default class ModelWithPatches<T extends Backbone.ObjectHash = any, S = any, E = any> extends Backbone.Model<
  T,
  S,
  E
> {
  patchObjectType = '';
  patchTrackedKeys?: string[];
  patchIgnoredKeys?: string[];

  set(key: any, val?: any, opts?: any) {
    const props = typeof key === 'string' ? { [key]: val } : key;
    const options = (typeof key === 'string' ? opts : val) || {};
    const em = getEditor(this as any);
    const P = getPatchManager(this);
    const editorSkip = !!(em && (em as any).__skip);

    if (
      !P?.canTrack?.() ||
      editorSkip ||
      !this.patchObjectType ||
      options.fromUndo ||
      options.noUndo ||
      options.avoidStore ||
      options._skipPatches ||
      options.partial ||
      options.temporary
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

    const before = snapshotModel(this);
    const result = super.set(props, options);
    const after = snapshotModel(this);
    const basePath = this.getPatchBasePath();
    if (!basePath) {
      return result;
    }

    const tuple = produceWithPatches(before, (draft: any) => {
      Object.keys(draft).forEach((key) => {
        if (!(key in after)) {
          delete draft[key];
        }
      });
      Object.keys(after).forEach((key) => {
        draft[key] = after[key];
      });
    }) as unknown as [any, ImmerPatch[], ImmerPatch[]];
    const [, nextPatches, inversePatches] = tuple;
    const changes = this.toJsonPatches(nextPatches, basePath, keys);
    const reverseChanges = this.toJsonPatches(inversePatches, basePath, keys);

    if (changes.length && reverseChanges.length) {
      P.collect(changes, reverseChanges);
    }

    return result;
  }

  private getPatchBasePath() {
    const type = this.patchObjectType;
    const id = (this as any).getId?.() ?? this.id ?? (this as any).cid;
    return type && id ? `/${type}/${id}` : '';
  }

  private toJsonPatches(list: ImmerPatch[], basePath: string, allowedKeys: string[]): JsonPatch[] {
    const allowed = new Set(allowedKeys);
    const mapped: JsonPatch[] = [];

    list.forEach((patch) => {
      const pathArr = patch.path || [];
      const relativePath = pathArr.length ? `/${toPointer(pathArr)}` : '';
      const rootKey = pathArr.length ? String(pathArr[0]) : '';

      if (rootKey && !allowed.has(rootKey)) return;
      if (isBlacklistedPath(relativePath)) return;

      const path = `${basePath}${relativePath}`;
      switch (patch.op) {
        case 'add':
          mapped.push({ op: 'add', path, value: patch.value });
          break;
        case 'replace':
          mapped.push({ op: 'replace', path, value: patch.value });
          break;
        case 'remove':
          mapped.push({ op: 'remove', path });
          break;
      }
    });

    return mapped;
  }
}
