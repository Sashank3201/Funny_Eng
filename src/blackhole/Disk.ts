import {
  AdditiveBlending,
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
} from 'three';

import { DISK_OUTER, glslPhysicsDefines } from './physics';
import diskVert from './shaders/disk.vert.glsl?raw';
import diskFrag from './shaders/disk.frag.glsl?raw';
import lensingChunk from './shaders/lensing.glsl?raw';
import streakChunk from './shaders/streak.glsl?raw';

/** A unit quad in -0.5..0.5, shared by every particle instance. */
function quadAttributes(geometry: InstancedBufferGeometry): void {
  geometry.setAttribute(
    'aCorner',
    new BufferAttribute(
      new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]),
      2,
    ),
  );
  // `position` is never read by the shader, but three uses it to size the draw
  // and to build the bounding sphere.
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(4 * 3), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
}

/**
 * The accretion disk: instanced quads stretched along each particle's
 * screen-space motion, so the disk reads as flowing light rather than as a
 * cloud of dots. Particles never move on the CPU — each instance carries static
 * orbital elements and the vertex shader integrates the orbit from a clock
 * uniform, so changing particle count is the only thing that touches a buffer.
 */
export class Disk {
  readonly object: Mesh;
  readonly material: ShaderMaterial;
  private geometry: InstancedBufferGeometry;
  private count: number;

  constructor(count: number) {
    this.count = count;
    this.material = new ShaderMaterial({
      vertexShader: glslPhysicsDefines() + lensingChunk + streakChunk + diskVert,
      fragmentShader: streakChunk + diskFrag,
      uniforms: {
        uTime: { value: 0 },
        uSpin: { value: 1.0 },
        uDrift: { value: 0.012 },
        uScaleHeight: { value: 0.045 },
        uSize: { value: 1.35 },
        uResolution: { value: new Vector2(1, 1) },
        uAspect: { value: 1 },
        uBeamPower: { value: 2.0 },
        uEmissPower: { value: 1.6 },
        uLensStrength: { value: 0.055 },
        uShadowNdc: { value: 0.12 },
        uWarp: { value: 1.0 },
        uIntro: { value: 0 },
        // Shutter interval, in simulation seconds. This is the only control on
        // streak length — spin rate stays free to be tuned independently.
        uShutter: { value: 2.6 },
        uMaxStreak: { value: 0.09 },
        uExposure: { value: 1.15 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this.geometry = this.buildGeometry(count);
    this.object = new Mesh(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  get particleCount(): number {
    return this.count;
  }

  /**
   * Swap in a different particle count. Called by the quality governor, so it
   * has to be safe to run mid-animation.
   */
  setCount(count: number): void {
    if (count === this.count) return;
    this.count = count;
    const next = this.buildGeometry(count);
    this.object.geometry = next;
    this.geometry.dispose();
    this.geometry = next;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private buildGeometry(count: number): InstancedBufferGeometry {
    const geometry = new InstancedBufferGeometry();
    quadAttributes(geometry);

    // Orbital elements, one per instance:
    //   x = migration phase / starting radius (0..1)
    //   y = initial orbital angle θ₀
    //   z = vertical offset within the scale height
    const elements = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      elements[i * 3 + 0] = Math.random();
      elements[i * 3 + 1] = Math.random() * Math.PI * 2;

      // Cubing a signed uniform concentrates material near the midplane while
      // still leaving a thin scattered atmosphere above and below it.
      const t = Math.random() * 2 - 1;
      elements[i * 3 + 2] = t * t * t;

      seeds[i] = Math.random();
    }

    geometry.setAttribute('aElement', new InstancedBufferAttribute(elements, 3));
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    geometry.instanceCount = count;
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), DISK_OUTER * 1.5);
    return geometry;
  }
}
