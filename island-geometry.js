import * as THREE from 'three';
import { noise3D } from './math-utils.js';

export const ISLAND_ANGULAR_RADIUS = Math.PI / 6; // 30 degrees

// Helper to get height offset at a point on the "North Pole" cap
// Point p is expected to be roughly on the sphere of radius R, near +Y axis
export function calculateIslandHeight(x, y, z, R) {
    // We use x and z to drive the noise, as they are the horizontal plane for the pole
    // Distance from Y axis
    const dist = Math.sqrt(x*x + z*z);
    
    // Max arc length (chord length approx on plane x,z)
    const maxDist = R * Math.sin(ISLAND_ANGULAR_RADIUS);
    
    // Check boundary
    if (dist > maxDist) return 0;
    
    // Edge falloff (smooth transition to 0 at edge)
    // 0.8 to 1.0 of the radius fades out to blend perfectly with sphere
    const t = THREE.MathUtils.smoothstep(dist, maxDist * 0.8, maxDist);
    const falloff = 1.0 - t;
    
    if (falloff <= 0.001) return 0;

    // Noise Generation
    // We use spatial coordinates for noise
    const freq = 0.3;
    const amp = 1.8;
    
    // Basic terrain shape
    const n1 = noise3D(x * freq, z * freq, 10.0);
    const n2 = noise3D(x * freq * 2.0, z * freq * 2.0, 20.0);
    
    let h = (n1 * 1.0 + n2 * 0.5); 
    
    // Bias up
    h = (h * 0.5 + 0.5) * amp; // 0 to amp
    
    // Mountains in center
    const centerBiased = Math.max(0, 1.0 - (dist / (maxDist * 0.5)));
    h += centerBiased * centerBiased * 2.0; 
    
    // Base lift for the whole island mass
    h += 0.3; 
    
    return h * falloff;
}

export function createIslandMesh(radius) {
    // Create a spherical cap at the North Pole (+Y)
    // thetaLength determines the size of the cap
    // High segment count for smooth terrain
    const geometry = new THREE.SphereGeometry(
        radius, 
        128, 
        64, 
        0, Math.PI * 2, // Phi (around equator)
        0, ISLAND_ANGULAR_RADIUS // Theta (down from pole)
    );
    
    // Vertex displacement
    const posAttribute = geometry.attributes.position;
    const count = posAttribute.count;
    const colors = [];
    const cBeach = new THREE.Color(0xeebb88);
    const cGrass = new THREE.Color(0x44aa44);
    const cForest = new THREE.Color(0x228822);
    const cRock = new THREE.Color(0x666666);
    const cSnow = new THREE.Color(0xffffff);

    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);
        
        v.set(x, y, z);
        
        // Calculate Height using the shared logic
        const h = calculateIslandHeight(x, y, z, radius);
        
        // Apply height along radial direction
        // Since we are at the pole of a sphere, normal is effectively 'v' normalized
        // Sink the mesh slightly (-0.2) so the edges (h=0) are submerged to prevent z-fighting
        v.normalize().multiplyScalar(radius + h - 0.2);
        
        posAttribute.setXYZ(i, v.x, v.y, v.z);
        
        // Color Logic
        let c = cBeach.clone();
        if (h > 0.4) c.lerp(cGrass, Math.min((h - 0.4) * 2.0, 1));
        if (h > 1.0) c.lerp(cForest, Math.min((h - 1.0) * 1.5, 1));
        if (h > 2.0) c.lerp(cRock, Math.min((h - 2.0) * 1.0, 1));
        if (h > 3.2) c.lerp(cSnow, Math.min((h - 3.2), 1));
        
        colors.push(c.r, c.g, c.b);
    }
    
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    // Recompute normals for correct lighting on the terrain
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.1,
        flatShading: false,
        side: THREE.DoubleSide // Ensure we see it from all angles if it clips
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
}