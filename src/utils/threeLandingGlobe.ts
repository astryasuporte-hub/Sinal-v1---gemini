/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Re-exporta estritamente os símbolos necessários de `three` para o globo da Landing Page.
 * Permite carregamento dinâmico lazy (`await import('../utils/threeLandingGlobe')`) preservando tree-shaking total.
 */
export {
  WebGLRenderer,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  Scene,
  PerspectiveCamera,
  CanvasTexture,
  RepeatWrapping,
  Group,
  Mesh,
  SphereGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  AdditiveBlending,
  ShaderMaterial,
  Color,
  BackSide,
  LineSegments,
  WireframeGeometry,
  LineBasicMaterial,
  Vector3,
  QuadraticBezierCurve3,
  BufferGeometry,
  Line,
  TorusGeometry,
  BufferAttribute,
  Points,
  PointsMaterial,
  AmbientLight,
  DirectionalLight,
  Clock,
} from 'three';
