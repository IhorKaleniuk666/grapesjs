import { generateNKeysBetween } from 'fractional-indexing';
import { AddOptions, Collection, Model, RemoveOptions } from '../common';
import EditorModel from '../editor/model/Editor';
import PatchManager, { PatchChangeProps, PatchPath } from './index';

type FractionalMap = Record<string, string>;

const toArray = <T>(value: T | T[]) => (Array.isArray(value) ? value : [value]);

const mapsEqual = (first: FractionalMap, second: FractionalMap) => {
  const firstKeys = Object.keys(first);
  if (firstKeys.length !== Object.keys(second).length) return false;

  return firstKeys.every((key) => first[key] === second[key]);
};

const normalizeAt = (at: number | undefined, length: number) => {
  if (typeof at !== 'number') return length;
  const rawIndex = at < 0 ? length + at : at;
  return Math.min(Math.max(rawIndex, 0), length);
};

export default class CollectionWithPatches<T extends Model = Model> extends Collection<T> {
  em?: EditorModel;
  patchObjectType?: string;
  patchObjectId?: string | number;
  private fractionalMap?: FractionalMap;

  protected get patchManager(): PatchManager | undefined {
    const pm = (this.em as any)?.Patches as PatchManager | undefined;
    return pm?.isEnabled && this.patchObjectType ? pm : undefined;
  }

  protected getPatchObjectId(): string | number | undefined {
    return this.patchObjectId ?? (this as any).id ?? (this as any).cid;
  }

  protected getModelId(model: T): string | undefined {
    const id = (model as any).get?.('id') ?? (model as any).id ?? (model as any).cid;
    return id != null ? String(id) : undefined;
  }

  protected getOrderPath(): PatchPath | undefined {
    const objectId = this.getPatchObjectId();
    const type = this.patchObjectType;
    if (!type || objectId == null) return;
    return [type, objectId, 'order'];
  }

  protected ensureFractionalMap(models: T[] = this.models): FractionalMap {
    if (!this.fractionalMap) {
      this.fractionalMap = {};
    }

    if (!Object.keys(this.fractionalMap).length && models.length) {
      this.fractionalMap = this.buildFractionalMap(models);
    }

    return this.fractionalMap;
  }

  protected buildFractionalMap(models: T[]): FractionalMap {
    const map: FractionalMap = {};
    if (!models.length) return map;

    const keys = generateNKeysBetween(null, null, models.length);
    models.forEach((model, index) => {
      const id = this.getModelId(model);
      if (id) map[id] = keys[index];
    });

    return map;
  }

  protected getOrderedModels(): T[] {
    const map = this.ensureFractionalMap();
    const withKeys = this.models.map((model, index) => ({
      model,
      index,
      key: map[this.getModelId(model) || ''],
    }));

    if (!withKeys.some((entry) => entry.key)) {
      return [...this.models];
    }

    withKeys.sort((first, second) => {
      if (!first.key && !second.key) return first.index - second.index;
      if (!first.key) return 1;
      if (!second.key) return -1;
      if (first.key === second.key) return first.index - second.index;
      return first.key < second.key ? -1 : 1;
    });

    return withKeys.map((entry) => entry.model);
  }

  getAndSortFractionalMap(): T[] {
    return this.getOrderedModels();
  }

  getFractionalKey(id: string): string | undefined {
    const map = this.ensureFractionalMap();
    return map[id];
  }

  setFractionalKey(id: string, key: string): void {
    const map = this.ensureFractionalMap();
    map[id] = key;
  }

  removeFractionalKey(id: string): void {
    const map = this.ensureFractionalMap();
    delete map[id];
  }

  setFractionalMap(map: FractionalMap = {}): void {
    this.fractionalMap = { ...map };
  }

  add(models: T | T[], opts: AddOptions = {}): any {
    const incoming = toArray(models);
    const external = (opts as any).external;
    let beforeKey: string | null | undefined;
    let afterKey: string | null | undefined;

    if (incoming.length && !external) {
      const ordered = this.getOrderedModels();
      const map = this.ensureFractionalMap(ordered);
      const insertAt = normalizeAt(opts.at, ordered.length);
      const beforeModel = ordered[insertAt - 1];
      const afterModel = ordered[insertAt];
      beforeKey = beforeModel ? map[this.getModelId(beforeModel) || ''] : null;
      afterKey = afterModel ? map[this.getModelId(afterModel) || ''] : null;
    }

    const result = super.add(models as any, opts as any);
    const added = Array.isArray(result) ? result : result ? [result] : [];
    if (!added.length) return result;

    const map = this.ensureFractionalMap();
    const keys = external ? [] : generateNKeysBetween(beforeKey ?? null, afterKey ?? null, added.length);
    const orderPath = this.getOrderPath();
    const pm = this.patchManager;
    const activePatch = !external && pm && orderPath ? pm.createOrGetCurrentPatch() : undefined;

    added.forEach((model, index) => {
      const id = this.getModelId(model);
      if (!id) return;
      const existingKey = map[id];
      const key = existingKey || keys[index];
      if (!key) return;
      map[id] = key;

      if (activePatch) {
        activePatch.changes.push({ op: 'add', path: [...orderPath, id], value: key });
        activePatch.reverseChanges.unshift({ op: 'remove', path: [...orderPath, id] });
      }
    });

    return result;
  }

  remove(models: T | T[], opts: RemoveOptions = {}): any {
    const incoming = toArray(models);
    const external = (opts as any).external;
    this.ensureFractionalMap();

    const toRemove = incoming
      .map((model) => {
        if (typeof model === 'string' || typeof model === 'number') {
          return this.get(model as any);
        }
        return model;
      })
      .filter(Boolean) as T[];

    const map = this.ensureFractionalMap();
    const removalData = toRemove
      .map((model) => {
        const id = this.getModelId(model);
        return { id, key: id ? map[id] : undefined };
      })
      .filter((entry) => entry.id) as Array<{ id: string; key?: string }>;

    const result = super.remove(models as any, opts as any);
    removalData.forEach((entry) => delete map[entry.id]);

    const orderPath = this.getOrderPath();
    const pm = this.patchManager;
    const activePatch = !external && pm && orderPath ? pm.createOrGetCurrentPatch() : undefined;

    if (activePatch) {
      removalData.forEach((entry) => {
        if (!entry.key) return;
        activePatch.changes.push({ op: 'remove', path: [...orderPath, entry.id] });
        activePatch.reverseChanges.unshift({ op: 'add', path: [...orderPath, entry.id], value: entry.key });
      });
    }

    return result;
  }

  reset(models?: T[], opts: any = {}): this {
    const external = (opts as any).external;
    const prevMap = this.fractionalMap ? { ...this.fractionalMap } : {};
    const result = super.reset(models as any, opts as any);

    this.fractionalMap = this.buildFractionalMap(this.models);
    const nextMap = { ...this.fractionalMap };

    const orderPath = this.getOrderPath();
    const pm = this.patchManager;

    if (!external && pm && orderPath && !mapsEqual(prevMap, nextMap)) {
      const patch = pm.createOrGetCurrentPatch();
      const change: PatchChangeProps = { op: 'replace', path: orderPath, value: nextMap };
      const reverseChange: PatchChangeProps = { op: 'replace', path: orderPath, value: prevMap };
      patch.changes.push(change);
      patch.reverseChanges.unshift(reverseChange);
    }

    return result;
  }
}
