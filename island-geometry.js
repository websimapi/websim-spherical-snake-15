import * as THREE from 'three';
import { noise3D } from './math-utils.js';

export const ISLAND_ANGULAR_RADIUS = Math.PI / 6; // 30 degrees

// Helper to get height offset at a point on the "North Pole" cap
// Point p is expected to be roughly on the sphere of radius R, near +Y axis
export function calculateIslandHeight(x, y, z, R) {
    // 1. Calculate polar coordinates in local cap plane (x,z) for noise mapping
    const dist = Math.sqrt(x*x + z*z);
    const angle = Math.atan2(z, x);
    
    // Max arc length (chord length approx on plane x,z)
    const maxDist = R * Math.sin(ISLAND_ANGULAR_RADIUS);
    
    // 2. Dynamic Irregular Shape
    // Distort the distance field to create bays and peninsulas
    // Low frequency noise on the angle creates a closed loop of noise
    const shapeFreq = 2.0; 
    const shapeAmp = maxDist * 0.25;
    const shapeNoise = noise3D(Math.cos(angle)*shapeFreq, Math.sin(angle)*shapeFreq, 42.0);
    const distortedDist = dist + shapeNoise * shapeAmp;
    
    // 3. Falloff / Mask
    // Fade out before the mesh edge to ensure seamless underwater transition
    const edgeStart = maxDist * 0.75; 
    const edgeEnd = maxDist * 0.95;
    const t = THREE.MathUtils.smoothstep(distortedDist, edgeStart, edgeEnd);
    const mask = 1.0 - t;
    
    if (mask <= 0.001) return 0;

    // 4. Terrain Height (Less cone-like, more noisy)
    const freq = 0.35;
    const n1 = noise3D(x * freq, z * freq, 10.0);
    const n2 = noise3D(x * freq * 2.0, z * freq * 2.0, 20.0) * 0.5;
    const n3 = noise3D(x * freq * 4.0, z * freq * 4.0, 30.0) * 0.25;
    
    let h = (n1 + n2 + n3); // -1.75 to 1.75 approx
    h = (h * 0.5 + 0.5); // 0 to 1 approx
    
    // Flatten beaches using a power curve
    h = Math.pow(Math.max(0, h), 1.2);
    
    // Scale amplitude
    h *= 1.5; 

    // 5. Gentle Central Mass (to ensure it's an island, not a ring)
    // Much wider, softer dome than before
    const centerDistNorm = Math.min(1.0, distortedDist / (maxDist * 0.8));
    const centerMass = Math.cos(centerDistNorm * Math.PI * 0.5); 
    h += centerMass * 1.8; 
    
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
        // Beach: 0.5 to 0.7
        // Grass: 0.7 to 1.5
        // Forest: 1.5 to 2.8
        // Rock: 2.8+
        
        let c = cBeach.clone();
        // Use smoothsteps for nicer gradients
        if (h > 0.6) c.lerp(cGrass, THREE.MathUtils.smoothstep(h, 0.6, 1.0));
        if (h > 1.5) c.lerp(cForest, THREE.MathUtils.smoothstep(h, 1.5, 2.2));
        if (h > 2.8) c.lerp(cRock, THREE.MathUtils.smoothstep(h, 2.8, 3.5));
        if (h > 4.0) c.lerp(cSnow, THREE.MathUtils.smoothstep(h, 4.0, 4.5));
        
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