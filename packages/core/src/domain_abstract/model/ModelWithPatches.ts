// src/domain_abstract/model/ModelWithPatches.ts
import { Model, ObjectHash } from '../../common';
import { getPrevValue } from '../../helpers/getPrevValue';
import type { JsonPatch } from '../../utils/jsonDiff';
import { diffObjects } from '../../utils/jsonDiff';

export default class ModelWithPatches<T extends ObjectHash = any, S = any> extends Model<T, S> {
  patchObjectType = ''; // 'component' | 'cssRule' ...

  set(key: any, val?: any, opts?: any) {
    const { em } = this as any;
    const P = em?.Patches;

    // Нормализуем вход сразу, чтобы можно было смотреть options
    const props = typeof key === 'string' ? { [key]: val } : key;
    const options = typeof key === 'string' ? opts || {} : val || {};

    // Условия, когда ПАТЧИ НЕ НУЖНЫ вообще
    if (
      !P?.isEnabled || // менеджер патчей выключен
      (P as any)['isApplyingExternal'] || // сейчас выполняется undo/redo/apply
      options.fromUndo || // спец-операции из UndoManager/внутренние
      options.noUndo || // пометка "не писать в историю"
      options.avoidStore || // то же по смыслу
      options._skipPatches // наш потенциальный escape-хук
    ) {
      return super.set(props, options);
    }

    // Ключи, которые реально меняем (например, 'style', 'attributes' и т.д.)
    const keys = Object.keys(props || {});
    if (!keys.length) {
      return super.set(props, options);
    }

    // ---------- BEFORE ----------
    const before: any = {};
    let jsonBefore: any;

    // Пытаемся использовать toJSON, но если модель ещё "сырая" — откатываемся на attributes
    try {
      jsonBefore = this.toJSON();
    } catch {
      jsonBefore = this.attributes;
    }

    keys.forEach((k) => {
      before[k] = jsonBefore?.[k];
    });

    // Применяем реальное изменение
    super.set(props, options);

    // ---------- AFTER ----------
    const after: any = {};
    let jsonAfter: any;

    try {
      jsonAfter = this.toJSON();
    } catch {
      jsonAfter = this.attributes;
    }

    keys.forEach((k) => {
      after[k] = jsonAfter?.[k];
    });

    // Считаем diff ТОЛЬКО по изменённым ключам
    const rawPatches = diffObjects(before, after);
    if (!rawPatches.length) return this;

    const id = this.id ?? this.cid;
    const type = this.patchObjectType;

    const forward: JsonPatch[] = [];
    const reverse: JsonPatch[] = [];

    for (const p of rawPatches) {
      const prefixed = { ...p, path: `/${type}/${id}${p.path}` };
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

    P.collect(forward, reverse);
    return this;
  }
}
