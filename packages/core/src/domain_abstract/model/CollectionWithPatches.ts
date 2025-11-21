import { Collection, Model } from '../../common';
import { computeBetween, ensureFiForCollection, FI_STEP, getFi, setFi } from '../../utils/fractionalIndex';

const ACTION_MOVE = 'component:move';

type PatchInfo = {
  cid: string;
  key: string;
  path: string;
  value: any;
};

export default class CollectionWithPatches<T extends Model = Model> extends Collection<T> {
  fractionalMap?: Map<string, T>;
  private fractionalKeys?: Map<string, string>;
  private pendingMoves?: Map<string, PatchInfo>;

  constructor(models?: any, options?: any) {
    super(models, options);
    this.rebuildFractionalMap();
  }

  add(models: any, options: any = {}) {
    const added = super.add(models as any, options);
    const list = this.toArrayFromValue(added);
    list.forEach((model) => this.ensureFractionalPosition(model));
    this.recordAdd(list, options);
    return added as any;
  }

  remove(models: any, options: any = {}) {
    const removed = super.remove(models as any, options);
    const list = this.toArrayFromValue(removed);
    const infos = list.map((model) => this.buildPatchInfo(model)).filter(Boolean) as PatchInfo[];
    this.removeFromFractional(list);
    this.recordRemove(infos, options);
    return removed as any;
  }

  reset(models?: any, options: any = {}) {
    const previous = [...this.models];
    const prevInfos = previous.map((m) => this.buildPatchInfo(m)).filter(Boolean) as PatchInfo[];
    const res = super.reset(models, options);
    this.getPendingMoves().clear();
    this.rebuildFractionalMap();
    const nextInfos = this.models.map((m) => this.buildPatchInfo(m)).filter(Boolean) as PatchInfo[];
    this.recordReset(prevInfos, nextInfos, options);
    return res;
  }

  protected recordAdd(models: T[], options: any) {
    const P = this.getPatchManager();
    const isMove = options?.action === ACTION_MOVE;

    const pendingMoves = this.getPendingMoves();
    if (!P?.canTrack?.() || this.shouldSkip(options)) return;

    const forward: any[] = [];
    const reverse: any[] = [];

    models.forEach((model) => {
      const info = this.buildPatchInfo(model);
      if (!info) return;
      const pending = isMove ? pendingMoves.get(info.cid) : null;
      pendingMoves.delete(info.cid);

      if (pending) {
        forward.push({ op: 'move', from: pending.path, path: info.path });
        reverse.unshift({ op: 'move', from: info.path, path: pending.path });
      } else {
        forward.push({ op: 'add', path: info.path, value: info.value });
        reverse.unshift({ op: 'remove', path: info.path });
      }
    });

    forward.length && P.collect(forward, reverse);
  }

  protected recordRemove(infos: PatchInfo[], options: any) {
    const isMove = options?.action === ACTION_MOVE;
    const pendingMoves = this.getPendingMoves();
    infos.forEach((info) => {
      isMove && pendingMoves.set(info.cid, info);
    });

    const P = this.getPatchManager();
    if (!P?.canTrack?.() || this.shouldSkip(options) || isMove) return;

    const forward = infos.map((info) => ({ op: 'remove', path: info.path }));
    const reverse = infos.map((info) => ({ op: 'add', path: info.path, value: info.value })).reverse();
    forward.length && P.collect(forward as any, reverse as any);
  }

  protected recordReset(prev: PatchInfo[], next: PatchInfo[], options: any) {
    const P = this.getPatchManager();
    if (!P?.canTrack?.() || this.shouldSkip(options)) return;

    const forward: any[] = [];
    const reverse: any[] = [];

    prev.forEach((info) => {
      forward.push({ op: 'remove', path: info.path });
      reverse.unshift({ op: 'add', path: info.path, value: info.value });
    });

    next.forEach((info) => {
      forward.push({ op: 'add', path: info.path, value: info.value });
      reverse.unshift({ op: 'remove', path: info.path });
    });

    forward.length && P.collect(forward, reverse);
  }

  protected buildPatchInfo(model?: T | null): PatchInfo | null {
    if (!model) return null;
    const parent = (this as any).parent;
    const objectType = parent?.patchObjectType;
    const objectId = parent?.getId?.() ?? parent?.id ?? parent?.cid;
    const key = this.getFractionalKey(model);

    if (!parent || !objectType || !objectId) return null;

    return {
      cid: model.cid,
      key,
      path: `/${objectType}/${objectId}/components/${key}`,
      value: this.serializeModel(model),
    };
  }

  protected getPatchManager() {
    const scope = this as any;
    return scope?.em?.Patches || scope?.parent?.em?.Patches;
  }

  private ensureFractionalStorage() {
    if (!this.fractionalMap) {
      this.fractionalMap = new Map<string, T>();
    }
    if (!this.fractionalKeys) {
      this.fractionalKeys = new Map<string, string>();
    }
    return {
      fractionalMap: this.fractionalMap,
      fractionalKeys: this.fractionalKeys,
    };
  }

  private getPendingMoves() {
    if (!this.pendingMoves) {
      this.pendingMoves = new Map<string, PatchInfo>();
    }
    return this.pendingMoves;
  }

  protected shouldSkip(options: any = {}) {
    return (
      options.fromUndo ||
      options.avoidStore ||
      options.noUndo ||
      options._skipPatches ||
      options.partial ||
      options.temporary
    );
  }

  protected ensureFractionalPosition(model: T) {
    if (!model) return;
    ensureFiForCollection(this as any);
    computeBetween(this as any, model as any);
    this.refreshFractionalEntry(model);
  }

  protected addToFractional(models: T | T[]) {
    this.ensureFractionalStorage();
    const list = Array.isArray(models) ? models : [models];
    list.forEach((model) => this.setFractionalEntry(model));
  }

  protected removeFromFractional(models: T | T[]) {
    const { fractionalMap, fractionalKeys } = this.ensureFractionalStorage();
    const list = Array.isArray(models) ? models : [models];
    list.forEach((model) => {
      const key = fractionalKeys.get(model.cid);
      if (key) {
        fractionalMap.delete(key);
        fractionalKeys.delete(model.cid);
      }
    });
  }

  protected rebuildFractionalMap() {
    const { fractionalMap, fractionalKeys } = this.ensureFractionalStorage();
    fractionalMap.clear();
    fractionalKeys.clear();

    let needsNormalize = false;
    let lastFi: number | undefined;

    this.models.forEach((m) => {
      const fi = getFi(m as any);
      if (typeof fi !== 'number') {
        needsNormalize = true;
        return;
      }
      if (lastFi != null && fi <= lastFi) {
        needsNormalize = true;
        return;
      }
      lastFi = fi;
    });

    if (needsNormalize) {
      this.models.forEach((m, idx) => {
        setFi(m as any, idx * FI_STEP);
      });
    }

    this.models.forEach((model) => this.setFractionalEntry(model as T));
  }

  protected getFractionalKey(model: T) {
    const fi = getFi(model as any);
    return typeof fi === 'number' ? `${fi}` : this.fractionalKeys?.get(model.cid) || (model as any).cid;
  }

  protected setFractionalEntry(model: T) {
    const { fractionalMap, fractionalKeys } = this.ensureFractionalStorage();
    const key = this.getFractionalKey(model);
    const prevKey = fractionalKeys.get(model.cid);
    if (prevKey && prevKey !== key) {
      fractionalMap.delete(prevKey);
    }
    fractionalKeys.set(model.cid, key);
    fractionalMap.set(key, model);
  }

  refreshFractionalEntry(model: T) {
    this.setFractionalEntry(model);
  }

  getAndSortFractionalMap() {
    const { fractionalMap } = this.ensureFractionalStorage();
    const entries: [string, T][] = [];
    fractionalMap.forEach((value, key) => entries.push([key, value]));
    entries.sort(([aKey], [bKey]) => {
      const a = Number(aKey);
      const b = Number(bKey);
      const aIsNum = !Number.isNaN(a);
      const bIsNum = !Number.isNaN(b);
      if (!aIsNum && !bIsNum) return aKey.localeCompare(bKey);
      if (!aIsNum) return 1;
      if (!bIsNum) return -1;
      return a - b;
    });
    const sorted = new Map<string, T>();
    entries.forEach(([key, value]) => sorted.set(key, value));
    return sorted;
  }

  getFractionalModels() {
    const models: T[] = [];
    this.getAndSortFractionalMap().forEach((value) => models.push(value));
    return models;
  }

  getFractionalKeyByCid(cid: string) {
    return this.ensureFractionalStorage().fractionalKeys.get(cid);
  }

  findByFractionalKey(key: string) {
    return this.ensureFractionalStorage().fractionalMap.get(key);
  }

  setFractionalKey(model: T, key: string) {
    const numeric = Number(key);
    if (!Number.isNaN(numeric)) {
      setFi(model as any, numeric);
    }
    this.refreshFractionalEntry(model);
  }

  getIndexFromFractionalKey(key: string) {
    const map = this.getAndSortFractionalMap();
    const keys: string[] = [];
    map.forEach((_, k) => keys.push(k));
    const target = Number(key);
    const targetIsNum = !Number.isNaN(target);

    for (let i = 0; i < keys.length; i++) {
      const current = keys[i];
      if (current === key) return i;
      const currentNum = Number(current);
      const currentIsNum = !Number.isNaN(currentNum);

      if (targetIsNum && currentIsNum && target < currentNum) return i;
      if (!targetIsNum && !currentIsNum && key.localeCompare(current) < 0) return i;
      if (!targetIsNum && currentIsNum) return keys.length ? i : 0;
    }

    return keys.length;
  }

  private serializeModel(model: any): any {
    const attrs = model?.attributes || {};
    const res: any = {};

    Object.keys(attrs).forEach((key) => {
      res[key] = this.serializeValue(attrs[key]);
    });

    return res;
  }

  private serializeValue(value: any): any {
    if (value == null) return value;
    if ((value as any).models) {
      return (value as any).models.map((m: any) => this.serializeModel(m));
    }
    if ((value as any).attributes) {
      return this.serializeModel(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v));
    }
    if (typeof value === 'object') {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    }
    return value;
  }

  private toArrayFromValue(value: any): T[] {
    if (!value) return [];
    return Array.isArray(value) ? (value as T[]) : [value as T];
  }
}
