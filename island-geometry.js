import * as THREE from 'three';
import { noise3D } from './math-utils.js';

export const ISLAND_ANGULAR_RADIUS = Math.PI / 3; // 60 degrees - Larger area for more robust island

// Simple FBM for better terrain detail
function fbm(x, y, z, octaves = 3, lacunarity = 2.0, gain = 0.5) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    for(let i=0; i<octaves; i++) {
        total += noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return total;
}

// Helper to get height offset at a point on the "North Pole" cap
// Point p is expected to be roughly on the sphere of radius R, near +Y axis
export function calculateIslandHeight(x, y, z, R) {
    // 1. Calculate polar coordinates in local cap plane (x,z)
    const dist = Math.sqrt(x*x + z*z);
    const angle = Math.atan2(z, x);
    
    // Logical radius of the island mass (where it touches water)
    const landRadius = R * 0.55; 
    
    // 2. Domain Warping for Irregular Coastline
    const warpFreq = 0.8;
    const warpAmp = R * 0.15;
    const dx = noise3D(x * warpFreq, y * warpFreq, z * warpFreq + 10.0);
    const dz = noise3D(x * warpFreq, y * warpFreq, z * warpFreq + 20.0);
    
    const wx = x + dx * warpAmp;
    const wz = z + dz * warpAmp;
    
    const wDist = Math.sqrt(wx*wx + wz*wz);
    
    // 3. Radial Gradient (The main shape)
    // 1.0 at center, 0.0 at landRadius
    let radial = 1.0 - (wDist / landRadius);
    
    // 4. Height Profile Curve (Key to "Flatness")
    // We want a steep rise from water (beach), then a flat plateau (grass)
    // Input: radial (-inf to 1.0)
    
    // Cut off anything way outside
    if (radial < -0.2) return -2.0; // Deep water, sunk well below
    
    // Map radial to height
    // -0.1 to 0.1: Beach Transition
    // 0.1 to 0.8: Plateau
    // > 0.8: Peak
    
    let baseH = 0;
    
    if (radial < 0.0) {
        // Shelf dropoff
        baseH = radial * 2.0; // Linear drop
    } else if (radial < 0.15) {
        // Beach slope (gentle)
        baseH = radial * 0.5; // reaches 0.075 at radial 0.15
    } else {
        // Land Plateau
        // Smooth transition from beach to flat land
        const t = (radial - 0.15) / 0.85;
        // Ease out cubic to flatten the top
        // Start at 0.075, go to ~0.5
        const landForm = Math.pow(t, 0.5); // Fast rise, slow finish
        baseH = 0.075 + landForm * 0.35; 
    }
    
    // 5. Add Terrain Detail (FBM)
    // Only add detail on land
    let detail = 0;
    if (radial > -0.05) {
        const detailScale = 0.15; // Frequency
        const detailAmp = 0.08;   // Amplitude (small to keep it flat)
        
        let n = fbm(wx * detailScale, y * detailScale, wz * detailScale, 3);
        
        // Dampen noise on beach to keep it smooth
        const beachMask = THREE.MathUtils.smoothstep(radial, 0.0, 0.2);
        detail = n * detailAmp * beachMask;
    }
    
    // 6. Combine
    let h = (baseH + detail) * R * 0.3; // Scale by radius context
    
    // 7. Edge Fade (Final Safety)
    // Ensure the mesh edge is definitely pulled down
    // The mesh extends to R * sin(60deg) approx R * 0.86
    // We want to force down starting around R * 0.7
    const meshEdgeDist = R * 0.7;
    if (dist > meshEdgeDist) {
        const fade = 1.0 - THREE.MathUtils.smoothstep(dist, meshEdgeDist, R * 0.9);
        h *= fade;
        h -= (1.0 - fade) * 2.0; // Force sink
    }

    return h;
}

export function createIslandMesh(radius) {
    // High resolution mesh for detailed coastline
    const geometry = new THREE.SphereGeometry(
        radius, 
        192, // Higher segment count for smoother beach curves
        96, 
        0, Math.PI * 2, 
        0, ISLAND_ANGULAR_RADIUS 
    );
    
    const posAttribute = geometry.attributes.position;
    const count = posAttribute.count;
    const colors = [];
    
    // Colors
    const cDeepSand = new THREE.Color(0xcc9966); // Wet/Underwater sand
    const cBeach = new THREE.Color(0xffcc88);    // Dry Sand
    const cGrass = new THREE.Color(0x55aa55);
    const cForest = new THREE.Color(0x227722);
    const cRock = new THREE.Color(0x777777);

    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);
        
        // Height Logic
        // Our water level is logically at radius offset 0.
        // But physically we want visual water to cut the island.
        // We will sink the whole island calculation by a tiny bit or assume 0 is water line.
        // However, standard sphere is at R. 
        // calculateIslandHeight returns offset from R.
        // 0 offset = at water surface.
        
        const hOffset = calculateIslandHeight(x, y, z, radius);
        
        v.set(x, y, z).normalize().multiplyScalar(radius + hOffset);
        
        posAttribute.setXYZ(i, v.x, v.y, v.z);
        
        // Color Logic based on Height (hOffset)
        // hOffset approx ranges from -2.0 to +2.0
        // Water is at 0.0
        
        let c = new THREE.Color();
        
        if (hOffset < 0.05) {
            // Underwater / Wet Beach
            c.copy(cDeepSand);
            // Blend to dry beach
            c.lerp(cBeach, THREE.MathUtils.smoothstep(hOffset, -0.1, 0.05));
        } else if (hOffset < 0.25) {
            // Beach -> Grass
            c.copy(cBeach);
            c.lerp(cGrass, THREE.MathUtils.smoothstep(hOffset, 0.15, 0.25));
        } else if (hOffset < 0.8) {
            // Grass -> Forest
            c.copy(cGrass);
            // subtle variation
            const noiseVar = noise3D(x*0.2, y*0.2, z*0.2);
            c.offsetHSL(0, 0, noiseVar * 0.05);
            c.lerp(cForest, THREE.MathUtils.smoothstep(hOffset, 0.6, 0.8));
        } else {
            // Forest -> Rock
            c.copy(cForest);
            c.lerp(cRock, THREE.MathUtils.smoothstep(hOffset, 0.8, 1.2));
        }
        
        colors.push(c.r, c.g, c.b);
    }
    
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    
    // Standard Material with vertex colors
    // We will inject shader logic for tides in the generator
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.0,
        flatShading: false
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
}