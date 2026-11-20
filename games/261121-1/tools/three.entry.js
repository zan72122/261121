/* three r187 のうち、このゲームで使う物だけを入れた入口(src/vendor/three.bundle.js の元)。
   全部入りより約 160KB 小さく、最初の読み込みと解析が速い。
   作り直し(three@0.187.0 と esbuild を npm で入れた場所で):
     npx esbuild tools/three.entry.js --bundle --minify --format=iife --target=es2018 --legal-comments=eof --outfile=src/vendor/three.bundle.js
   src/js で新しく THREE.○○ を使う時は、ここに名前を足して作り直す。 */
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, Box3, BoxGeometry, BufferAttribute,
  BufferGeometry, CanvasTexture, CapsuleGeometry, CatmullRomCurve3, CircleGeometry, ClampToEdgeWrapping,
  Color, CylinderGeometry, DirectionalLight, DoubleSide, Euler, ExtrudeGeometry,
  Float32BufferAttribute, Fog, FrontSide, Group, HalfFloatType, HemisphereLight,
  LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  NormalBlending, Object3D, OrthographicCamera, PCFShadowMap, PMREMGenerator, Path,
  PerspectiveCamera, Plane, PlaneGeometry, PointLight, Quaternion, Raycaster,
  RepeatWrapping, SRGBColorSpace, Scene, ShaderMaterial, Shape, ShapeGeometry,
  SphereGeometry, SplineCurve, SpotLight, Sprite, SpriteMaterial, TorusGeometry,
  TubeGeometry, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer,
  REVISION
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

globalThis.THREE = {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, Box3, BoxGeometry, BufferAttribute,
  BufferGeometry, CanvasTexture, CapsuleGeometry, CatmullRomCurve3, CircleGeometry, ClampToEdgeWrapping,
  Color, CylinderGeometry, DirectionalLight, DoubleSide, Euler, ExtrudeGeometry,
  Float32BufferAttribute, Fog, FrontSide, Group, HalfFloatType, HemisphereLight,
  LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  NormalBlending, Object3D, OrthographicCamera, PCFShadowMap, PMREMGenerator, Path,
  PerspectiveCamera, Plane, PlaneGeometry, PointLight, Quaternion, Raycaster,
  RepeatWrapping, SRGBColorSpace, Scene, ShaderMaterial, Shape, ShapeGeometry,
  SphereGeometry, SplineCurve, SpotLight, Sprite, SpriteMaterial, TorusGeometry,
  TubeGeometry, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer,
  REVISION,
  RoomEnvironment, RoundedBoxGeometry,
  BufferGeometryUtils: { mergeGeometries }
};
