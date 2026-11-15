import { createComponent, Types } from '@iwsdk/core';

export const Block = createComponent('Block', {
  pieceId: { type: Types.Int32, default: -1 },
  kind: { type: Types.Int8, default: 0 },
  color: { type: Types.Int32, default: 0 },
  placed: { type: Types.Boolean, default: false },
  gx: { type: Types.Int32, default: 0 },
  gy: { type: Types.Int32, default: 0 },
  gz: { type: Types.Int32, default: 0 },
  rot: { type: Types.Int8, default: 0 },
});

export const UIButton = createComponent('UIButton', {
  action: { type: Types.String, default: '' },
});
