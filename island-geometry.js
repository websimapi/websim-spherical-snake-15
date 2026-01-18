import * as THREE from 'three';
import { noise3D } from './math-utils.js';

export const ISLAND_ANGULAR_RADIUS = Math.PI / 4; // 45 degrees

// Helper to get height offset at a point on the "North Pole" cap
// Point p is expected to be roughly on the sphere of radius R, near +Y axis
export function calculateIslandHeight(x, y, z, R) {
    // 1. Calculate polar coordinates in local cap plane (x,z) for noise mapping
    const dist = Math.sqrt(x*x + z*z);
    const angle = Math.atan2(z, x);
    
    // Shrink the logical island size relative to the mesh cap to prevent edge clipping
    // The mesh cap is ~0.7 * R radius. We keep the island content within ~0.4 * R.
    const logicalRadius = R * 0.4; 
    
    // 2. Dynamic Irregular Shape
    // Lower frequency for smoother, more robust bays
    const shapeFreq = 1.0; 
    const shapeAmp = logicalRadius * 0.25;
    // Use circular noise input to ensure seamless shape around the pole
    const shapeNoise = noise3D(Math.cos(angle)*shapeFreq, Math.sin(angle)*shapeFreq, 42.0);
    const distortedDist = dist + shapeNoise * shapeAmp;
    
    // 3. Falloff / Mask
    // Tighter mask to ensure it hits zero well before mesh boundary
    const edgeStart = logicalRadius * 0.7; 
    const edgeEnd = logicalRadius * 1.0; 
    
    const t = THREE.MathUtils.smoothstep(distortedDist, edgeStart, edgeEnd);
    const mask = 1.0 - t;
    
    if (mask <= 0.001) return 0;

    // 4. Terrain Height (Much smoother)
    // Very low frequency for rolling hills
    const freq = 0.12;
    const n1 = noise3D(x * freq, z * freq, 10.0);
    const n2 = noise3D(x * freq * 2.0, z * freq * 2.0, 20.0) * 0.25;
    
    let h = (n1 + n2); 
    h = (h * 0.5 + 0.5); // Normalize roughly 0..1
    
    // Flatten beaches aggressively
    // A higher power pushes low values (beaches) closer to 0
    h = Math.pow(Math.max(0, h), 2.5);
    
    // Scale amplitude down for a flatter profile
    h *= 0.35; 

    // 5. Gentle Central Mass
    // Broad, low dome to ensure center is land
    const centerDistNorm = Math.min(1.0, distortedDist / (logicalRadius * 1.2));
    const centerMass = Math.cos(centerDistNorm * Math.PI * 0.5); 
    h += centerMass * 0.6; 
    
    return h * mask;
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
        // Sink deeper (-0.5) to better hide the mesh edges under the translucent water
        // This effectively creates a submerged shelf around the island
        v.normalize().multiplyScalar(radius + h - 0.5);
        
        posAttribute.setXYZ(i, v.x, v.y, v.z);
        
        // Color Logic
        // Sea level is effectively h=0.5 (due to -0.5 sink)
        // Adjust thresholds for flatter terrain
        
        let c = cBeach.clone();
        // Beach -> Grass
        if (h > 0.55) c.lerp(cGrass, THREE.MathUtils.smoothstep(h, 0.55, 0.8));
        // Grass -> Forest
        if (h > 0.9) c.lerp(cForest, THREE.MathUtils.smoothstep(h, 0.9, 1.3));
        // Forest -> Rock
        if (h > 1.4) c.lerp(cRock, THREE.MathUtils.smoothstep(h, 1.4, 1.8));
        // Rock -> Snow
        if (h > 2.0) c.lerp(cSnow, THREE.MathUtils.smoothstep(h, 2.0, 2.5));
        
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