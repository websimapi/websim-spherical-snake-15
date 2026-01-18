import * as THREE from 'three';
import { noise3D } from './math-utils.js';

export class IslandGenerator {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.center = new THREE.Vector3(0, 1, 0); // Normalized center direction
        this.baseRadius = 0;
        
        this.state = 'inactive'; // inactive, spawning, rising, docked
        this.progress = 0; // 0 to 1
        
        this.ISLAND_ANGULAR_RADIUS = Math.PI / 6; // ~30 degrees
        this.MAX_HEIGHT = 2.5;
        
        // Positioning
        this.spawnPos = new THREE.Vector3(0, 0, 0);
        this.targetPos = new THREE.Vector3(0, 10, 0); // Will update
        this.currentPos = new THREE.Vector3(0, 0, 0);
        this.currentScale = 0.1;
    }

    trigger(earthRadius) {
        if (this.state !== 'inactive') return;
        
        this.baseRadius = earthRadius;
        
        // Pick a random spot on the sphere for the island to emerge
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        
        this.center.set(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        ).normalize();
        
        this.targetPos.copy(this.center).multiplyScalar(earthRadius);
        this.spawnPos.set(0, 0, 0);
        
        this.createMesh(earthRadius);
        
        this.state = 'spawning';
        this.progress = 0;
        this.mesh.visible = true;
    }

    createMesh(earthRadius) {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }

        // We create a high-res patch
        // To make it easy, let's use a subdivided plane and curve it
        const segs = 64;
        const geometry = new THREE.PlaneGeometry(earthRadius * 1.5, earthRadius * 1.5, segs, segs);
        const posAttribute = geometry.attributes.position;
        const colors = [];
        
        // Orientation matrix to rotate plane (which looks at Z) to look at `this.center`
        const dummyObj = new THREE.Object3D();
        dummyObj.lookAt(this.center);
        dummyObj.updateMatrix();
        const rotMat = dummyObj.matrix;

        const islandGeo = new THREE.BufferGeometry();
        const verts = [];
        const normals = [];
        const cols = [];
        
        // Color Palette
        const cBeach = new THREE.Color(0xeebb88); // Sand
        const cGrass = new THREE.Color(0x44aa44); // Grass
        const cMount = new THREE.Color(0x888888); // Rock

        for(let i=0; i<posAttribute.count; i++) {
            // Plane coord
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            
            // Project onto sphere surface roughly
            // We assume the plane is tangent to the sphere at `this.center`
            // But since the island floats up, we build it in local space first
            // Local space: (x, y) are coords on the tangent plane.
            // We project them down to sphere to get curvature.
            
            // Polar conversion from plane center
            const r = Math.sqrt(x*x + y*y);
            // Angular distance on sphere
            const ang = r / earthRadius;
            
            // Height calculation
            const h = this.calculateHeightLocal(x, y, earthRadius);
            
            // Construct the curved vertex in "Standard" orientation (North Pole)
            // Then we will rotate the whole mesh group to `this.center`
            // Sphere coord (phi, theta)
            // Let's use simpler logic: 
            // 1. Start with Vector(x, y, earthRadius)
            // 2. Normalize -> Direction
            // 3. Multiply by (earthRadius + h)
            
            const vDir = new THREE.Vector3(x, y, earthRadius).normalize();
            // Apply curvature correction so it's not distorted at edges? 
            // Actually, mapping plane x,y to sphere can be done by simple normalization if the patch is small (<45deg)
            
            const totalR = earthRadius + h;
            const finalPos = vDir.clone().multiplyScalar(totalR);
            
            // Store relative to the "center" of the island (which is at 0,0,earthRadius in this local build)
            // So we center the mesh at (0,0,0) for the Group, and vertices are offset
            // Actually, easier: Build the mesh assuming the group is at (0,0,0) and the verts are near (0,0,0)
            // But the island needs to curve.
            
            // Let's settle on: The mesh contains vertices in LOCAL SPACE.
            // Center of island is (0,0,0) local.
            // But the curvature implies it's a cap. 
            // Let's make the vertices relative to the sphere center (0,0,0)
            // And then we just rotate the mesh to align with target direction.
            
            verts.push(finalPos.x, finalPos.y, finalPos.z);
            
            // Color based on layer
            let c = cBeach.clone();
            if (h > 0.2) c.lerp(cGrass, Math.min((h - 0.2) * 2, 1));
            if (h > 1.2) c.lerp(cMount, Math.min((h - 1.2), 1));
            
            cols.push(c.r, c.g, c.b);
        }
        
        islandGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        islandGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        islandGeo.computeVertexNormals();

        this.mesh = new THREE.Mesh(
            islandGeo,
            new THREE.MeshStandardMaterial({ 
                vertexColors: true, 
                roughness: 0.8,
                flatShading: false
            })
        );
        
        // Align mesh to the target center
        const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), this.center);
        this.mesh.quaternion.copy(alignQ);
        
        this.scene.add(this.mesh);
    }

    calculateHeightLocal(x, y, R) {
        const dist = Math.sqrt(x*x + y*y);
        const maxDist = R * Math.sin(this.ISLAND_ANGULAR_RADIUS);
        
        if (dist > maxDist) return 0;
        
        // Edge falloff
        const t = THREE.MathUtils.smoothstep(dist, maxDist * 0.7, maxDist);
        const falloff = 1.0 - t;
        
        if (falloff <= 0) return 0;

        // Noise
        const freq = 0.5;
        const amp = 1.5;
        // Use fixed offset so it doesn't animate
        const n = noise3D(x * freq, y * freq, 100.0); 
        
        let h = (n * 0.5 + 0.5) * amp; // 0 to 1.5
        
        // Layering logic
        // Beach: 0 to 0.2
        // Grass: 0.2 to 1.2
        // Mount: 1.2+
        
        // Shaping
        h += 0.2; // Base lift
        
        // Add mountain peak in center
        const centerPeak = Math.max(0, 1.0 - (dist / (maxDist * 0.5)));
        h += centerPeak * 1.5;
        
        return h * falloff;
    }

    // Get height at a specific direction (normalized) relative to sphere center
    getHeightAndNormal(direction, earthRadius) {
        if (this.state !== 'docked') return { height: 0, normal: direction.clone() };

        // 1. Transform direction into Island Local Space
        // Inverse of the mesh rotation
        const invQ = this.mesh.quaternion.clone().invert();
        const localDir = direction.clone().applyQuaternion(invQ); // Should be near (0,0,1)
        
        // 2. Project onto tangent plane to get x,y
        // We constructed vertices as `vDir * (R + h)`. vDir was (x,y,R).normalized
        // So localDir ~= (x,y,R).normalized
        // x/z = lx/lz -> x = lx/lz * R
        if (localDir.z <= 0) return { height: 0, normal: direction.clone() }; // Opposite side of earth

        const k = earthRadius / localDir.z;
        const x = localDir.x * k;
        const y = localDir.y * k;
        
        const h = this.calculateHeightLocal(x, y, earthRadius);
        
        if (h <= 0.01) return { height: 0, normal: direction.clone() };
        
        // Calculate Normal (Gradient)
        // Finite difference
        const eps = 0.1;
        const hx = this.calculateHeightLocal(x + eps, y, earthRadius);
        const hy = this.calculateHeightLocal(x, y + eps, earthRadius);
        
        // Local slope vectors
        // Tangent X: (eps, 0, hx - h)
        // Tangent Y: (0, eps, hy - h)
        // But this is on the plane. On sphere it's trickier.
        // Let's approximate: The surface is R+h.
        // The gradient of H gives us the tilt relative to the sphere normal.
        
        // Spherical Normal is roughly Z in local space.
        // Tilt is (-dh/dx, -dh/dy, 1).normalized (very roughly)
        const dhdx = (hx - h) / eps;
        const dhdy = (hy - h) / eps;
        
        const localNormal = new THREE.Vector3(-dhdx, -dhdy, 1).normalize();
        // But we need to rotate this local normal effectively because the "Up" is localDir, not Z.
        // Actually, simpler:
        // Position P = (R+h) * direction
        // Nearby Px, Py...
        // Let's rely on the physics loop being small step.
        // We can construct the normal by rotating the sphere normal (direction)
        // by the slope angle.
        
        // Let's try to be more precise:
        // Local "Up" is (0,0,1) for the math, but `localDir` for the position.
        // Actually since we built the mesh using (x,y,R) as base, the "base normal" varies.
        // Let's just use the numerical gradient on the height field added to the sphere.
        
        // Simple composition:
        // Base Normal = direction
        // Slope = (dhdx, dhdy)
        // We want to perturb Base Normal by Slope.
        // Tangent basis at 'direction':
        // U = direction x (0,1,0)
        // V = direction x U
        // result = direction + U*dhdx + V*dhdy
        
        const up = new THREE.Vector3(0, 1, 0);
        let tanU = new THREE.Vector3().crossVectors(direction, up);
        if (tanU.lengthSq() < 0.001) tanU = new THREE.Vector3(1,0,0); // Pole handling
        tanU.normalize();
        const tanV = new THREE.Vector3().crossVectors(direction, tanU).normalize();
        
        // Scale slope effects?
        // dh/dx is slope in linear units.
        const slope = new THREE.Vector3().addVectors(
            tanU.multiplyScalar(-dhdx),
            tanV.multiplyScalar(-dhdy)
        );
        
        const finalNormal = direction.clone().add(slope).normalize();

        return { height: h, normal: finalNormal };
    }

    update(dt, earthRadius) {
        if (this.state === 'inactive' || this.state === 'docked') return;
        
        this.progress += dt * 0.2; // 5 seconds to rise
        
        if (this.progress >= 1.0) {
            this.progress = 1.0;
            this.state = 'docked';
            this.mesh.position.set(0,0,0); // Reset to center relative to world, but vertices are correct
            // Wait, our mesh vertices were built relative to center (0,0,0).
            // But we applied a quaternion to the mesh to orient it.
            // When docked, position is (0,0,0) (concentric with earth).
            this.mesh.position.set(0,0,0);
            this.mesh.scale.set(1,1,1);
        } else {
            // Animation
            // 1. Position: Lerp from 0,0,0 to 0,0,0?
            // No, prompt says: "Simultaneous upward translation toward the sphere's surface"
            // So the mesh center should move from (0,0,0) to Surface?
            // BUT our mesh is built as a cap on the sphere.
            // If we move the mesh center to surface, the cap will float way above.
            // We want the cap to align.
            // So we want the visual scale to go 0.1 -> 1.0
            // And the position to go from Center -> Center.
            // Wait, "Spawn at center... upward translation... final positioning where island breaches".
            // If the mesh is "a part of sphere surface", then at scale 0.1 it's a tiny sphere cap at (0,0,0).
            // To make it look like it's rising from core:
            // Scale: 0.1 -> 1.0
            // Position: (0,0,0) -> (0,0,0). 
            // The radius of the vertices determines where they are.
            // At scale 0.1, vertices are at R*0.1. (Deep inside).
            // At scale 1.0, vertices are at R*1.0. (Surface).
            // This achieves "Upward translation" radially relative to center!
            
            // Add floaty wobble
            const wobble = Math.sin(this.progress * 10) * 0.5 * (1-this.progress);
            
            this.mesh.scale.setScalar(this.progress * 0.9 + 0.1);
            
            // Apply rotation wobble if desired?
        }
    }
}