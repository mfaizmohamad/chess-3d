// piece materials (ivory, ebony, gold). Lit by scene.environment.
import * as THREE from 'three';

export function createPieceMaterials() {
  // Warm polished ivory with a soft sheen, lacquered by a clearcoat.
  const ivory = new THREE.MeshPhysicalMaterial({
    name: 'ivory',
    color: new THREE.Color('#ece2cc'),
    roughness: 0.34,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.10,
    sheen: 0.6,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color('#ffd9a0'),
    specularIntensity: 0.8,
    ior: 1.55,
    envMapIntensity: 1.0,
  });

  // Deep obsidian ebony: near black base, strong glossy coat, faint cold blue sheen on grazing angles.
  const ebony = new THREE.MeshPhysicalMaterial({
    name: 'ebony',
    color: new THREE.Color('#0d0f15'),
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    sheen: 0.5,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color('#2b4a82'),
    specularIntensity: 1.0,
    specularColor: new THREE.Color('#b8c8ff'),
    ior: 1.65,
    envMapIntensity: 1.15,
  });

  const goldWhite = new THREE.MeshPhysicalMaterial({
    name: 'gold-bright',
    color: new THREE.Color('#e8b850'),
    roughness: 0.20,
    metalness: 1.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.15,
  });

  // A touch deeper and warmer so it still reads against ivory-white neighbours and black alike.
  const goldBlack = new THREE.MeshPhysicalMaterial({
    name: 'gold-antique',
    color: new THREE.Color('#d9a441'),
    roughness: 0.17,
    metalness: 1.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.2,
  });

  return {
    white: { body: ivory, accent: goldWhite },
    black: { body: ebony, accent: goldBlack },
  };
}
