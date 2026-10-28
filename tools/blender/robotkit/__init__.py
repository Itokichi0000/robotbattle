"""
robotkit — shared Blender (bpy) helpers for the SATS WARS robot models.

The robots are built entirely from code so they can be regenerated headless in CI
or a cloud container (no GUI, no local Blender install needed):

    blender -b --factory-startup -P tools/blender/build_robot.py -- --robot raijin

Modules:
  compat   Blender 4.0 … 5.x API differences in one place
  geo      bmesh primitive generators (box / tapered box / lathe / torus / prism / loft)
  parts    Part = one editable object bound rigidly to one bone; materials; modifiers
  rig      shared skeleton (bone names = three.js joint names) and skin binding
  texture  UV atlas packing and Cycles bakes (baseColor / ORM / normal / emissive)
  preview  turntable camera + lights, front / side / back / 45° renders
  export   .blend save, GLB export, statistics
"""
