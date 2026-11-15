# Grab and snap

- Each block: `OneHandGrabbable`, `TwoHandsGrabbable` (no scale), `RayInteractable`. Hand pinch grabs (IWSDK default `useHandPinchForGrab`).
- On release over the board: yaw snaps to 90 degrees, x/z to the nearest cell, y drops to the lowest free supported level, 80 ms ease.
- Off the board or no room: glides back to its tray slot with a soft buzz.
- Tray order is shuffled with the daily seed so it never spells the answer.
- Note from emulator testing: the near-grab pointer sits at the palm (grip space), so the tray uses 7.4 cm spacing to keep neighbours apart.
