import {
  DirectionalLight,
  HemisphereLight,
  SessionMode,
  VisibilityState,
  World,
} from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { BlockSystem } from './blocks.js';
import { BoardSystem, board } from './board.js';
import { CheckSystem } from './check.js';
import { TutorialSystem } from './tutorial.js';
import { UISystem } from './ui.js';
import { bus, game } from './state.js';

(window as any).__dailyStack = { game, bus, board };

const container = document.getElementById('scene-container') as HTMLDivElement;

/** Soft warm key light plus sky fill so the small blocks never read as black. */
function addLights(world: World): void {
  const key = new DirectionalLight(0xfff1dc, 1.2);
  key.name = 'keyLight';
  key.position.set(0.5, 1.5, 1.1);
  world.scene.add(key);

  const ambient = new HemisphereLight(0xe6efff, 0x2b2d33, 0.6);
  ambient.name = 'ambientLight';
  world.scene.add(ambient);
}

/** Browser-only landing card: Enter XR, or the Quest-browser note on desktops. */
function wireLanding(world: World): void {
  const landing = document.getElementById('landing');
  const enter = document.getElementById('enter-xr') as HTMLButtonElement | null;
  const fallback = document.getElementById('landing-fallback');

  const showFallback = (): void => {
    if (enter) enter.hidden = true;
    if (fallback) fallback.hidden = false;
  };

  const enable = (onClick: () => void): void => {
    if (!enter) return;
    enter.disabled = false;
    enter.addEventListener('click', onClick);
  };

  if (!world.xrEnabled) {
    showFallback();
  } else {
    if (enter) enter.disabled = true;
    void (async () => {
      const xr = (navigator as any).xr;
      const ar = await xr?.isSessionSupported?.('immersive-ar').catch(() => false);
      const vr = await xr?.isSessionSupported?.('immersive-vr').catch(() => false);
      if (ar) {
        enable(() => {
          world.launchXR();
        });
      } else if (vr) {
        enable(() => {
          world.launchXR({ sessionMode: SessionMode.ImmersiveVR });
        });
      } else {
        showFallback();
      }
    })();
  }

  if (!landing) return;
  const apply = (state: VisibilityState): void => {
    landing.classList.toggle('is-hidden', state !== VisibilityState.NonImmersive);
  };
  apply(world.visibilityState.peek());
  world.visibilityState.subscribe(apply);
}

void World.create(container, projectOptions).then((world) => {
  addLights(world);

  world.registerSystem(BoardSystem);
  world.registerSystem(BlockSystem);
  world.registerSystem(CheckSystem);
  world.registerSystem(UISystem);
  world.registerSystem(TutorialSystem);

  wireLanding(world);
});
