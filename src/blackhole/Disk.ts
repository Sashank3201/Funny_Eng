import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';

import { DISK_OUTER, glslPhysicsDefines } from './physics';
import diskVert from './shaders/disk.vert.glsl?raw';
import diskFrag from './shaders/disk.frag.glsl?raw';

/**
 * The accretion disk: one `Points` object whose particles never move on the
 * CPU. Each vertex carries static orbital elements and the vertex shader
 * integrates the orbit from a clock uniform, so changing particle count is the
 * only thing that ever touches a buffer.
 */
export class Disk {
  readonly object: Points;
  readonly material: ShaderMaterial;
  private geometry: BufferGeometry;
  private count: number;

  constructor(count: number) {
    this.count = count;
    this.material = new ShaderMaterial({
      vertexShader: glslPhysicsDefines() + diskVert,
      fragmentShader: diskFrag,
      uniforms: {
        uTime: { value: 0 },
        uSpin: { value: 1.0 },
        uDrift: { value: 0.012 },
        uScaleHeight: { value: 0.045 },
        uSize: { value: 3.4 },
        uPixelRatio: { value: 1 },
        uAspect: { value: 1 },
        uBeamPower: { value: 2.0 },
        uEmissPower: { value: 1.6 },
        uLensStrength: { value: 0.055 },
        uShadowNdc: { value: 0.12 },
        uWarp: { value: 1.0 },
        uIntro: { value: 0 },
        uExposure: { value: 0.16 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this.geometry = this.buildGeometry(count);
    this.object = new Points(this.geometry, this.material);
    this.object.frustumCulled = false;
    // The disk is tilted rather than the camera, so the pointer can orbit the
    // camera freely without changing how much of the disk face we see.
    this.object.rotation.x = 0.0;
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

  private buildGeometry(count: number): BufferGeometry {
    // `position` carries orbital elements, not a location:
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

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(elements, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    // `position` is not a real position, so the automatic bounding sphere would
    // be meaningless. Frustum culling is off, but three still reads this.
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), DISK_OUTER * 1.5);
    return geometry;
  }
}
