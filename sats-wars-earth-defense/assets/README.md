# assets

- `source/` — editable originals (Blender files, AI-generated drafts, CC0 downloads) with their licence notes.
- `game/` — files the game serves (GLB, textures, audio, maps), produced from `source/` by `tools/blender` and glTF Transform.

Phase 1 ships no binary assets: RAIJIN-01, the NULL SWARM, the hangar and the battlefield are generated in code
(`apps/display/src/scene/`), and sound is synthesised (`apps/display/src/audio/sfx.ts`). Every file added here must be
registered in `docs/01_asset_register.md` first (source, author, licence, date, modifications, commercial/display check).
