import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';

/** Single triangle covering the viewport — one fewer vertex than a quad, and no
 * diagonal seam for the rasteriser to worry about. */
function triangleGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return geometry;
}

const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * A fullscreen shader pass. Each instance owns its material; the geometry and
 * camera are shared across every pass in the app.
 */
export class FullscreenPass {
  readonly material: ShaderMaterial;
  private readonly scene = new Scene();
  private readonly mesh: Mesh;
  private readonly geometry = triangleGeometry();

  constructor(fragmentShader: string, uniforms: Record<string, { value: unknown }>) {
    this.material = new ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Render into `target`, or to the canvas when `target` is null. */
  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export const fullscreenCamera = camera;
