# Landing card and XR entry

- Bottom card in the 2D page: name, one line pitch, "Enter mixed reality" button, Quest note.
- The button is enabled only after `navigator.xr.isSessionSupported` says yes: `immersive-ar` first, `immersive-vr` as fallback.
- Without WebXR the button is hidden and the card says to open the page in the Meta Quest Browser.
- The card hides while an XR session is visible.
- Found by Bombadil: before the fix, clicking on a desktop browser without AR logged `NotSupportedError`.
