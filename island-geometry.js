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
    
    // 4. Height Profile Curve
    
    // Underwater falloff
    if (radial < 0.0) {
        // Continuous smooth dropoff 
        return radial * 4.0 * (R * 0.1); 
    }
    
    // Land Parameters - Flatter, Wider Beach
    const plateauHeightVal = 0.035; 
    const beachWidth = 0.55; 
    
    let baseH = 0;
    
    if (radial < beachWidth) {
        // Beach Ramp: Linear mix for robust convex-ish slope
        const t = radial / beachWidth;
        // Linear mix with smoothstep for a solid beach that eases into plateau
        baseH = (t * 0.6 + THREE.MathUtils.smoothstep(t, 0.0, 1.0) * 0.4) * plateauHeightVal;
    } else {
        // Plateau
        baseH = plateauHeightVal;
        // Extremely subtle crown
        baseH += (radial - beachWidth) * 0.005;
    }
    
    // 5. Add Terrain Detail (FBM)
    // Significantly reduced amplitude for "flatter" look
    let detail = 0;
    
    // Only apply detail on land
    const detailScale = 0.4;
    const detailAmp = 0.002; // Practically flat
    
    let n = fbm(wx * detailScale, y * detailScale, wz * detailScale, 3);
    
    // Dampen noise heavily on beach to keep it smooth sand
    const beachMask = THREE.MathUtils.smoothstep(radial, beachWidth * 0.8, beachWidth * 1.5);
    detail = n * detailAmp * beachMask;
    
    // 6. Combine and Scale
    let h = (baseH + detail) * R;

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
        // Adjusted for flatter profile (Max ~0.35)
        
        let c = new THREE.Color();
        
        if (hOffset < 0.01) {
            // Wet Beach edge
            c.copy(cDeepSand);
            c.lerp(cBeach, THREE.MathUtils.smoothstep(hOffset, -0.05, 0.01));
        } else if (hOffset < 0.2) {
            // Broad Dry Beach
            c.copy(cBeach);
            // Transition to grass near top of beach slope
            c.lerp(cGrass, THREE.MathUtils.smoothstep(hOffset, 0.15, 0.22));
        } else {
            // Grass Plateau
            c.copy(cGrass);
            const noiseVar = noise3D(x*0.2, y*0.2, z*0.2);
            c.offsetHSL(0, 0, noiseVar * 0.03);
            
            // Occasional patches of "forest"
            if (noiseVar > 0.6) {
                 c.lerp(cForest, 0.5);
            }
        }
        
        colors.push(c.r, c.g, c.b);
    }
    
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // Fix Seam Normals (average start and end columns)
    const norms = geometry.attributes.normal;
    const widthSegs = 192; 
    const heightSegs = 96;

    for (let y = 0; y <= heightSegs; y++) {
        const idxA = y * (widthSegs + 1);
        const idxB = idxA + widthSegs;
        
        const mx = (norms.getX(idxA) + norms.getX(idxB)) * 0.5;
        const my = (norms.getY(idxA) + norms.getY(idxB)) * 0.5;
        const mz = (norms.getZ(idxA) + norms.getZ(idxB)) * 0.5;
        
        const len = Math.sqrt(mx*mx + my*my + mz*mz);
        if (len > 0) {
            const nx = mx/len, ny = my/len, nz = mz/len;
            norms.setXYZ(idxA, nx, ny, nz);
            norms.setXYZ(idxB, nx, ny, nz);
        }
    }
    norms.needsUpdate = true;
    
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