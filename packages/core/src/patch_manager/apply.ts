import { applyPatches } from 'immer';
import Asset from '../asset_manager/model/Asset';
import Assets from '../asset_manager/model/Assets';
import EditorModel from '../editor/model/Editor';
import { isObject, serialize } from '../utils/mixins';
import { PatchApplyOptions, PatchChangeProps } from './index';

const ASSET_TYPE = 'asset';
const ASSETS_TYPE = 'assets';
const ATTRIBUTES_KEY = 'attributes';
const ORDER_KEY = 'order';

const normalizeId = (value: string | number) => String(value);

const stripPatchPrefix = (change: PatchChangeProps, start: number): PatchChangeProps => ({
  ...change,
  path: change.path.slice(start),
  ...(change.from ? { from: change.from.slice(start) } : {}),
});

export const applyEditorPatches = (em: EditorModel, changes: PatchChangeProps[], options: PatchApplyOptions = {}) => {
  if (!changes.length) return;
  const assets = em.Assets?.getAll?.() as Assets | undefined;
  if (!assets) return;

  const pendingAssets = new Map<string, Asset>();

  const findAssetById = (id: string): Asset | undefined =>
    assets.find((model: Asset) => String(model.get('id')) === id);

  const ensureAssetModel = (id: string): Asset | undefined => {
    let model = findAssetById(id) || pendingAssets.get(id);
    if (!model) {
      model = new Asset({ id }, { em });
      pendingAssets.set(id, model);
    }
    return model;
  };

  const addPendingAsset = (id: string) => {
    if (findAssetById(id)) return;
    const pending = pendingAssets.get(id);
    if (pending) {
      assets.add(pending, { external: true });
      pendingAssets.delete(id);
    }
  };

  const applyAssetAttributesChange = (change: PatchChangeProps) => {
    const path = change.path;
    if (path.length < 3 || path[2] !== ATTRIBUTES_KEY) return;
    const id = normalizeId(path[1] as string | number);
    const model = ensureAssetModel(id);
    if (!model) return;

    const prevAttrs = serialize(model.attributes || {});
    const patch = stripPatchPrefix(change, 3);
    const nextAttrs = applyPatches(prevAttrs, [patch]) as Record<string, any> | undefined;
    const next = nextAttrs && typeof nextAttrs === 'object' ? nextAttrs : {};

    if (!('id' in next)) {
      next.id = id;
    }

    const opts = { external: true };
    Object.keys(prevAttrs).forEach((key) => {
      if (!(key in next)) {
        model.unset(key, opts);
      }
    });
    model.set(next, opts);

    if (assets.getFractionalKey(id)) {
      addPendingAsset(id);
    }
  };

  const applyAssetsOrderChange = (change: PatchChangeProps) => {
    const path = change.path;
    if (path.length < 3 || path[2] !== ORDER_KEY) return;

    if (path.length === 3) {
      if (change.op !== 'replace') return;
      const rawMap = isObject(change.value) ? (change.value as Record<string, unknown>) : {};
      const nextMap: Record<string, string> = {};
      Object.keys(rawMap).forEach((key) => {
        const value = rawMap[key];
        if (value != null) {
          nextMap[String(key)] = String(value);
        }
      });
      assets.setFractionalMap(nextMap);
      const allowedIds = new Set(Object.keys(nextMap));
      pendingAssets.forEach((_, id) => {
        if (!allowedIds.has(id)) {
          pendingAssets.delete(id);
        }
      });
      assets
        .filter((model: Asset) => !allowedIds.has(String(model.get('id'))))
        .forEach((model) => assets.remove(model, { external: true }));
      allowedIds.forEach((id) => addPendingAsset(id));
      return;
    }

    if (path.length === 4) {
      const id = normalizeId(path[3] as string | number);
      if (change.op === 'remove') {
        const model = findAssetById(id);
        if (model) {
          assets.remove(model, { external: true });
        }
        pendingAssets.delete(id);
        assets.removeFractionalKey(id);
        return;
      }

      if (change.value != null) {
        assets.setFractionalKey(id, String(change.value));
      }
      addPendingAsset(id);
    }
  };

  changes.forEach((change) => {
    const path = change.path;
    if (!Array.isArray(path) || !path.length) return;
    const type = path[0];

    if (type === ASSET_TYPE) {
      applyAssetAttributesChange(change);
    } else if (type === ASSETS_TYPE) {
      applyAssetsOrderChange(change);
    }
  });

  if (pendingAssets.size) {
    pendingAssets.forEach((model) => assets.add(model, { external: true }));
    pendingAssets.clear();
  }
};
