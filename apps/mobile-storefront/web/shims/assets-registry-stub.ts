// Web replacement for @react-native/assets-registry. The native
// package tracks require()'d local image assets via an integer asset
// ID system that the Metro bundler emits. On web, images come from
// URL strings ({uri: 'https://...'}) and Vite handles any local
// imports directly via its asset pipeline, so the registry isn't
// needed at runtime.
//
// We export the API surface as no-ops so consumers (mostly react-
// native-web internals) don't crash on call.

export interface AssetType {
  __packager_asset?: boolean;
  width?: number;
  height?: number;
  uri?: string;
  scales?: number[];
  name?: string;
  type?: string;
  hash?: string;
}

let nextId = 1;
const assets: AssetType[] = [];

export function registerAsset(asset: AssetType): number {
  assets.push(asset);
  return nextId++;
}

export function getAssetByID(id: number): AssetType | undefined {
  return assets[id - 1];
}

export default {registerAsset, getAssetByID};
