/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  RotateCcw,
  Sparkles,
  Camera,
  Maximize2,
  Globe2,
  Layers,
  Check,
  Eye,
  Activity,
  Sliders
} from 'lucide-react';

interface ThreeGlobeSceneProps {
  onCaptureSnapshot?: (dataUrl: string) => void;
  colorTheme?: 'vibrant' | 'monochrome' | 'gold';
  className?: string;
  showControls?: boolean;
}

// Capitais de Notícias e Mercados Globais (Latitude / Longitude)
const GLOBAL_HUBS = [
  { name: 'Brasília', lat: -15.78, lon: -47.93, tag: 'Política & Poder', color: 0xf59e0b, news: 'Votações fiscais e reformas no Congresso Nacional' },
  { name: 'São Paulo', lat: -23.55, lon: -46.63, tag: 'B3 & Finanças', color: 0x10b981, news: 'Ibovespa, juros futuros e negociações corporativas' },
  { name: 'Nova York', lat: 40.71, lon: -74.00, tag: 'Wall Street & Fed', color: 0x06b6d4, news: 'Decisões de juros do FOMC e índices S&P 500 / Nasdaq' },
  { name: 'Londres', lat: 51.50, lon: -0.12, tag: 'Mercados Europeus', color: 0x8b5cf6, news: 'Bank of England e cotações de commodities de Londres' },
  { name: 'Tóquio', lat: 35.68, lon: 139.69, tag: 'Ásia & Tecnologia', color: 0xec4899, news: 'Nikkei 225 e cadeias globais de semicondutores' },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68, tag: 'Banco Central Europeu', color: 0x3b82f6, news: 'Balanço da zona do euro e política monetária do BCE' }
];

export const ThreeGlobeScene: React.FC<ThreeGlobeSceneProps> = ({
  onCaptureSnapshot,
  colorTheme = 'vibrant',
  className = '',
  showControls = true
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [isRotating, setIsRotating] = useState(true);
  const [activeHub, setActiveHub] = useState<typeof GLOBAL_HUBS[0] | null>(GLOBAL_HUBS[0]);
  const [snapshotTaken, setSnapshotTaken] = useState(false);
  const [theme, setTheme] = useState<'vibrant' | 'monochrome' | 'gold'>(colorTheme);

  // Helper para converter lat/lon em coordenadas cartesianas 3D
  const latLonToVector3 = (lat: number, lon: number, radius: number): THREE.Vector3 => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    return new THREE.Vector3(x, y, z);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    // 1. Detecção de Software WebGL (conforme diretrizes Three.js)
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Cena, Câmera e Renderizador PBR de Estúdio
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 1.2, 5.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSoftwareGl ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 3. Iluminação de Estúdio Profissional (Key, Fill, Rim)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(5, 5, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(theme === 'monochrome' ? 0xaaaaaa : 0x06b6d4, 0.9);
    fillLight.position.set(-5, -2, -3);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(theme === 'gold' ? 0xf59e0b : theme === 'monochrome' ? 0xffffff : 0x10b981, 3.5, 20);
    rimLight.position.set(0, 4, -4);
    scene.add(rimLight);

    // 4. Grupo Composto Procedural do Globo (3 a 12 peças distintas)
    const globeGroup = new THREE.Group();
    globeGroupRef.current = globeGroup;
    scene.add(globeGroup);

    const globeRadius = 1.8;

    // Peça 1: Núcleo Interno Obsidian PBR (Superfície metálica de alto contraste)
    const coreGeo = new THREE.SphereGeometry(globeRadius, 64, 64);
    const coreMat = new THREE.MeshStandardMaterial({
      color: theme === 'monochrome' ? 0x08090c : theme === 'gold' ? 0x121008 : 0x07090e,
      roughness: 0.28,
      metalness: 0.82,
      wireframe: false
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    globeGroup.add(coreMesh);

    // Peça 2: Grade de Latitude & Longitude Procedural (Wireframe estilizado)
    const wireGeo = new THREE.SphereGeometry(globeRadius + 0.008, 36, 18);
    const wireMat = new THREE.MeshBasicMaterial({
      color: theme === 'monochrome' ? 0x333338 : theme === 'gold' ? 0xb45309 : 0x1e293b,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    globeGroup.add(wireMesh);

    // Peça 3: Halo Atmosférico Externo com Brilho Suave
    const atmoGeo = new THREE.SphereGeometry(globeRadius + 0.08, 48, 48);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: theme === 'monochrome' ? 0x475569 : theme === 'gold' ? 0xf59e0b : 0x38bdf8,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    globeGroup.add(atmoMesh);

    // Peça 4: Anéis Equatoriais e Polares (Torus de Precisão)
    const ringGeo = new THREE.TorusGeometry(globeRadius + 0.15, 0.012, 16, 100);
    const ringMat = new THREE.MeshStandardMaterial({
      color: theme === 'monochrome' ? 0xffffff : theme === 'gold' ? 0xfbbf24 : 0x06b6d4,
      emissive: theme === 'monochrome' ? 0x444444 : theme === 'gold' ? 0x92400e : 0x0891b2,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.9
    });
    const equatorRing = new THREE.Mesh(ringGeo, ringMat);
    equatorRing.rotation.x = Math.PI / 2;
    globeGroup.add(equatorRing);

    const orbitRing = new THREE.Mesh(ringGeo, ringMat);
    orbitRing.rotation.x = Math.PI / 4;
    orbitRing.rotation.y = Math.PI / 6;
    globeGroup.add(orbitRing);

    // Peça 5: Beacons de Notícias das Capitais Globais (Procedural Pins)
    const hubPositions: THREE.Vector3[] = [];
    GLOBAL_HUBS.forEach((hub) => {
      const pos = latLonToVector3(hub.lat, hub.lon, globeRadius);
      hubPositions.push(pos);

      // Base do pino
      const pinBaseGeo = new THREE.CylinderGeometry(0.04, 0.02, 0.12, 12);
      const pinMat = new THREE.MeshStandardMaterial({
        color: theme === 'monochrome' ? 0xffffff : hub.color,
        emissive: theme === 'monochrome' ? 0x666666 : hub.color,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.8
      });
      const pinBase = new THREE.Mesh(pinBaseGeo, pinMat);

      // Alinha o pino radialmente perpendicular à superfície da esfera
      pinBase.position.copy(pos);
      pinBase.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
      globeGroup.add(pinBase);

      // Esfera brilhante na ponta do pino
      const tipGeo = new THREE.SphereGeometry(0.05, 16, 16);
      const tipMesh = new THREE.Mesh(tipGeo, pinMat);
      tipMesh.position.copy(pos.clone().add(pos.clone().normalize().multiplyScalar(0.09)));
      globeGroup.add(tipMesh);
    });

    // Peça 6: Arcos Tridimensionais de Fluxo de Notícias (Conectando Brasília às capitais)
    if (hubPositions.length >= 2) {
      const brasiliaPos = hubPositions[0]; // Brasília
      for (let i = 1; i < hubPositions.length; i++) {
        const targetPos = hubPositions[i];
        const midPoint = brasiliaPos.clone().lerp(targetPos, 0.5);
        // Eleva o ponto médio para formar o arco tridimensional
        midPoint.normalize().multiplyScalar(globeRadius + 0.55);

        const curve = new THREE.QuadraticBezierCurve3(brasiliaPos, midPoint, targetPos);
        const arcGeo = new THREE.TubeGeometry(curve, 32, 0.008, 8, false);
        const arcMat = new THREE.MeshBasicMaterial({
          color: theme === 'monochrome' ? 0x94a3b8 : 0x38bdf8,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending
        });
        const arcMesh = new THREE.Mesh(arcGeo, arcMat);
        globeGroup.add(arcMesh);
      }
    }

    // Peça 7: Campo de Partículas Estelares Órbitas (1.200 partículas procedurais)
    const starCount = 900;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      const r = 2.6 + Math.random() * 4.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      starPositions[i] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i + 2] = r * Math.cos(phi);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: theme === 'monochrome' ? 0xffffff : 0x93c5fd,
      size: 0.025,
      transparent: true,
      opacity: 0.65
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // 5. Interação com Mouse / Touch (Arrastar para girar livremente)
    let isDragging = false;
    let prevMousePos = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMousePos = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !globeGroupRef.current) return;
      const deltaX = e.clientX - prevMousePos.x;
      const deltaY = e.clientY - prevMousePos.y;

      globeGroupRef.current.rotation.y += deltaX * 0.006;
      globeGroupRef.current.rotation.x += deltaY * 0.006;

      prevMousePos = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Touch support
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging = true;
        prevMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging || !globeGroupRef.current || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - prevMousePos.x;
      const deltaY = e.touches[0].clientY - prevMousePos.y;
      globeGroupRef.current.rotation.y += deltaX * 0.008;
      globeGroupRef.current.rotation.x += deltaY * 0.008;
      prevMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchEnd = () => {
      isDragging = false;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    // 6. Loop de Animação com Clock
    const clock = new THREE.Clock();
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (globeGroupRef.current && isRotating && !isDragging) {
        globeGroupRef.current.rotation.y += delta * 0.22;
      }

      // Rotação suave do campo estelar
      starField.rotation.y -= delta * 0.05;

      renderer.render(scene, camera);
    };
    animate();

    // 7. Responsividade
    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const newW = containerRef.current.clientWidth;
      const newH = containerRef.current.clientHeight;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };
    window.addEventListener('resize', handleResize);

    // 8. Limpeza de Recursos (Disposal rigoroso Three.js)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);

      // Dispose de geometrias e materiais
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, [theme, isRotating]);

  // Capturar Snapshot do Canvas 3D para usar como imagem de fundo no carrossel
  const handleCaptureSnapshot = () => {
    if (!rendererRef.current) return;
    const dataUrl = rendererRef.current.domElement.toDataURL('image/png', 0.95);
    setSnapshotTaken(true);
    setTimeout(() => setSnapshotTaken(false), 2500);
    if (onCaptureSnapshot) {
      onCaptureSnapshot(dataUrl);
    }
  };

  return (
    <div className={`relative flex flex-col rounded-2xl bg-[#07080c] border border-zinc-800/80 overflow-hidden shadow-2xl ${className}`}>
      {/* Top Header com Status */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="p-1.5 rounded-lg bg-black/70 backdrop-blur-md border border-zinc-700/60 text-white flex items-center gap-1.5">
            <Globe2 className="w-4 h-4 text-emerald-400 animate-spin-slow" />
            <span className="text-[11px] font-bold tracking-tight">Fatos BR 3D · Conexões Globais</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-zinc-800 text-[10px] font-mono text-zinc-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Three.js PBR Studio</span>
          </div>
        </div>

        {/* Controles de Tema 3D */}
        {showControls && (
          <div className="flex items-center gap-1.5 pointer-events-auto bg-black/70 backdrop-blur-md p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setTheme('vibrant')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                theme === 'vibrant'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Cores Vivas
            </button>
            <button
              onClick={() => setTheme('monochrome')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                theme === 'monochrome'
                  ? 'bg-zinc-200 text-black border border-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              P&B Editorial
            </button>
            <button
              onClick={() => setTheme('gold')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                theme === 'gold'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Ouro Executivo
            </button>
          </div>
        )}
      </div>

      {/* Canvas 3D interativo */}
      <div
        ref={containerRef}
        className="w-full h-80 sm:h-96 cursor-grab active:cursor-grabbing relative"
        title="Clique e arraste para girar a cena 3D"
      />

      {/* Barra Inferior com Hub Selecionado & Ação de Captura */}
      <div className="p-3 bg-black/85 backdrop-blur-md border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar w-full sm:w-auto">
          {GLOBAL_HUBS.map((hub) => (
            <button
              key={hub.name}
              onClick={() => setActiveHub(hub)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition shrink-0 cursor-pointer ${
                activeHub?.name === hub.name
                  ? 'bg-zinc-800 border-white text-white'
                  : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>{hub.name}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={() => setIsRotating(!isRotating)}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 transition cursor-pointer"
            title={isRotating ? 'Pausar Rotação' : 'Ativar Rotação'}
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin-slow' : ''}`} />
          </button>

          {onCaptureSnapshot && (
            <button
              onClick={handleCaptureSnapshot}
              className="px-3 py-1.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="Capturar o ângulo 3D atual e aplicar como fundo no post do Instagram"
            >
              {snapshotTaken ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Fundo 3D Aplicado!</span>
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" />
                  <span>Usar 3D no Carrossel</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Detalhes do Hub Ativo */}
      {activeHub && (
        <div className="px-4 py-2 bg-[#090b10] border-t border-zinc-900 text-[11px] flex items-center justify-between text-zinc-400">
          <span className="font-semibold text-white">
            📍 {activeHub.name} ({activeHub.tag}):
          </span>
          <span className="truncate max-w-sm text-zinc-300 ml-2">{activeHub.news}</span>
        </div>
      )}
    </div>
  );
};
