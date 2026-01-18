import * as THREE from 'three';
import { calculateIslandHeight, createIslandMesh } from './island-geometry.js';

export class IslandGenerator {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.center = new THREE.Vector3(0, 1, 0); // Target center direction on Earth
        this.state = 'inactive'; // inactive, spawning, docked
        this.progress = 0; // 0 to 1
        
        // Reusable vectors for physics to avoid garbage
        this._localDir = new THREE.Vector3();
        this._dummyQ = new THREE.Quaternion();
    }

    trigger(earthRadius) {
        if (this.state !== 'inactive') return;
        
        // 1. Determine Location
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        
        this.center.set(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        ).normalize();
        
        // 2. Generate Proper Mesh
        this.createMesh(earthRadius);
        
        // 3. Start Animation
        this.state = 'spawning';
        this.progress = 0;
        this.mesh.visible = true;
    }

    createMesh(earthRadius) {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if(this.mesh.geometry) this.mesh.geometry.dispose();
            if(this.mesh.material) this.mesh.material.dispose();
        }

        // Generate the detailed terrain mesh
        this.mesh = createIslandMesh(earthRadius);
        
        // Align mesh to the target center
        // The mesh is generated at North Pole (0, 1, 0)
        // We rotate it to align (0, 1, 0) with this.center
        const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.center);
        this.mesh.quaternion.copy(alignQ);
        
        // Initially scale down for spawn effect
        this.mesh.scale.set(0.1, 0.1, 0.1);
        
        this.scene.add(this.mesh);
    }

    // Get height at a specific direction (normalized) relative to sphere center
    getHeightAndNormal(direction, earthRadius) {
        if (this.state !== 'docked' || !this.mesh) return { height: 0, normal: direction.clone() };

        // 1. Transform world direction into Island Local Space (where island is at North Pole)
        const invQ = this.mesh.quaternion.clone().invert();
        const localDir = direction.clone().applyQuaternion(invQ); // Should be near (0, 1, 0)
        
        // 2. Calculate coordinates on the local frame
        // localDir is normalized. Position on sphere surface is localDir * R.
        // We need x, y, z for the height function which expects point on sphere.
        const px = localDir.x * earthRadius;
        const py = localDir.y * earthRadius;
        const pz = localDir.z * earthRadius;
        
        // 3. Get Height
        const h = calculateIslandHeight(px, py, pz, earthRadius);
        
        if (h <= 0.001) return { height: 0, normal: direction.clone() };
        
        // 4. Calculate Normal (Finite Difference approximation)
        const eps = 0.1;
        // Sample nearby points in local space
        // We move slightly along X and Z (tangent plane at pole)
        const hx = calculateIslandHeight(px + eps, py, pz, earthRadius);
        const hz = calculateIslandHeight(px, py, pz + eps, earthRadius);
        
        // Slopes
        const dhdx = (hx - h) / eps;
        const dhdz = (hz - h) / eps;
        
        // Construct local normal
        // Base normal at pole is (0,1,0).
        // Terrain normal tilts away from slope.
        // Vector = (-dhdx, 1, -dhdz).normalize()
        // Note: This is an approximation treating the cap as a plane.
        // For a sphere, it's slightly more complex, but for steering logic, this is sufficient.
        const localNormal = new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
        
        // 5. Transform normal back to world space
        const worldNormal = localNormal.applyQuaternion(this.mesh.quaternion);

        return { height: h, normal: worldNormal };
    }

    update(dt, earthRadius) {
        if (this.state === 'inactive' || this.state === 'docked') return;
        
        this.progress += dt * 0.3; // Rise over ~3 seconds
        
        if (this.progress >= 1.0) {
            this.progress = 1.0;
            this.state = 'docked';
            this.mesh.scale.set(1, 1, 1);
        } else {
            // Animation: "Breach" effect
            // Scale up from core
            // Ease out elastic for a nice pop
            const p = this.progress;
            // Simple overshoot
            // const s = 1.0 + Math.sin(p * Math.PI) * 0.1; // mild wobble?
            // Just smooth grow
            const s = THREE.MathUtils.smoothstep(p, 0, 1);
            
            // Start small deep inside (technically visual scale only affects size, not position if at 0,0,0)
            // But since vertices are at radius R, scaling by 0.1 puts them at R*0.1 (deep inside).
            // This creates the perfect "rising from core" effect.
            this.mesh.scale.setScalar(s);
            
            // Add some rotation spin while rising?
            // this.mesh.rotateY(dt); // Local Y rotation (spin around pole)
        }
    }
}