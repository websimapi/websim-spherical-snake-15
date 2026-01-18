import * as THREE from 'three';

export class SandParticles {
    constructor(scene, maxParticles = 300) {
        this.scene = scene;
        this.maxParticles = maxParticles;
        
        // Geometry
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(maxParticles * 3);
        this.velocities = new Float32Array(maxParticles * 3);
        this.lifetimes = new Float32Array(maxParticles);
        
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        
        // Material - Simple, sandy, additive
        this.material = new THREE.PointsMaterial({
            color: 0xffdb99, // Bright sand
            size: 0.6,
            transparent: true,
            opacity: 0.8,
            blending: THREE.NormalBlending, // Normal blending looks more like solid grains
            depthWrite: false,
            sizeAttenuation: true
        });
        
        this.mesh = new THREE.Points(this.geometry, this.material);
        this.mesh.frustumCulled = false; // Always render
        this.scene.add(this.mesh);
        
        // Initialize off-screen
        for(let i=0; i<maxParticles*3; i++) this.positions[i] = 0;
        
        this.nextIdx = 0;
    }

    // Emit particles from a position, generally moving in a direction
    emit(pos, dir, speed, count = 3) {
        for(let i=0; i<count; i++) {
            const idx = this.nextIdx;
            
            // Random spread vector
            const spread = 0.8; 
            const randVec = new THREE.Vector3(
                (Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)
            ).normalize().multiplyScalar(spread);
            
            const v = dir.clone().add(randVec).normalize().multiplyScalar(speed * (0.5 + Math.random()));
            
            // Start pos with slight jitter
            this.positions[idx*3] = pos.x + (Math.random()-0.5)*0.5;
            this.positions[idx*3+1] = pos.y + (Math.random()-0.5)*0.5;
            this.positions[idx*3+2] = pos.z + (Math.random()-0.5)*0.5;
            
            this.velocities[idx*3] = v.x;
            this.velocities[idx*3+1] = v.y;
            this.velocities[idx*3+2] = v.z;
            
            this.lifetimes[idx] = 0.5 + Math.random() * 0.5; // 0.5 - 1.0s life
            
            this.nextIdx = (this.nextIdx + 1) % this.maxParticles;
        }
        this.geometry.attributes.position.needsUpdate = true;
    }

    update(dt) {
        const positions = this.geometry.attributes.position.array;
        let active = false;

        for(let i=0; i<this.maxParticles; i++) {
            if(this.lifetimes[i] > 0) {
                active = true;
                this.lifetimes[i] -= dt;
                
                const idx = i*3;
                const x = positions[idx];
                const y = positions[idx+1];
                const z = positions[idx+2];
                
                // Gravity (Towards center 0,0,0)
                const len = Math.sqrt(x*x + y*y + z*z);
                const g = 25.0; // Strong gravity
                
                if (len > 0) {
                    this.velocities[idx]   -= (x/len) * g * dt;
                    this.velocities[idx+1] -= (y/len) * g * dt;
                    this.velocities[idx+2] -= (z/len) * g * dt;
                }

                // Move
                positions[idx]   += this.velocities[idx] * dt;
                positions[idx+1] += this.velocities[idx+1] * dt;
                positions[idx+2] += this.velocities[idx+2] * dt;
                
                // Ground Collision (Approximate)
                // If it falls below ~10 units, stop it or kill it
                const newLen = Math.sqrt(
                    positions[idx]*positions[idx] + 
                    positions[idx+1]*positions[idx+1] + 
                    positions[idx+2]*positions[idx+2]
                );
                
                if (newLen < 10.0) {
                    this.lifetimes[i] = 0;
                }
            } else {
                // Hide
                positions[i*3] = 0;
                positions[i*3+1] = 0;
                positions[i*3+2] = 0;
            }
        }
        
        if (active) {
            this.geometry.attributes.position.needsUpdate = true;
        }
    }
}