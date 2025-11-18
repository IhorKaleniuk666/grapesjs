// packages/core/src/utils/fractionalIndex.ts
import type Components from '../dom_components/model/Components';
import type Component from '../dom_components/model/Component';

/**
 * Имя поля в модели компонента, где храним дробный индекс.
 * Можно будет поменять/спрятать за toJSON, если понадобится.
 */
export const FI_ATTR = 'fiIndex';

/**
 * Шаг по умолчанию между базовыми индексами.
 * Даёт большой запас для вставок "между".
 */
export const FI_STEP = 1024;

/**
 * Получить текущее значение индекса из компонента.
 */
export const getFi = (cmp?: Component | null): number | undefined => {
  if (!cmp) return undefined;
  const val = (cmp as any).get?.(FI_ATTR);
  return typeof val === 'number' ? val : undefined;
};

/**
 * Установить индекс в компонент.
 */
export const setFi = (cmp: Component, value: number) => {
  // silent: true, чтобы не триггерить лишние события
  (cmp as any).set(FI_ATTR, value, { silent: true });
};

/**
 * Полная переиндексация коллекции:
 * всем элементам проставляем fiIndex = index * FI_STEP.
 */
export const reindexCollection = (coll: Components, step = FI_STEP) => {
  const models = coll.models as Component[];
  models.forEach((m, idx) => {
    setFi(m, idx * step);
  });
};

/**
 * Вычислить новый дробный индекс между prev и next.
 * Если места нет (prev и next слишком близко) — переиндексируем коллекцию
 * и считаем ещё раз.
 */
export const computeBetween = (coll: Components, inserted: Component, step = FI_STEP): void => {
  const idx = coll.indexOf(inserted);
  const prev = idx > 0 ? (coll.at(idx - 1) as Component) : null;
  const next = idx < coll.length - 1 ? (coll.at(idx + 1) as Component) : null;

  const prevFi = getFi(prev);
  const nextFi = getFi(next);

  let value: number;

  if (prevFi == null && nextFi == null) {
    // Первый и единственный элемент
    value = 0;
  } else if (prevFi == null && nextFi != null) {
    // Вставка в начало
    value = nextFi - step;
  } else if (prevFi != null && nextFi == null) {
    // Вставка в конец
    value = prevFi + step;
  } else {
    // Между двумя элементами
    const mid = Math.floor((prevFi! + nextFi!) / 2);

    if (mid === prevFi || mid === nextFi) {
      // Места не осталось — переиндексируем всю коллекцию
      reindexCollection(coll, step);
      return computeBetween(coll, inserted, step);
    }

    value = mid;
  }

  setFi(inserted, value);
};

/**
 * Убедиться, что у всех компонентов есть fiIndex.
 * Полезно для старых документов/тестов.
 */
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
