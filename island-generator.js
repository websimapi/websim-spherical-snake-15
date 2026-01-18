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

        // Combined Uniforms (Sand Physics + Tides)
        this.sandUniforms = {
            uSnakePoints: { value: new Array(20).fill().map(() => new THREE.Vector3()) },
            uSnakeCount: { value: 0 },
            uTime: { value: 0 },
            uGlobalScale: { value: 1.0 },
            // Tides / Ripples - References will be copied from Game
            uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
            uRippleStartTimes: { value: new Array(5).fill(-1000) },
            uRippleIntensities: { value: new Array(5).fill(0) },
            uEarthRadius: { value: 10.0 }
        };
    }

    setRippleUniforms(rippleUniforms) {
        // Link our uniforms to the game's ripple uniforms for synchronization
        this.sandUniforms.uRippleCenters = rippleUniforms.uRippleCenters;
        this.sandUniforms.uRippleStartTimes = rippleUniforms.uRippleStartTimes;
        this.sandUniforms.uRippleIntensities = rippleUniforms.uRippleIntensities;
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
        
        // Inject Sand Physics Shader
        this.mesh.material.onBeforeCompile = (shader) => {
            shader.uniforms.uSnakePoints = this.sandUniforms.uSnakePoints;
            shader.uniforms.uSnakeCount = this.sandUniforms.uSnakeCount;
            shader.uniforms.uGlobalScale = this.sandUniforms.uGlobalScale;

            shader.vertexShader = `
                uniform vec3 uSnakePoints[20];
                uniform int uSnakeCount;
                uniform float uGlobalScale;
                varying vec3 vWorldPos;
                varying float vIsBeach;
            ` + shader.vertexShader;

            // Pass world pos and determine if beach based on color (simple approximation)
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                
                // Calculate world position early for logic
                vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
                vWorldPos = worldPosition.xyz;

                // Check vertex color (passed as attribute usually)
                // We use color to identify sand. Beach color is approx (0.93, 0.73, 0.53)
                // Let's assume red component > 0.8 is sand (grass is 0.26)
                // color is attribute vec3 color;
                vIsBeach = 0.0;
                #ifdef USE_COLOR
                    if (color.r > 0.6 && color.g > 0.5) {
                        vIsBeach = 1.0;
                    }
                #endif

                // Sand Displacement Logic
                if (vIsBeach > 0.5 && uSnakeCount > 0) {
                    vec3 accumulatedOffset = vec3(0.0);
                    
                    for(int i = 0; i < 20; i++) {
                        if (i >= uSnakeCount) break;
                        
                        vec3 sPos = uSnakePoints[i];
                        float dist = distance(worldPosition.xyz, sPos);
                        
                        // Interaction radius (adjusted by scale)
                        float radius = 1.5 * uGlobalScale;
                        
                        if (dist < radius) {
                            float strength = 1.0 - (dist / radius);
                            strength = pow(strength, 2.0); // smooth falloff
                            
                            // Push away from snake point horizontally
                            vec3 dir = normalize(worldPosition.xyz - sPos);
                            
                            // Flatten dir to be tangent-ish (simple repulsion)
                            accumulatedOffset += dir * strength * 0.4 * uGlobalScale;
                            
                            // Also push down slightly to make a groove?
                            // Or up to make a ridge?
                            // Let's make a ridge (push up/out)
                            accumulatedOffset += normal * strength * 0.2 * uGlobalScale;
                        }
                    }
                    
                    transformed += accumulatedOffset;
                }
                `
            );
        };

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
        // The mesh was sunk by 0.5 in base space to hide edges.
        // We replicate that offset and then scale up.
        // This ensures the physics surface matches the visual waterline.
        const hPhysical = Math.max(0, (hBase - 0.5) * scale);

        return { height: hPhysical, normal: worldNormal };
    }

    update(dt, earthRadius, snake) {
        if (this.state === 'inactive') return;
        
        // Always maintain scale ratio with Earth growth
        const globalScale = earthRadius / this.baseRadius;
        this.sandUniforms.uGlobalScale.value = globalScale;

        // Update Snake Uniforms
        if (snake && snake.segments) {
            let count = 0;
            
            // Add head
            if (count < 20) {
                this.sandUniforms.uSnakePoints.value[count].copy(snake.head.position);
                count++;
            }
            
            // Add segments (stride to save uniforms)
            for(let i=0; i<snake.segments.length; i+=2) {
                if (count >= 20) break;
                this.sandUniforms.uSnakePoints.value[count].copy(snake.segments[i].position);
                count++;
            }
            this.sandUniforms.uSnakeCount.value = count;
        }

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