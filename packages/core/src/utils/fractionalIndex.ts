// packages/core/src/utils/fractionalIndex.ts
import type Components from '../dom_components/model/Components';
import type Component from '../dom_components/model/Component';

export const FI_ATTR = 'fiIndex';
export const FI_STEP = 1024;

const fiStore = new WeakMap<Component, number>();

export const getFi = (cmp?: Component | null): number | undefined => {
  if (!cmp) return undefined;
  return fiStore.get(cmp);
};

export const setFi = (cmp: Component, value: number) => {
  fiStore.set(cmp, value);
};

export const reindexCollection = (coll: Components, step = FI_STEP) => {
  const models = coll.models as Component[];
  models.forEach((m, idx) => {
    setFi(m, idx * step);
  });
};

export const computeBetween = (coll: Components, inserted: Component, step = FI_STEP): void => {
  const idx = coll.indexOf(inserted);
  const prev = idx > 0 ? (coll.at(idx - 1) as Component) : null;
  const next = idx < coll.length - 1 ? (coll.at(idx + 1) as Component) : null;

  const prevFi = getFi(prev);
  const nextFi = getFi(next);

  let value: number;

  if (prevFi == null && nextFi == null) {
    value = 0;
  } else if (prevFi == null && nextFi != null) {
    value = nextFi - step;
  } else if (prevFi != null && nextFi == null) {
    value = prevFi + step;
  } else {
    const mid = Math.floor((prevFi! + nextFi!) / 2);

    if (mid === prevFi || mid === nextFi) {
      reindexCollection(coll, step);
      return computeBetween(coll, inserted, step);
    }

    value = mid;
  }

  setFi(inserted, value);
};

export const ensureFiForCollection = (coll: Components, step = FI_STEP) => {
  let needsReindex = false;
  const models = coll.models as Component[];

  for (const m of models) {
    if (getFi(m) == null) {
      needsReindex = true;
      break;
    }
  }

  if (needsReindex) {
    reindexCollection(coll, step);
  }
};
