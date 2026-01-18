import * as THREE from 'three';
import { calculateIslandHeight, createIslandMesh } from './island-geometry.js';

export class IslandGenerator {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.center = new THREE.Vector3(0, 1, 0); // Target center direction on Earth
        this.state = 'inactive'; // inactive, spawning, docked
        this.progress = 0; // 0 to 1
        this.baseRadius = 10; // Fixed base radius for generation to ensure consistent noise features
        
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
        // Always generate at base radius; we handle growth via scaling
        this.createMesh(this.baseRadius);
        
        // 3. Start Animation
        this.state = 'spawning';
        this.progress = 0;
        this.mesh.visible = true;
    }

    createMesh(radius) {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if(this.mesh.geometry) this.mesh.geometry.dispose();
            if(this.mesh.material) this.mesh.material.dispose();
        }

        // Generate the detailed terrain mesh
        this.mesh = createIslandMesh(radius);
        
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
        if ((this.state !== 'docked' && this.state !== 'spawning') || !this.mesh) return { height: 0, normal: direction.clone() };

        // Scale Factor (Earth has grown, island grows with it)
        const scale = earthRadius / this.baseRadius;

        // 1. Transform world direction into Island Local Space (where island is at North Pole)
        const invQ = this.mesh.quaternion.clone().invert();
        const localDir = direction.clone().applyQuaternion(invQ); // Should be near (0, 1, 0)
        
        // 2. Calculate coordinates on the BASE sphere
        // localDir is normalized. We map it to the BASE radius to check noise consistency
        const px = localDir.x * this.baseRadius;
        const py = localDir.y * this.baseRadius;
        const pz = localDir.z * this.baseRadius;
        
        // 3. Get Base Height
        const hBase = calculateIslandHeight(px, py, pz, this.baseRadius);
        
        if (hBase <= 0.001) return { height: 0, normal: direction.clone() };
        
        // 4. Calculate Normal (Finite Difference approximation in Base Space)
        const eps = 0.1;
        const hx = calculateIslandHeight(px + eps, py, pz, this.baseRadius);
        const hz = calculateIslandHeight(px, py, pz + eps, this.baseRadius);
        
        // Slopes
        const dhdx = (hx - hBase) / eps;
        const dhdz = (hz - hBase) / eps;
        
        const localNormal = new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
        
        // 5. Transform normal back to world space
        const worldNormal = localNormal.applyQuaternion(this.mesh.quaternion);

        // 6. Calculate Final Height
        // The mesh was sunk by 0.2 in base space to hide edges.
        // We replicate that offset and then scale up.
        // If result is negative, it means we are "underwater" (on the sunk skirt).
        const hPhysical = Math.max(0, (hBase - 0.2) * scale);

        return { height: hPhysical, normal: worldNormal };
    }

    update(dt, earthRadius) {
        if (this.state === 'inactive') return;
        
        // Always maintain scale ratio with Earth growth
        const globalScale = earthRadius / this.baseRadius;

        if (this.state === 'docked') {
             if (this.mesh) {
                 this.mesh.scale.setScalar(globalScale);
             }
             return;
        }
        
        this.progress += dt * 0.3; // Rise over ~3 seconds
        
        if (this.progress >= 1.0) {
            this.progress = 1.0;
            this.state = 'docked';
            this.mesh.scale.setScalar(globalScale);
        } else {
            // Animation: "Breach" effect
            const p = this.progress;
            const animScale = THREE.MathUtils.smoothstep(p, 0, 1);
            
            // Combined Scale: Earth Growth * Spawning Animation
            this.mesh.scale.setScalar(globalScale * animScale);
        }
    }
}