import { result } from 'underscore';
import { createId } from '../../utils/mixins';
import ModelWithPatches from '../../patch_manager/ModelWithPatches';

/**
 * @property {String} type Asset type, eg. `'image'`.
 * @property {String} src Asset URL, eg. `'https://.../image.png'`.
 *
 * @module docsjs.Asset
 */
export default class Asset extends ModelWithPatches {
  constructor(attributes: any = {}, opts: { em?: any } = {}) {
    const em = (opts as any).em;
    let attrs = attributes;

    if (em?.Patches?.isEnabled && attrs && typeof attrs === 'object' && !('id' in attrs)) {
      attrs = { ...attrs, id: createId() };
    }

    super(attrs as any, opts as any);
  }

  static getDefaults() {
    return result(this.prototype, 'defaults');
  }

  defaults() {
    return {
      type: '',
      src: '',
    };
  }

  /**
   * Get asset type.
   * @returns {String}
   * @example
   * // Asset: { src: 'https://.../image.png', type: 'image' }
   * asset.getType(); // -> 'image'
   * */
  getType() {
    return this.get('type');
  }

  /**
   * Get asset URL.
   * @returns {String}
   * @example
   * // Asset: { src: 'https://.../image.png'  }
   * asset.getSrc(); // -> 'https://.../image.png'
   * */
  getSrc() {
    return this.get('src') || '';
  }

  /**
   * Get filename of the asset (based on `src`).
   * @returns {String}
   * @example
   * // Asset: { src: 'https://.../image.png' }
   * asset.getFilename(); // -> 'image.png'
   * // Asset: { src: 'https://.../image' }
   * asset.getFilename(); // -> 'image'
   * */
  getFilename() {
    return this.getSrc().split('/').pop().split('?').shift();
  }

  /**
   * Get extension of the asset (based on `src`).
   * @returns {String}
   * @example
   * // Asset: { src: 'https://.../image.png' }
   * asset.getExtension(); // -> 'png'
   * // Asset: { src: 'https://.../image' }
   * asset.getExtension(); // -> ''
   * */
  getExtension() {
    return this.getFilename().split('.').pop();
  }

  protected getPatchObjectId(): string | number | undefined {
    return this.get('id') || super.getPatchObjectId();
  }
}

Asset.prototype.idAttribute = 'src';
Asset.prototype.patchObjectType = 'asset';
