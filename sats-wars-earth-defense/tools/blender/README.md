# tools/blender (Phase 5)

Planned: Blender Python (bpy) scripts that build RAIJIN-01 and NULL CORE part by part (head, torso, core,
shoulderL/R, upperArmL/R, forearmL/R, cannonL/R, pelvis, thighL/R, shinL/R, footL/R, backpack, thrusters,
shieldEmitter), keep metal and emissive parts on separate materials, render previews and export GLB to
`assets/game/`, then optimise with glTF Transform.

Not run yet: this development container has no Blender CLI. Required command once installed:

```bash
blender --background --python tools/blender/build_raijin.py -- --out assets/game/raijin.glb
```

Check after export: node names match the list above (the display animates them by name), triangle count
50k–120k for the hero, textures 2K, and a preview render committed to `docs/qa/`.
