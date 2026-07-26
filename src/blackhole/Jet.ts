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

import { glslPhysicsDefines } from './physics';
import jetVert from './shaders/jet.vert.glsl?raw';
import jetFrag from './shaders/jet.frag.glsl?raw';
import lensingChunk from './shaders/lensing.glsl?raw';
import streakChunk from './shaders/streak.glsl?raw';

const JET_LENGTH = 22;

/**
 * Twin relativistic jets along the spin axis, built from the same instanced
 * streak primitive as the disk.
 *
 * These are the one element of the scene that is not Schwarzschild — jets need
 * spin to exist at all (see the note in jet.vert.glsl). They are kept because
 * they are the most recognisable thing an accreting black hole does, and
 * because a strong vertical axis is what stops the composition reading as a
 * single horizontal band.
 */
export class Jet {
  readonly object: Mesh;
  readonly material: ShaderMaterial;
  private geometry: InstancedBufferGeometry;
  private count: number;

  constructor(count: number) {
    this.count = count;
    this.material = new ShaderMaterial({
      vertexShader: glslPhysicsDefines() + lensingChunk + streakChunk + jetVert,
      fragmentShader: streakChunk + jetFrag,
      uniforms: {
        uTime: { value: 0 },
        uRate: { value: 0.055 },
        uLaunch: { value: 3.4 },
        uLength: { value: JET_LENGTH },
        uBaseRadius: { value: 0.30 },
        uOpening: { value: 0.052 }, // ≈ 3°
        uTwist: { value: 0.16 },
        uTurbulence: { value: 0.55 },
        // Well below a real jet's bulk Lorentz factor. At the true value the
        // transverse Doppler term would de-boost these into invisibility at
        // this viewing angle; this keeps the asymmetry legible.
        uBeta: { value: 0.72 },
        uBeamPower: { value: 0.8 },
        uSize: { value: 1.0 },
        uResolution: { value: new Vector2(1, 1) },
        uAspect: { value: 1 },
        uLensStrength: { value: 0.055 },
        uShadowNdc: { value: 0.12 },
        uWarp: { value: 1.0 },
        uIntro: { value: 0 },
        uShutter: { value: 2.6 },
        uMaxStreak: { value: 0.05 },
        uExposure: { value: 1.25 },
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
    geometry.setAttribute(
      'aCorner',
      new BufferAttribute(
        new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]),
        2,
      ),
    );
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(4 * 3), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const jet = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      jet[i * 3 + 0] = Math.random();
      jet[i * 3 + 1] = Math.random() * Math.PI * 2;
      // Square-root keeps the launch annulus evenly filled by area rather than
      // bunching everything at the axis.
      jet[i * 3 + 2] = Math.sqrt(Math.random());
      seeds[i] = Math.random();
    }

    geometry.setAttribute('aJet', new InstancedBufferAttribute(jet, 3));
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    geometry.instanceCount = count;
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), JET_LENGTH * 1.5);
    return geometry;
  }
}
