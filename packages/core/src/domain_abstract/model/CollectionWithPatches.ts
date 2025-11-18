// packages/core/src/domain_abstract/model/CollectionWithPatches.ts
import { Collection, Model, AddOptions, RemoveOptions } from '../../common';
import { getFi } from '../../utils/fractionalIndex';

export default class CollectionWithPatches<T extends Model = Model> extends Collection<T> {
  fractionalMap?: Map<string, T>;
  private fractionalKeys?: Map<string, string>;

  constructor(models?: any, options?: any) {
    super(models, options);
    this.rebuildFractionalMap();
  }

  // ───────────────────────────────────────────────────────────
  // add: перегрузки такие же, как в Collection<T>
  // ───────────────────────────────────────────────────────────
  add(model: {} | T, options?: AddOptions): T;
  add(models: ({} | T)[], options?: AddOptions): T[];
  add(models: {} | T | ({} | T)[], options?: AddOptions): T | T[] {
    const result = super.add(models as any, options) as T | T[] | undefined;

    if (result) {
      this.addToFractional(result);
    }

    return result as T | T[];
  }

  // ───────────────────────────────────────────────────────────
  // remove: перегрузки такие же, как в Collection<T>
  // ───────────────────────────────────────────────────────────
  remove(model: {} | T, options?: RemoveOptions): T;
  remove(models: ({} | T)[], options?: RemoveOptions): T[];
  remove(models: {} | T | ({} | T)[], options?: RemoveOptions): T | T[] {
    const result = super.remove(models as any, options) as T | T[] | undefined;

    if (result) {
      this.removeFromFractional(result);
    }

    return result as T | T[];
  }

  reset(models?: any, options?: any) {
    const result = super.reset(models, options);
    this.rebuildFractionalMap();
    return result;
  }

  protected addToFractional(models: T | T[]) {
    const list = Array.isArray(models) ? models : [models];
    list.forEach((model) => this.setFractionalEntry(model));
  }

  protected ensureFractionalStorage() {
    if (!this.fractionalMap) {
      this.fractionalMap = new Map<string, T>();
    }
    if (!this.fractionalKeys) {
      this.fractionalKeys = new Map<string, string>();
    }
  }

  protected removeFromFractional(models: T | T[]) {
    const list = Array.isArray(models) ? models : [models];
    list.forEach((model) => {
      this.ensureFractionalStorage();
      const key = this.fractionalKeys?.get(model.cid);
      if (key) {
        this.fractionalMap?.delete(key);
        this.fractionalKeys?.delete(model.cid);
      }
    });
  }

  protected rebuildFractionalMap() {
    this.ensureFractionalStorage();
    this.fractionalMap!.clear();
    this.fractionalKeys!.clear();
    this.models.forEach((model) => this.setFractionalEntry(model as T));
  }

  protected getFractionalKey(model: T) {
    const fi = getFi(model as any);
    return typeof fi === 'number' ? `${fi}` : model.cid;
  }

  protected setFractionalEntry(model: T) {
    const key = this.getFractionalKey(model);
    const prevKey = this.fractionalKeys?.get(model.cid);
    if (prevKey && prevKey !== key) {
      this.fractionalMap?.delete(prevKey);
    }
    this.ensureFractionalStorage();
    this.fractionalKeys!.set(model.cid, key);
    this.fractionalMap!.set(key, model);
  }

  refreshFractionalEntry(model: T) {
    this.setFractionalEntry(model);
  }

  getAndSortFractionalMap() {
    const entries: [string, T][] = [];
    this.fractionalMap?.forEach((value, key) => entries.push([key, value]));
    entries.sort(([aKey], [bKey]) => {
      const a = Number(aKey);
      const b = Number(bKey);
      const aIsNum = !Number.isNaN(a);
      const bIsNum = !Number.isNaN(b);
      if (!aIsNum && !bIsNum) return 0;
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
    return this.fractionalKeys?.get(cid);
  }
}
