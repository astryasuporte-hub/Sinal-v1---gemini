/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface GlobeHeroProps {
  onStartFreeTrial?: () => void;
  onEnterApp?: () => void;
}

export const GlobeHero: React.FC<GlobeHeroProps> = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Dimensões do container
    const width = container.clientWidth || 500;
    const height = container.clientHeight || 500;

    // Cena, Câmera e Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
    camera.position.set(0, 0.35, 5.0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    container.appendChild(renderer.domElement);

    // Geração procedural de texturas da Terra
    const W = 512;
    const H = 256;
    const land = document.createElement('canvas');
    land.width = W;
    land.height = H;
    const lctx = land.getContext('2d');
    if (lctx) {
      lctx.fillStyle = '#060a12';
      lctx.fillRect(0, 0, W, H);

      // Continentes desenhados proceduralmente com tons de azul e grafite
      lctx.fillStyle = '#1c2738';
      for (let i = 0; i < 40; i++) {
        const cx = Math.random() * W;
        const cy = Math.random() * H;
        const r = 20 + Math.random() * 45;
        lctx.beginPath();
        lctx.arc(cx, cy, r, 0, Math.PI * 2);
        lctx.fill();
      }
    }

    const landTex = new THREE.CanvasTexture(land);
    landTex.wrapS = THREE.RepeatWrapping;

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Esfera da Terra
    const earthGeo = new THREE.SphereGeometry(1.55, 64, 64);
    const earthMat = new THREE.MeshStandardMaterial({
      map: landTex,
      roughness: 0.85,
      metalness: 0.1,
      color: 0x182436,
      emissive: 0x050a14,
      emissiveIntensity: 0.7
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    globeGroup.add(earth);

    // Grid Wireframe tecnológico
    const wireGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(1.565, 24, 24));
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.15
    });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    globeGroup.add(wire);

    // Atmosfera Glow
    const atmoGeo = new THREE.SphereGeometry(1.75, 48, 48);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide
    });
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    globeGroup.add(atmo);

    // Hubs (Pontos de notícias na superfície)
    const hubs = [
      [-0.55, 0.35, 1.35],
      [0.95, 0.5, 0.95],
      [1.2, -0.2, 0.9],
      [-1.1, 0.6, 0.7],
      [0.25, 1.18, 0.8],
      [-0.45, -0.9, 1.08],
      [1.0, -0.8, 0.6],
      [-0.9, -0.4, 1.1],
      [0.45, 0.1, 1.4],
      [0.8, 0.85, 0.7]
    ];

    const hubObjs: THREE.Mesh[] = [];
    hubs.forEach(([x, y, z]) => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x4ade80 }) // Verde FatosBR
      );
      dot.position.set(x, y, z);
      globeGroup.add(dot);
      hubObjs.push(dot);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.065, 12, 12),
        new THREE.MeshBasicMaterial({
          color: 0x4ade80,
          transparent: true,
          opacity: 0.25,
          blending: THREE.AdditiveBlending
        })
      );
      halo.position.set(x, y, z);
      globeGroup.add(halo);
    });

    // Arcos de conexão entre notícias
    const arcs: THREE.Line[] = [];
    for (let a = 0; a < hubs.length; a++) {
      for (let b = a + 1; b < hubs.length; b++) {
        if (Math.random() > 0.4) continue;
        const start = new THREE.Vector3(...hubs[a]);
        const end = new THREE.Vector3(...hubs[b]);
        const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(2.05);
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const pts = curve.getPoints(40);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({
            color: 0x60a5fa,
            transparent: true,
            opacity: 0.35
          })
        );
        line.userData = {
          points: pts,
          progress: Math.random(),
          speed: 0.003 + Math.random() * 0.003
        };
        globeGroup.add(line);
        arcs.push(line);
      }
    }

    // Anéis orbitais
    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(2.15, 0.002, 8, 120),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.25 })
    );
    ring1.rotation.x = Math.PI * 0.42;
    ring1.rotation.y = Math.PI * 0.15;
    globeGroup.add(ring1);

    // Iluminação
    scene.add(new THREE.AmbientLight(0x1a2438, 1.4));
    const keyLight = new THREE.DirectionalLight(0xd0e0ff, 2.2);
    keyLight.position.set(-3, 2, 4);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x4060a0, 1.8);
    rimLight.position.set(4, -1, -3);
    scene.add(rimLight);

    // Loop de animação
    let reqId: number;
    let t = 0;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      t += 0.015;

      globeGroup.rotation.y += 0.0016;
      globeGroup.rotation.x = Math.sin(t * 0.2) * 0.03;

      // Pulsação dos hubs
      hubObjs.forEach((h, i) => {
        h.scale.setScalar(1 + Math.sin(t * 2 + i * 1.5) * 0.2);
      });

      // Animação dos arcos
      arcs.forEach((arc) => {
        arc.userData.progress += arc.userData.speed;
        if (arc.userData.progress > 1.3) arc.userData.progress = 0;
        const p = Math.min(1, arc.userData.progress);
        const total = arc.userData.points.length;
        arc.geometry.setDrawRange(0, Math.max(2, Math.floor(total * p)));
      });

      renderer.render(scene, camera);
    };

    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw === 0 || nh === 0) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener('resize', handleResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full aspect-square max-w-[580px] mx-auto flex items-center justify-center">
      {/* Canvas container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Floating Event Cards decorativos e interativos */}
      <div className="absolute top-2 left-2 z-10 p-3 rounded-xl bg-[#0c101a]/90 backdrop-blur-md border border-white/10 shadow-2xl max-w-[210px] space-y-1 animate-pulse-slow">
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          <span>AO VIVO • 3 FONTES</span>
        </div>
        <div className="text-xs font-bold text-white leading-tight">
          Acordo comercial avança em comissão setorial
        </div>
      </div>

      <div className="absolute bottom-8 right-2 z-10 p-3 rounded-xl bg-[#0c101a]/90 backdrop-blur-md border border-white/10 shadow-2xl max-w-[210px] space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] text-blue-400 font-mono">
          <span>IA & SÍNTESE FACTUAL</span>
        </div>
        <div className="text-xs font-bold text-white leading-tight">
          NVIDIA NIM deduplica 12 matérias em 1 acontecimento
        </div>
      </div>
    </div>
  );
};
