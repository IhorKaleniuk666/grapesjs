import Asset from './Asset';
import AssetImage from './AssetImage';
import AssetImageView from '../view/AssetImageView';
import TypeableCollection from '../../domain_abstract/model/TypeableCollection';
import CollectionWithPatches from '../../patch_manager/CollectionWithPatches';

const TypeableCollectionExt = (CollectionWithPatches as any).extend(TypeableCollection);

export default class Assets extends TypeableCollectionExt<Asset> {}

Assets.prototype.patchObjectType = 'assets';
Assets.prototype.patchObjectId = 'global';

Assets.prototype.types = [
  {
    id: 'image',
    model: AssetImage,
    view: AssetImageView,
    isType(value: string) {
      if (typeof value == 'string') {
        return {
          type: 'image',
          src: value,
        };
      }
      return value;
    },
  },
];
