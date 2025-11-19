import { Collection, Model } from '../../common';
import { getFi, FI_STEP, setFi } from '../../utils/fractionalIndex';

export default class CollectionWithPatches<T extends Model = Model> extends Collection<T> {
  fractionalMap = new Map<string, T>();
  private fractionalKeys = new Map<string, string>();

  constructor(models?: any, options?: any) {
    super(models, options);

    this.rebuildFractionalMap();

    this.on('add', (model: T) => {
      this.addToFractional(model);
    });

    this.on('remove', (model: T) => {
      this.removeFromFractional(model);
    });

    this.on('reset', () => {
      this.rebuildFractionalMap();
    });
  }

  protected addToFractional(models: T | T[]) {
    const list = Array.isArray(models) ? models : [models];
    list.forEach((model) => this.setFractionalEntry(model));
  }

  protected removeFromFractional(models: T | T[]) {
    const list = Array.isArray(models) ? models : [models];
    list.forEach((model) => {
      const key = this.fractionalKeys.get(model.cid);
      if (key) {
        this.fractionalMap.delete(key);
        this.fractionalKeys.delete(model.cid);
      }
    });
  }

  protected rebuildFractionalMap() {
    this.fractionalMap.clear();
    this.fractionalKeys.clear();

    // Проверяем, что fiIndex'ы нормальные
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

    // Если что-то странное — переиндексируем по текущему порядку
    if (needsNormalize) {
      this.models.forEach((m, idx) => {
        setFi(m as any, idx * FI_STEP);
      });
    }

    // И только потом строим карту
    this.models.forEach((model) => this.setFractionalEntry(model as T));
  }

  protected getFractionalKey(model: T) {
    const fi = getFi(model as any);
    return typeof fi === 'number' ? `${fi}` : (model as any).cid;
  }

  protected setFractionalEntry(model: T) {
    const key = this.getFractionalKey(model);
    const prevKey = this.fractionalKeys.get(model.cid);
    if (prevKey && prevKey !== key) {
      this.fractionalMap.delete(prevKey);
    }
    this.fractionalKeys.set(model.cid, key);
    this.fractionalMap.set(key, model);
  }

  refreshFractionalEntry(model: T) {
    this.setFractionalEntry(model);
  }

  getAndSortFractionalMap() {
    const entries: [string, T][] = [];
    this.fractionalMap.forEach((value, key) => entries.push([key, value]));
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
    return this.fractionalKeys.get(cid);
  }
}
