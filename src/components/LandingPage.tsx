/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface LandingPageProps {
  onStartFreeTrial: () => void;
  onEnterApp: () => void;
  onOpenAuth?: () => void;
  onOpenLegal?: (tab?: 'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo') => void;
}

const LANDING_CSS = `
  :root{
    --bg:#050506;
    --surface:#0b0b0e;
    --border:rgba(255,255,255,0.07);
    --border-strong:rgba(255,255,255,0.14);
    --text:#f8f8f9;
    --text-soft:#d4d4dc;
    --text-muted:#a0a0a8;
    --text-dim:#63636b;
    --accent:#4ade80;
    --radius:14px;
    --radius-lg:24px;
    --max:1400px;
    --pad:clamp(20px, 4vw, 60px);
    --ease:cubic-bezier(0.22, 1, 0.36, 1);
    --ease-out:cubic-bezier(0.16, 1, 0.3, 1);
    --safe-b: env(safe-area-inset-bottom, 0px);
  }

  .fatosbr-landing-wrapper{
    box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;
    background:var(--bg);color:var(--text);
    font-family:'Inter',system-ui,-apple-system,sans-serif;
    font-size:16.5px;line-height:1.55;-webkit-font-smoothing:antialiased;
    overflow-x:hidden;width:100%;min-height:100vh;position:relative;
  }
  .fatosbr-landing-wrapper *{box-sizing:border-box}
  .fatosbr-landing-wrapper a{color:inherit;text-decoration:none}
  .fatosbr-landing-wrapper button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
  .fatosbr-landing-wrapper img{max-width:100%;display:block}

  /* Overlays */
  .grain{
    position:fixed;inset:0;pointer-events:none;z-index:200;opacity:.035;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.7'/></svg>");
    mix-blend-mode:overlay;
  }
  .vignette{
    position:fixed;inset:0;pointer-events:none;z-index:190;
    background:radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.45) 100%);
    mix-blend-mode:multiply;
  }
  .cursor-dot,.cursor-ring{
    position:fixed;top:0;left:0;pointer-events:none;z-index:250;
    transform:translate(-50%,-50%);will-change:transform;
  }
  .cursor-dot{width:6px;height:6px;border-radius:50%;background:#fff;mix-blend-mode:difference}
  .cursor-ring{
    width:32px;height:32px;border-radius:50%;
    border:1px solid rgba(255,255,255,0.35);
    transition:width .35s var(--ease-out),height .35s var(--ease-out),border-color .35s;
  }
  .cursor-ring.hover{width:52px;height:52px;border-color:rgba(255,255,255,0.7)}
  @media (hover:none),(max-width:900px){.cursor-dot,.cursor-ring,.grain,.vignette{display:none}}

  .scroll-progress{
    position:fixed;top:0;left:0;height:1.5px;
    background:linear-gradient(90deg,#fff,rgba(255,255,255,0.15));
    z-index:300;width:0%;transition:width .08s linear;
  }

  /* Preloader */
  .preloader{
    position:fixed;inset:0;z-index:400;background:var(--bg);
    display:flex;align-items:center;justify-content:center;
    transition:opacity .6s var(--ease), visibility .6s;
  }
  .preloader.done{opacity:0;visibility:hidden;pointer-events:none}
  .preloader-inner{display:flex;flex-direction:column;align-items:center;gap:22px}
  .preloader-mark{width:56px;height:34px}
  .preloader-mark svg{width:100%;height:100%}
  .preloader-mark path{stroke-dasharray:200;stroke-dashoffset:200;animation:drawLine 1.5s ease-in-out infinite}
  @keyframes drawLine{0%{stroke-dashoffset:200}50%{stroke-dashoffset:0}100%{stroke-dashoffset:-200}}
  .preloader-text{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--text-dim);letter-spacing:.24em;text-transform:uppercase}
  .preloader-bar{width:140px;height:1px;background:var(--border);overflow:hidden;position:relative}
  .preloader-bar::after{
    content:"";position:absolute;top:0;left:0;height:100%;width:40%;
    background:linear-gradient(90deg,transparent,#fff,transparent);
    animation:preloaderBar 1.2s ease-in-out infinite;
  }
  @keyframes preloaderBar{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}

  .wrap{width:100%;max-width:var(--max);margin:0 auto;padding-left:var(--pad);padding-right:var(--pad)}

  /* Typography */
  .eyebrow{
    font-size:11.5px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;
    color:var(--text-muted);display:inline-flex;align-items:center;gap:10px;
  }
  .eyebrow::before{content:"";width:20px;height:1px;background:var(--border-strong)}
  .fatosbr-landing-wrapper h1,
  .fatosbr-landing-wrapper h2,
  .fatosbr-landing-wrapper h3{font-weight:500;letter-spacing:-.028em;line-height:1.06}
  .fatosbr-landing-wrapper h1{font-size:clamp(2.6rem, 5.4vw, 5rem);line-height:1.0;letter-spacing:-.035em}
  .fatosbr-landing-wrapper h2{font-size:clamp(1.9rem, 3.8vw, 3rem)}
  .fatosbr-landing-wrapper h3{font-size:clamp(1.05rem, 1.5vw, 1.32rem);font-weight:500;letter-spacing:-.015em}
  .fatosbr-landing-wrapper p{color:var(--text-muted);font-size:1.03rem;line-height:1.65}
  .lead{font-size:clamp(1.05rem, 1.15vw, 1.16rem);color:var(--text-soft);line-height:1.6}

  .word{display:inline-block;opacity:0;transform:translateY(0.8em) rotateX(-40deg);
    transform-origin:50% 100%;
    transition:opacity .9s var(--ease-out), transform .9s var(--ease-out);will-change:transform,opacity}
  .words-in .word{opacity:1;transform:none}

  /* Buttons */
  .btn{
    display:inline-flex;align-items:center;justify-content:center;gap:9px;
    padding:13px 22px;border-radius:999px;
    font-size:14.5px;font-weight:500;letter-spacing:-.005em;
    transition:background .3s var(--ease), color .3s var(--ease), border-color .3s var(--ease), transform .5s var(--ease-out);
    white-space:nowrap;position:relative;overflow:hidden;min-height:48px;
  }
  .btn-primary{background:#fff;color:#000}
  .btn-primary::before{
    content:"";position:absolute;inset:0;border-radius:999px;
    background:radial-gradient(circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,0.9), transparent 45%);
    opacity:0;transition:opacity .35s var(--ease);pointer-events:none;
  }
  .btn-primary:hover::before{opacity:.4}
  .btn-primary:hover{background:#eaeaea}
  .btn-ghost{background:transparent;color:var(--text);border:1px solid var(--border-strong)}
  .btn-ghost:hover{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.28)}
  .btn-lg{padding:16px 28px;font-size:15.5px;min-height:54px}
  .btn svg{width:14px;height:14px;transition:transform .4s var(--ease-out)}
  .btn:hover svg{transform:translateX(3px)}
  .btn:focus-visible,a:focus-visible,button:focus-visible{outline:2px solid #fff;outline-offset:3px;border-radius:6px}

  /* FLOATING NAVBAR */
  .navbar-shell{
    position:fixed;top:16px;left:50%;transform:translateX(-50%);
    z-index:100;width:calc(100% - 40px);max-width:1180px;
    transition:top .4s var(--ease), max-width .4s var(--ease);
  }
  .navbar{
    display:flex;align-items:center;justify-content:space-between;
    height:64px;padding:8px 8px 8px 20px;
    background:rgba(10,10,12,0.62);
    backdrop-filter:blur(20px) saturate(1.6);
    -webkit-backdrop-filter:blur(20px) saturate(1.6);
    border:1px solid rgba(255,255,255,0.08);
    border-radius:100px;
    box-shadow:0 16px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
    transition:background .4s var(--ease), border-color .4s var(--ease), box-shadow .4s var(--ease);
  }
  .navbar-shell.scrolled .navbar{
    background:rgba(8,8,10,0.85);
    border-color:rgba(255,255,255,0.12);
    box-shadow:0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:16px;letter-spacing:-.02em;flex-shrink:0}
  .brand-mark{width:28px;height:20px;display:inline-block}
  .brand-mark svg{width:100%;height:100%}
  .nav-links{display:flex;align-items:center;gap:6px}
  .nav-links a{
    font-size:13.5px;color:var(--text-soft);font-weight:500;
    padding:9px 14px;border-radius:99px;
    transition:color .2s, background .2s;
  }
  .nav-links a:hover{color:#fff;background:rgba(255,255,255,0.06)}
  .nav-cta{display:flex;align-items:center;gap:8px;flex-shrink:0}
  .nav-cta .login{font-size:13.5px;color:var(--text-soft);transition:color .2s;padding:9px 14px;border-radius:99px}
  .nav-cta .login:hover{color:#fff;background:rgba(255,255,255,0.06)}
  .nav-cta .btn{padding:10px 20px;font-size:13.5px;min-height:44px}
  .nav-cta .btn svg{width:13px;height:13px}
  .burger{
    display:none;width:44px;height:44px;border-radius:99px;
    border:1px solid var(--border);align-items:center;justify-content:center;
    transition:background .25s;
  }
  .burger:hover{background:rgba(255,255,255,0.05)}
  .burger svg{width:17px;height:17px}

  @media (max-width:1000px){
    .nav-links{display:none}
    .nav-cta .login{display:inline-flex;padding:7px 11px;font-size:12.5px}
    .burger{display:flex}
  }
  @media (max-width:600px){
    .navbar-shell{top:8px;width:calc(100% - 16px)}
    .navbar{height:54px;padding:4px 6px 4px 12px}
    .brand{font-size:14px}
    .brand-mark{width:22px;height:16px}
    .nav-cta .login{display:inline-flex;padding:6px 10px;font-size:12px}
    .nav-cta .btn{padding:8px 12px;font-size:12px;min-height:36px}
  }

  /* Drawer */
  .drawer{
    position:fixed;inset:0;z-index:150;
    background:rgba(4,4,5,0.97);
    backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
    opacity:0;visibility:hidden;
    transition:opacity .35s var(--ease), visibility .35s;
    display:flex;flex-direction:column;padding:20px var(--pad);
  }
  .drawer.open{opacity:1;visibility:visible}
  .drawer-top{display:flex;justify-content:space-between;align-items:center;height:62px;margin-bottom:40px}
  .drawer-close{width:44px;height:44px;border-radius:99px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center}
  .drawer-nav{display:flex;flex-direction:column;gap:4px;margin-bottom:auto}
  .drawer-nav a{
    font-size:26px;font-weight:500;letter-spacing:-.025em;color:#eaeaea;
    padding:16px 0;border-bottom:1px solid var(--border);
    display:flex;justify-content:space-between;align-items:center;
    transition:color .2s, transform .3s var(--ease-out);
  }
  .drawer-nav a:hover{color:#fff;transform:translateX(4px)}
  .drawer-nav a svg{width:18px;height:18px;opacity:.4}
  .drawer-cta{margin-top:32px;display:flex;flex-direction:column;gap:12px;padding-bottom:24px}

  /* Sticky mobile CTA */
  .sticky-cta{
    display:none;position:fixed;bottom:0;left:0;right:0;z-index:90;
    padding:12px var(--pad) calc(12px + var(--safe-b));
    background:linear-gradient(180deg, transparent, rgba(4,4,5,0.94) 40%);
    backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
    border-top:1px solid var(--border);
    transform:translateY(120%);transition:transform .45s var(--ease-out);
    align-items:center;gap:14px;
  }
  .sticky-cta.show{transform:translateY(0)}
  .sticky-cta-info{flex:1;min-width:0}
  .sticky-cta-title{font-size:13.5px;color:#eaeaea;font-weight:500;letter-spacing:-.01em}
  .sticky-cta-sub{font-size:11.5px;color:var(--text-dim);margin-top:2px}
  .sticky-cta .btn-primary{padding:11px 20px;font-size:14px;min-height:44px;flex-shrink:0}
  @media (max-width:900px){.sticky-cta{display:flex}}

  /* HERO */
  .hero{
    position:relative;padding:150px 0 80px;
    overflow:hidden;isolation:isolate;
    background:
      radial-gradient(ellipse 60% 55% at 75% 50%, rgba(60,80,110,0.22), transparent 65%),
      radial-gradient(ellipse 40% 40% at 15% 25%, rgba(30,35,50,0.35), transparent 70%),
      var(--bg);
  }
  .hero::after{
    content:"";position:absolute;left:0;right:0;bottom:0;height:200px;
    background:linear-gradient(180deg, transparent, var(--bg));pointer-events:none;z-index:3;
  }
  .orb{
    position:absolute;border-radius:50%;pointer-events:none;z-index:0;
    filter:blur(80px);opacity:.35;
  }
  .orb.o1{
    width:520px;height:520px;top:-10%;right:-5%;
    background:radial-gradient(circle, rgba(80,120,180,0.5), transparent 70%);
    animation:orbFloat1 22s ease-in-out infinite;
  }
  .orb.o2{
    width:400px;height:400px;bottom:10%;left:-8%;
    background:radial-gradient(circle, rgba(120,90,180,0.35), transparent 70%);
    animation:orbFloat2 28s ease-in-out infinite;
  }
  @keyframes orbFloat1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-40px,30px) scale(1.1)}}
  @keyframes orbFloat2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(50px,-30px) scale(1.15)}}
  @media (max-width:900px){.orb{display:none}}

  .hero-grid{
    display:grid;
    grid-template-columns:minmax(0, 1fr) minmax(0, 1.05fr);
    gap:clamp(24px, 3vw, 56px);
    align-items:center;
    min-height:calc(100svh - 220px);
    position:relative;z-index:2;
  }
  .hero-copy{max-width:560px;justify-self:start}
  .hero-copy .eyebrow{
    margin-bottom:24px;padding:8px 16px;border-radius:99px;
    background:rgba(255,255,255,0.03);border:1px solid var(--border);
    font-size:11px;letter-spacing:.18em;color:var(--text-soft);
  }
  .hero-copy .eyebrow::before{display:none}
  .hero-copy .eyebrow .eyebrow-dot{
    width:5px;height:5px;border-radius:50%;background:var(--accent);
    box-shadow:0 0 8px rgba(74,222,128,0.8);
  }
  .hero-copy h1{margin-bottom:26px}
  .hero-copy .lead{margin-bottom:36px;max-width:530px}
  .hero-actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
  .hero-proof{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .hero-avatars{display:flex}
  .hero-avatars span{
    width:28px;height:28px;border-radius:50%;border:2px solid var(--bg);
    background:linear-gradient(135deg, #2a3040, #101318);
    margin-right:-8px;display:flex;align-items:center;justify-content:center;
    font-size:10px;font-weight:600;color:#c8c8d0;
  }
  .hero-avatars span:nth-child(1){background:linear-gradient(135deg,#3a4456,#1a1f2a)}
  .hero-avatars span:nth-child(2){background:linear-gradient(135deg,#4a5a70,#202836)}
  .hero-avatars span:nth-child(3){background:linear-gradient(135deg,#2f3a4a,#151a24)}
  .hero-avatars span:nth-child(4){background:linear-gradient(135deg,#3d4555,#1a1f28)}
  .hero-proof-text{font-size:12.5px;color:var(--text-muted)}
  .hero-proof-text strong{color:#e0e0e6;font-weight:500}
  .hero-microcopy{font-size:12.5px;color:var(--text-dim);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .hero-microcopy .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);
    box-shadow:0 0 10px rgba(74,222,128,0.8);animation:pulseDot 2.4s ease-in-out infinite}
  @keyframes pulseDot{
    0%,100%{opacity:1;box-shadow:0 0 10px rgba(74,222,128,0.8)}
    50%{opacity:.55;box-shadow:0 0 4px rgba(74,222,128,0.4)}
  }

  /* Globe stage */
  .stage{
    position:relative;width:100%;aspect-ratio:1/1;max-width:920px;
    justify-self:end;overflow:hidden;
    opacity:0;transition:opacity 1.4s var(--ease-out) .25s;
    pointer-events:none;
  }
  .stage.ready{opacity:1}
  #globe-canvas{position:absolute;inset:0;width:100%;height:100%;filter:saturate(0.5) contrast(1.08)}
  .stage-fallback{
    position:absolute;inset:0;border-radius:50%;
    background:radial-gradient(circle at 40% 35%, #1a1d24 0%, #0a0b0e 60%, #050506 100%);
    box-shadow:inset 0 0 120px rgba(120,140,180,0.12), 0 0 80px rgba(0,0,0,0.9);
    display:none;
  }
  .stage.no-webgl .stage-fallback{display:block}
  .stage.no-webgl #globe-canvas{display:none}

  /* Event cards */
  .event-card{
    position:absolute;
    background:linear-gradient(180deg, rgba(20,20,24,0.82), rgba(14,14,17,0.76));
    backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);
    border:1px solid rgba(255,255,255,0.10);border-radius:14px;padding:12px 14px;
    min-width:230px;max-width:290px;
    box-shadow:0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06);
    opacity:0;transform:translateY(28px) scale(.92);
    transition:opacity 1s var(--ease-out), transform 1.1s var(--ease-out);
    will-change:transform, opacity;pointer-events:none;
  }
  .stage.ready .event-card{opacity:1;transform:translateY(0) scale(1)}
  .stage.ready .event-card.card-a{transition-delay:.4s}
  .stage.ready .event-card.card-b{transition-delay:.6s}
  .stage.ready .event-card.card-c{transition-delay:.8s}
  .stage.ready .event-card.card-d{transition-delay:1s}
  .event-card::before{content:"";position:absolute;inset:0;border-radius:14px;
    background:linear-gradient(180deg, rgba(255,255,255,0.06), transparent 40%);pointer-events:none}
  .event-card.float-a{animation:floatA 9s ease-in-out infinite}
  .event-card.float-b{animation:floatB 11s ease-in-out infinite}
  .event-card.float-c{animation:floatA 13s ease-in-out infinite reverse}
  .event-card.float-d{animation:floatB 10s ease-in-out infinite reverse}
  @keyframes floatA{0%,100%{transform:translateY(0) translateX(0)}50%{transform:translateY(-12px) translateX(5px)}}
  @keyframes floatB{0%,100%{transform:translateY(0) translateX(0)}50%{transform:translateY(-10px) translateX(-4px)}}

  .ec-head{display:flex;align-items:center;gap:9px;margin-bottom:9px;position:relative}
  .ec-ico{width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .ec-ico svg{width:11px;height:11px;opacity:.9}
  .ec-title{font-size:12.5px;font-weight:500;color:#ececef;line-height:1.35;letter-spacing:-.005em}
  .ec-meta{display:flex;align-items:center;gap:11px;font-size:11px;color:var(--text-dim);margin-top:8px;position:relative}
  .ec-meta span{display:flex;align-items:center;gap:4px}
  .ec-pulse{position:absolute;top:8px;right:8px;width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px rgba(74,222,128,0.9);animation:pulseDot 2s ease-in-out infinite}

  .card-a{top:5%;left:2%}
  .card-b{top:28%;right:3%}
  .card-c{bottom:22%;left:5%}
  .card-d{bottom:6%;right:6%}

  @media (max-width:1100px){
    .hero-grid{grid-template-columns:1fr;gap:28px;min-height:0;padding-top:10px}
    .hero-copy{max-width:none}
    .stage{max-width:min(660px, 92vw);justify-self:center;margin:0 auto}
    .event-card{min-width:200px;padding:12px 14px;max-width:250px}
    .event-card .ec-title{font-size:12px}
    .card-a{top:2%;left:0}.card-b{top:32%;right:0}
    .card-c{bottom:18%;left:2%}.card-d{bottom:2%;right:4%}
  }
  @media (max-width:900px){
    .hero{padding:120px 0 30px;min-height:auto}
    .hero::after{height:100px}
    .hero-copy h1{font-size:clamp(2.2rem, 7.5vw, 3.4rem)}
    .stage{max-width:min(520px, 94vw)}
    .event-card{min-width:172px;padding:10px 12px;max-width:220px}
    .event-card .ec-title{font-size:11px;line-height:1.3}
    .event-card .ec-meta{font-size:10px}
    .hero-actions{gap:8px}
    .hero-actions .btn{flex:1 1 auto;min-width:0;padding:14px 18px;font-size:14.5px}
    .event-card.card-c,.event-card.card-d{display:none}
    .card-a{top:0;left:-2%;max-width:180px}
    .card-b{top:40%;right:-2%;max-width:180px}
  }

  /* Section base */
  section.block{
    padding:clamp(70px, 9vw, 130px) 0;
    position:relative;isolation:isolate;overflow:hidden;
  }
  section.block::before{
    content:"";
    position:absolute;top:0;left:20%;right:20%;height:1px;
    background:linear-gradient(90deg, transparent,
      rgba(var(--section-accent, 160,160,180), 0.35), transparent);
    pointer-events:none;
  }
  section.block::after{
    content:"";
    position:absolute;top:-100px;left:50%;transform:translateX(-50%);
    width:60%;max-width:900px;height:400px;
    background:radial-gradient(ellipse 50% 60% at 50% 50%,
      rgba(var(--section-accent, 160,160,180), 0.07), transparent 70%);
    pointer-events:none;z-index:-1;
  }

  #problema{--section-accent:251,146,60}
  #comparacao-antes-depois{--section-accent:248,113,113}
  #comparacao{--section-accent:250,204,21}
  #produto{--section-accent:96,165,250}
  #demonstracao{--section-accent:34,211,238}
  #funcionalidades{--section-accent:167,139,250}
  #numeros{--section-accent:74,222,128}
  #como-funciona{--section-accent:148,163,184}
  #para-quem{--section-accent:244,114,182}
  #confianca{--section-accent:74,222,128}
  #planos{--section-accent:96,165,250}
  #faq{--section-accent:167,139,250}

  #problema .eyebrow{color:#c8a882}
  #problema .eyebrow::before{background:rgba(251,146,60,0.4)}
  #comparacao-antes-depois .eyebrow{color:#c89494}
  #comparacao-antes-depois .eyebrow::before{background:rgba(248,113,113,0.4)}
  #comparacao .eyebrow{color:#d4c082}
  #comparacao .eyebrow::before{background:rgba(250,204,21,0.4)}
  #produto .eyebrow{color:#8aa8cc}
  #produto .eyebrow::before{background:rgba(96,165,250,0.4)}
  #demonstracao .eyebrow{color:#7db8c4}
  #demonstracao .eyebrow::before{background:rgba(34,211,238,0.4)}
  #funcionalidades .eyebrow{color:#a89cc8}
  #funcionalidades .eyebrow::before{background:rgba(167,139,250,0.4)}
  #numeros .eyebrow{color:#8ac89a}
  #numeros .eyebrow::before{background:rgba(74,222,128,0.4)}
  #para-quem .eyebrow{color:#c89cb8}
  #para-quem .eyebrow::before{background:rgba(244,114,182,0.4)}
  #confianca .eyebrow{color:#8ac89a}
  #planos .eyebrow{color:#8aa8cc}
  #faq .eyebrow{color:#a89cc8}

  .section-head{max-width:780px;margin-bottom:clamp(36px,5vw,60px);position:relative}
  .section-head h2{margin:18px 0 20px}
  .section-head p{max-width:620px;font-size:1.03rem}
  .section-label{position:absolute;top:0;right:0;font-family:'JetBrains Mono',monospace;
    font-size:11px;color:var(--text-dim);letter-spacing:.08em}
  @media (max-width:900px){
    .section-label{display:none}
    .section-head{margin-bottom:32px}
    .section-head h2{margin:14px 0 14px}
    .section-head p{font-size:15px}
    section.block{padding:clamp(56px,8vw,90px) 0}
    section.block::after{width:80%;height:300px}
  }

  .reveal{opacity:0;transform:translateY(26px);transition:opacity .9s var(--ease-out), transform .9s var(--ease-out)}
  .reveal.in{opacity:1;transform:none}
  .reveal.d1{transition-delay:.08s}.reveal.d2{transition-delay:.16s}.reveal.d3{transition-delay:.24s}

  /* PROBLEM */
  .problem-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:60px;align-items:center}
  .problem-visual{
    position:relative;height:440px;border-radius:var(--radius-lg);
    background:linear-gradient(180deg, #0a0a0d 0%, #060608 100%);
    border:1px solid rgba(251,146,60,0.14);overflow:hidden;
  }
  .problem-visual::before{
    content:"";position:absolute;inset:0;
    background-image:repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 5px);
    opacity:.4;pointer-events:none;
  }
  .problem-visual::after{
    content:"";position:absolute;inset:0;
    background:radial-gradient(circle at 50% 55%, transparent 20%, var(--bg) 95%);
    pointer-events:none;z-index:1;
  }
  .scatter-item{
    position:absolute;background:rgba(251,146,60,0.05);
    border:1px solid rgba(251,146,60,0.16);border-radius:10px;
    padding:10px 12px;font-size:11.5px;color:#c0c0c8;max-width:190px;
    line-height:1.4;z-index:2;backdrop-filter:blur(8px);
    box-shadow:0 6px 20px rgba(0,0,0,0.4);
    transition:transform 1.6s var(--ease-out), opacity 1.6s var(--ease-out);
    will-change:transform, opacity;
  }
  .scatter-item .si-tag{
    display:block;font-size:9px;letter-spacing:.14em;text-transform:uppercase;
    color:#c89468;margin-bottom:5px;font-family:'JetBrains Mono',monospace;
  }
  .problem-visual:not(.in) .scatter-item{opacity:0.10}
  .problem-visual.in .scatter-item{opacity:1}
  .problem-visual.in .scatter-item.s1{transform:translate(26%, 42%) rotate(0deg) scale(.82)}
  .problem-visual.in .scatter-item.s2{transform:translate(-20%, 30%) rotate(0deg) scale(.82)}
  .problem-visual.in .scatter-item.s3{transform:translate(16%, 8%) rotate(0deg) scale(.82)}
  .problem-visual.in .scatter-item.s4{transform:translate(-28%, 4%) rotate(0deg) scale(.82)}
  .problem-visual.in .scatter-item.s5{transform:translate(30%, -16%) rotate(0deg) scale(.82)}
  .problem-visual.in .scatter-item.s6{transform:translate(-24%, -32%) rotate(0deg) scale(.82)}
  .problem-visual.in .scatter-item.s7{transform:translate(-4%, 26%) rotate(0deg) scale(.82)}
  .problem-visual.in .scatter-item.s8{transform:translate(0%, -18%) rotate(0deg) scale(.82)}
  .scatter-item.s1{top:12%;left:8%;transform:rotate(-3deg)}
  .scatter-item.s2{top:22%;right:10%;transform:rotate(2deg)}
  .scatter-item.s3{top:40%;left:18%;transform:rotate(-1deg)}
  .scatter-item.s4{top:52%;right:6%;transform:rotate(3deg)}
  .scatter-item.s5{top:68%;left:10%;transform:rotate(-2deg)}
  .scatter-item.s6{top:78%;right:18%;transform:rotate(1deg)}
  .scatter-item.s7{top:8%;left:48%;transform:rotate(-2deg)}
  .scatter-item.s8{top:60%;left:52%;transform:rotate(2deg)}

  .converge-pulse{
    position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);
    width:100px;height:100px;border-radius:50%;
    background:radial-gradient(circle, rgba(251,146,60,0.22), transparent 65%);
    opacity:0;transition:opacity 1.8s var(--ease-out) .8s;z-index:1;
  }
  .problem-visual.in .converge-pulse{opacity:1;animation:breathe 4s ease-in-out infinite}
  @keyframes breathe{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.2)}}

  .converge-caption{
    position:absolute;left:50%;bottom:22px;transform:translateX(-50%);
    display:flex;align-items:center;gap:9px;font-size:11px;
    color:#c89468;letter-spacing:.16em;text-transform:uppercase;
    font-family:'JetBrains Mono',monospace;
    opacity:0;transition:opacity 1.4s var(--ease-out) 1.2s;
    z-index:3;white-space:nowrap;
  }
  .converge-caption svg{width:14px;height:14px;flex-shrink:0;animation:bounce 2.4s ease-in-out infinite}
  @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(4px)}}
  .problem-visual.in .converge-caption{opacity:1}

  .problem-points{list-style:none;display:flex;flex-direction:column;gap:22px;margin-top:34px}
  .problem-points li{display:flex;gap:16px;align-items:flex-start;padding-bottom:22px;border-bottom:1px solid var(--border)}
  .problem-points li:last-child{border-bottom:none;padding-bottom:0}
  .pp-num{font-family:'JetBrains Mono',monospace;font-size:12px;color:#c89468;min-width:28px;padding-top:5px;font-weight:500}
  .pp-body strong{display:block;font-weight:500;color:#f0f0f2;font-size:16px;letter-spacing:-.01em;line-height:1.4}

  .problem-visual-mobile{display:none}
  @media (max-width:900px){
    .problem-grid{grid-template-columns:1fr;gap:30px}
    .problem-visual{display:none !important}
    .problem-visual-mobile{
      display:flex;flex-direction:column;gap:0;padding:22px 16px;
      border-radius:var(--radius-lg);
      background:linear-gradient(180deg, #0a0a0d 0%, #050507 100%);
      border:1px solid rgba(251,146,60,0.16);
      position:relative;overflow:hidden;
    }
    .problem-visual-mobile::before{
      content:"";position:absolute;inset:0;
      background-image:repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 5px);
      opacity:.4;pointer-events:none;
    }
    .pvm-sources{display:flex;flex-direction:column;gap:8px;position:relative;z-index:1}
    .pvm-source{
      padding:12px 14px;background:rgba(251,146,60,0.05);
      border:1px solid rgba(251,146,60,0.14);border-radius:10px;
      font-size:13.5px;color:#c0c0c8;line-height:1.4;
    }
    .pvm-tag{display:block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;
      color:#c89468;margin-bottom:5px;font-family:'JetBrains Mono',monospace}
    .pvm-arrow{display:flex;justify-content:center;align-items:center;
      padding:16px 0;color:#c89468;position:relative;z-index:1}
    .pvm-arrow svg{width:24px;height:24px;animation:bounce 2.4s ease-in-out infinite}
    .pvm-result{
      padding:15px;background:linear-gradient(180deg, rgba(74,222,128,0.08), rgba(74,222,128,0.02));
      border:1px solid rgba(74,222,128,0.22);border-radius:12px;position:relative;z-index:1;
    }
    .pvm-result .pvm-tag{color:#86efac}
    .pvm-result-title{font-size:14.5px;color:#f0f0f2;font-weight:500;line-height:1.35;margin-bottom:8px;letter-spacing:-.008em}
    .pvm-result-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted)}
    .pvm-result-meta::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 6px var(--accent);flex-shrink:0}
  }

  /* BEFORE/AFTER */
  .ba-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:12px}
  .ba-card{
    border:1px solid var(--border);border-radius:var(--radius-lg);
    padding:clamp(22px,3vw,32px);position:relative;overflow:hidden;
    background:linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0));
  }
  .ba-card.before{border-color:rgba(248,113,113,0.14)}
  .ba-card.after{
    background:radial-gradient(ellipse 80% 100% at 50% 0%, rgba(74,222,128,0.06), transparent 60%),
      linear-gradient(180deg, rgba(255,255,255,0.016), rgba(255,255,255,0));
    border-color:rgba(74,222,128,0.18);
  }
  .ba-tag{
    display:inline-flex;align-items:center;gap:8px;font-size:11px;
    letter-spacing:.16em;text-transform:uppercase;font-family:'JetBrains Mono',monospace;
    padding:6px 13px;border-radius:999px;margin-bottom:22px;
  }
  .ba-tag.before{background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.20);color:#fca5a5}
  .ba-tag.after{background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.22);color:#86efac}
  .ba-list{display:flex;flex-direction:column;gap:11px;list-style:none}
  .ba-list li{
    display:flex;gap:12px;align-items:flex-start;
    padding:13px 15px;border-radius:11px;font-size:14px;
    background:rgba(255,255,255,0.012);border:1px solid var(--border);
    color:var(--text-soft);line-height:1.5;
  }
  .ba-list li.bad::before{content:"";width:18px;height:18px;border-radius:50%;flex-shrink:0;
    background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.30);margin-top:1px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fca5a5' stroke-width='3'><path d='M18 6L6 18M6 6l12 12'/></svg>");
    background-size:10px;background-position:center;background-repeat:no-repeat}
  .ba-list li.good{background:rgba(74,222,128,0.04);border-color:rgba(74,222,128,0.14);color:#e0e0e6}
  .ba-list li.good::before{content:"";width:18px;height:18px;border-radius:50%;flex-shrink:0;
    background:rgba(74,222,128,0.14);border:1px solid rgba(74,222,128,0.32);margin-top:1px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234ade80' stroke-width='3'><path d='M5 12l5 5L20 7'/></svg>");
    background-size:10px;background-position:center;background-repeat:no-repeat}
  .ba-verdict{margin-top:22px;padding-top:20px;border-top:1px solid var(--border);
    font-size:14px;color:var(--text-soft);line-height:1.6}
  .ba-verdict strong{color:#f0f0f2;font-weight:500}
  @media (max-width:800px){.ba-grid{grid-template-columns:1fr;gap:16px}}

  /* COMPARAÇÃO */
  .compare-table{
    border:1px solid var(--border);border-radius:var(--radius-lg);
    overflow:hidden;background:linear-gradient(180deg, rgba(255,255,255,0.012), transparent);
  }
  .compare-head,.compare-row{
    display:grid;grid-template-columns:1.6fr repeat(3, 1fr);
    align-items:center;padding:16px 24px;
    border-bottom:1px solid var(--border);gap:16px;
  }
  .compare-head{
    background:rgba(255,255,255,0.015);
    border-bottom:1px solid var(--border-strong);
    padding:22px 24px;
  }
  .compare-row:last-child{border-bottom:none}
  .compare-head .col-label,.compare-row .col-label{font-size:14px;color:var(--text-soft);font-weight:500}
  .compare-head .col-brand{
    font-size:14px;font-weight:600;color:#fff;letter-spacing:-.01em;
    display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;
  }
  .compare-head .col-brand .brand-sub{
    font-size:10px;color:var(--text-dim);font-family:'JetBrains Mono',monospace;
    letter-spacing:.08em;text-transform:uppercase;font-weight:500;
  }
  .compare-head .col-brand.us{color:#fff}
  .compare-head .col-brand.us .brand-sub{color:#86efac}
  .compare-cell{text-align:center;display:flex;align-items:center;justify-content:center;min-height:28px}
  .compare-cell .yes{
    display:inline-flex;align-items:center;justify-content:center;
    width:22px;height:22px;border-radius:50%;
    background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.30);
    color:#4ade80;font-size:11px;font-weight:700;
  }
  .compare-cell .no{
    display:inline-flex;align-items:center;justify-content:center;
    width:22px;height:22px;border-radius:50%;
    background:rgba(148,148,155,0.08);border:1px solid rgba(148,148,155,0.18);
    color:#65656e;font-size:11px;font-weight:700;
  }
  .compare-cell .partial{
    font-size:11px;color:#fbbf24;font-family:'JetBrains Mono',monospace;
    padding:3px 8px;border-radius:5px;
    background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.20);
  }
  .compare-cell.highlight{background:rgba(74,222,128,0.035);border-radius:8px}
  .compare-cell .price-us{
    font-family:'JetBrains Mono',monospace;font-size:12px;color:#fde68a;
    padding:3px 8px;border-radius:5px;background:rgba(250,204,21,0.06);
    border:1px solid rgba(250,204,21,0.18);
  }
  .compare-cell .price-br{
    font-family:'JetBrains Mono',monospace;font-size:12px;color:#86efac;
    padding:3px 8px;border-radius:5px;background:rgba(74,222,128,0.08);
    border:1px solid rgba(74,222,128,0.22);font-weight:500;
  }
  .compare-mobile{display:none}
  @media (max-width:820px){
    .compare-table{display:none}
    .compare-mobile{display:flex;flex-direction:column;gap:14px}
    .cm-plan{
      border:1px solid var(--border);border-radius:var(--radius-lg);
      padding:22px 20px;background:linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0));
    }
    .cm-plan.us{border-color:rgba(74,222,128,0.22);
      background:radial-gradient(ellipse 80% 100% at 50% 0%, rgba(74,222,128,0.05), transparent 60%),
        linear-gradient(180deg, rgba(255,255,255,0.016), rgba(255,255,255,0));
    }
    .cm-plan-name{font-size:16px;font-weight:600;color:#f0f0f2;letter-spacing:-.015em;
      margin-bottom:4px;display:flex;align-items:center;justify-content:space-between}
    .cm-plan-badge{font-size:10px;padding:3px 9px;border-radius:5px;
      background:rgba(74,222,128,0.14);color:#86efac;
      font-family:'JetBrains Mono',monospace;letter-spacing:.08em;
      text-transform:uppercase;font-weight:500}
    .cm-plan-sub{font-size:12px;color:var(--text-dim);
      font-family:'JetBrains Mono',monospace;margin-bottom:18px}
    .cm-list{display:flex;flex-direction:column;gap:10px;list-style:none}
    .cm-list li{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-soft);line-height:1.5}
    .cm-list li.no{color:var(--text-dim)}
    .cm-list li .ic{width:20px;height:20px;border-radius:50%;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
    .cm-list li .ic.yes{background:rgba(74,222,128,0.14);border:1px solid rgba(74,222,128,0.32);color:#4ade80}
    .cm-list li .ic.no{background:rgba(148,148,155,0.08);border:1px solid rgba(148,148,155,0.18);color:#65656e}
    .cm-list li .ic.partial{background:rgba(251,191,36,0.10);border:1px solid rgba(251,191,36,0.22);color:#fbbf24;font-size:9px}
  }

  /* SOLUTION */
  .event-view{
    display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:0;
    background:linear-gradient(180deg, #0a0a0e 0%, #060609 100%);
    border:1px solid var(--border-strong);
    border-radius:var(--radius-lg);overflow:hidden;
    position:relative;box-shadow:0 40px 100px rgba(0,0,0,0.5);
  }
  .event-main{padding:clamp(26px,4vw,48px);border-right:1px solid var(--border)}
  .event-side{padding:clamp(22px,3vw,34px);background:rgba(255,255,255,0.008)}
  .event-status{
    display:inline-flex;align-items:center;gap:8px;font-size:11px;
    letter-spacing:.16em;text-transform:uppercase;color:#a0a0a6;
    padding:6px 13px;border:1px solid var(--border);
    background:rgba(255,255,255,0.015);
    border-radius:999px;margin-bottom:22px;
    font-family:'JetBrains Mono',monospace;
  }
  .event-status .pulse{width:6px;height:6px;border-radius:50%;background:var(--accent);
    box-shadow:0 0 0 0 rgba(74,222,128,0.6);animation:pulse 2s infinite}
  @keyframes pulse{
    0%{box-shadow:0 0 0 0 rgba(74,222,128,0.5)}
    70%{box-shadow:0 0 0 10px rgba(74,222,128,0)}
    100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}
  }
  .event-view h3{font-size:clamp(1.3rem, 2.1vw, 1.85rem);font-weight:500;letter-spacing:-.025em;line-height:1.18;margin-bottom:18px;color:#fff}
  .event-view .summary{font-size:15px;line-height:1.7;color:#b8b8c0;margin-bottom:26px}
  .event-tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:26px}
  .tag{font-size:11.5px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:#c0c0c8}
  .why{padding:18px 20px;border-radius:12px;background:rgba(255,255,255,0.02);border:1px solid var(--border);display:flex;gap:14px;align-items:flex-start}
  .why-icon{width:28px;height:28px;border-radius:8px;flex-shrink:0;background:rgba(255,255,255,0.04);border:1px solid var(--border);display:flex;align-items:center;justify-content:center}
  .why-icon svg{width:13px;height:13px;color:#c8c8d0}
  .why-body strong{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted);font-weight:500;margin-bottom:6px;font-family:'JetBrains Mono',monospace}
  .why-body p{font-size:14px;color:#cdd6e6;line-height:1.6}
  .side-head{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-muted);margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;font-family:'JetBrains Mono',monospace}
  .side-head .count{color:var(--text-dim);text-transform:none;letter-spacing:0;font-size:12px}
  .sources{display:flex;flex-direction:column;gap:8px}
  .source{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--border);border-radius:11px;transition:background .25s, border-color .25s, transform .4s var(--ease-out)}
  .source:hover{background:rgba(255,255,255,0.03);border-color:var(--border-strong);transform:translateX(3px)}
  .source-logo{width:30px;height:30px;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,#1f1f24,#0e0e12);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#d8d8dc}
  .source-logo.bbc{background:linear-gradient(135deg,#bb1919,#8b1010);color:#fff;font-size:9px}
  .source-logo.folha{background:linear-gradient(135deg,#1c4a8a,#0e2d5a);color:#fff;font-size:9px}
  .source-info{flex:1;min-width:0}
  .source-name{font-size:12.5px;color:#e2e2e6;font-weight:500}
  .source-meta{font-size:10.5px;color:var(--text-dim);margin-top:2px}
  .source-arrow{color:var(--text-dim);flex-shrink:0;transition:transform .3s}
  .source:hover .source-arrow{transform:translate(2px,-2px);color:#fff}
  .source-arrow svg{width:12px;height:12px}

  @media (max-width:900px){
    .event-view{grid-template-columns:1fr}
    .event-main{border-right:none;border-bottom:1px solid var(--border);padding:24px}
    .event-side{padding:20px}
    .source:nth-child(n+3){display:none}
  }

  /* FEATURES */
  .features{display:grid;grid-template-columns:repeat(12, 1fr);gap:14px}
  .feature{
    border:1px solid var(--border);border-radius:var(--radius);padding:26px;
    position:relative;overflow:hidden;
    transition:border-color .4s var(--ease), transform .6s var(--ease-out);
    background:linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0));
  }
  .feature::before{
    content:"";position:absolute;inset:0;border-radius:var(--radius);
    background:radial-gradient(ellipse 80% 100% at var(--fx,50%) var(--fy,0%), rgba(167,139,250,0.10), transparent 55%);
    opacity:0;transition:opacity .5s var(--ease);pointer-events:none;
  }
  .feature:hover{border-color:var(--border-strong);transform:translateY(-4px)}
  .feature:hover::before{opacity:1}
  .feature h3{margin-bottom:10px;color:#f0f0f2}
  .feature p{font-size:14px;color:var(--text-muted);line-height:1.6;position:relative}
  .feature-ico{width:36px;height:36px;border-radius:10px;position:relative;border:1px solid var(--border);background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;margin-bottom:18px;transition:transform .6s var(--ease-out), border-color .4s}
  .feature:hover .feature-ico{transform:scale(1.05) rotate(-3deg);border-color:var(--border-strong)}
  .feature-ico svg{width:16px;height:16px;opacity:.85}
  .f-1{grid-column:span 7}.f-2{grid-column:span 5}
  .f-3,.f-4,.f-5{grid-column:span 4}
  .f-6,.f-7{grid-column:span 6}
  @media (max-width:900px){
    .features{grid-template-columns:1fr;gap:10px}
    .f-1,.f-2,.f-3,.f-4,.f-5,.f-6,.f-7{grid-column:span 1}
    .feature{padding:20px}
  }

  /* STATS */
  .stats{display:grid;grid-template-columns:repeat(4, 1fr);gap:0;
    border-top:1px solid var(--border);border-bottom:1px solid var(--border);
  }
  .stat{padding:38px 28px;border-right:1px solid var(--border);position:relative}
  .stat:last-child{border-right:none}
  .stat-val{font-size:clamp(2.1rem, 3.3vw, 2.8rem);font-weight:500;letter-spacing:-.03em;color:#fff;line-height:1;margin-bottom:10px;font-variant-numeric:tabular-nums}
  .stat-label{font-size:13.5px;color:var(--text-muted);line-height:1.4}
  @media (max-width:900px){
    .stats{grid-template-columns:1fr 1fr}
    .stat{border-right:none;border-bottom:1px solid var(--border);padding:26px 20px}
    .stat:nth-child(odd){border-right:1px solid var(--border)}
    .stat:nth-last-child(-n+2){border-bottom:none}
    .stat-val{font-size:1.9rem}
  }

  /* DEMO */
  .demo{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:48px;align-items:center;margin-top:36px}

  .desktop-mockup{
    border:1px solid var(--border-strong);border-radius:var(--radius-lg);
    background:linear-gradient(180deg, #0c0c10 0%, #060608 100%);
    padding:12px;position:relative;overflow:hidden;
    box-shadow:0 50px 120px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
    transition:transform 1s var(--ease-out);transform-style:preserve-3d;
  }
  .desktop-inner{border-radius:14px;background:#08080b;border:1px solid rgba(255,255,255,0.05);overflow:hidden;aspect-ratio:16/10.5;display:flex;flex-direction:column}
  .dm-bar{height:38px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid var(--border);background:rgba(255,255,255,0.012)}
  .dm-dots{display:flex;gap:6px}
  .dm-dots span{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.10)}
  .dm-dots span:nth-child(1){background:#3a3a42}
  .dm-dots span:nth-child(2){background:#2e2e36}
  .dm-dots span:nth-child(3){background:#242429}
  .dm-url{flex:1;height:24px;border-radius:7px;background:rgba(255,255,255,0.03);border:1px solid var(--border);display:flex;align-items:center;padding:0 12px;font-size:11px;color:var(--text-dim);font-family:'JetBrains Mono',monospace;gap:8px}
  .dm-url svg{width:10px;height:10px;opacity:.5}
  .dm-live{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--accent);padding:4px 9px;border-radius:6px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.22);font-family:'JetBrains Mono',monospace;letter-spacing:.06em}
  .dm-live-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);box-shadow:0 0 6px var(--accent);animation:pulseDot 1.6s ease-in-out infinite}

  .dm-body{display:grid;grid-template-columns:216px 1fr;flex:1;min-height:0}
  .dm-side{border-right:1px solid var(--border);padding:16px 14px;background:rgba(255,255,255,0.008);display:flex;flex-direction:column}
  .dm-side .brand-sm{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;margin-bottom:22px;color:#eaeaea}
  .dm-side .brand-sm svg{width:22px;height:16px}
  .dm-nav{display:flex;flex-direction:column;gap:2px;flex:1}
  .dm-nav a{font-size:12.5px;color:var(--text-muted);padding:9px 11px;border-radius:8px;display:flex;align-items:center;gap:9px;transition:background .25s, color .25s;position:relative;cursor:pointer}
  .dm-nav a.active{background:rgba(255,255,255,0.05);color:#fff}
  .dm-nav a.active::before{content:"";position:absolute;left:0;top:20%;bottom:20%;width:2px;background:#fff;border-radius:2px}
  .dm-nav a:hover{color:#fff}
  .dm-nav a svg{width:12px;height:12px;opacity:.7}
  .dm-nav .badge{margin-left:auto;font-size:9.5px;padding:1px 6px;border-radius:5px;background:rgba(74,222,128,0.15);color:#86efac;font-family:'JetBrains Mono',monospace;font-weight:500}
  .dm-user{display:flex;align-items:center;gap:9px;padding-top:14px;margin-top:auto;border-top:1px solid var(--border)}
  .dm-user-av{width:26px;height:26px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#3a4456,#1a1f2a);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:#c8c8d0;border:1px solid var(--border)}
  .dm-user-name{font-size:11.5px;color:#c0c0c8;font-weight:500;line-height:1.2}
  .dm-user-role{font-size:10px;color:var(--text-dim);margin-top:1px}

  .dm-main{padding:16px 20px;overflow:hidden;display:flex;flex-direction:column;gap:11px}
  .dm-search{height:34px;border-radius:8px;background:rgba(255,255,255,0.025);border:1px solid var(--border);display:flex;align-items:center;gap:8px;padding:0 12px;font-size:11.5px;color:var(--text-dim);font-family:'JetBrains Mono',monospace}
  .dm-search svg{width:12px;height:12px;opacity:.6}
  .dm-search .kbd{margin-left:auto;font-size:9.5px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.04);border:1px solid var(--border)}
  .dm-tabs{display:flex;gap:6px;flex-wrap:wrap}
  .dm-tab{font-size:11.5px;padding:6px 14px;border-radius:999px;border:1px solid var(--border);color:var(--text-muted);transition:all .25s;cursor:pointer;background:transparent}
  .dm-tab:hover{color:#fff;border-color:var(--border-strong)}
  .dm-tab.active{background:#fff;color:#000;border-color:#fff;font-weight:500}
  .dm-feed{display:flex;flex-direction:column;gap:9px;overflow:hidden;flex:1}

  .news{
    border:1px solid var(--border);border-radius:14px;padding:14px;
    background:linear-gradient(180deg, rgba(255,255,255,0.014), rgba(255,255,255,0));
    display:flex;flex-direction:column;gap:9px;position:relative;
    transition:border-color .3s, background .3s, transform .5s var(--ease-out);
  }
  .news:hover{border-color:var(--border-strong);background:linear-gradient(180deg, rgba(255,255,255,0.026), rgba(255,255,255,0));transform:translateY(-1px)}
  .news-top{display:flex;align-items:center;gap:9px}
  .news-cat{
    font-size:11px;padding:4px 11px;border-radius:999px;
    background:rgba(255,255,255,0.05);border:1px solid var(--border);
    color:#d0d0d6;font-weight:500;white-space:nowrap;
  }
  .news-cat.tech{background:rgba(96,165,250,0.08);border-color:rgba(96,165,250,0.20);color:#93c5fd}
  .news-cat.pol{background:rgba(251,146,60,0.08);border-color:rgba(251,146,60,0.20);color:#fdba74}
  .news-cat.eco{background:rgba(74,222,128,0.08);border-color:rgba(74,222,128,0.20);color:#86efac}
  .news-time{font-size:11px;color:var(--text-dim);font-family:'JetBrains Mono',monospace}
  .news-actions{margin-left:auto;display:flex;gap:4px}
  .news-action{
    width:28px;height:28px;border-radius:7px;border:1px solid transparent;
    display:flex;align-items:center;justify-content:center;
    color:var(--text-dim);transition:all .25s;cursor:pointer;background:transparent;
  }
  .news-action:hover{color:#fff;background:rgba(255,255,255,0.05);border-color:var(--border)}
  .news-action.saved{color:#fff;background:rgba(255,255,255,0.08);border-color:var(--border-strong)}
  .news-action svg{width:13px;height:13px}
  .news-title{font-size:14.5px;color:#f0f0f2;font-weight:500;line-height:1.32;letter-spacing:-.008em}
  .news-sub{font-size:12.5px;color:#a8a8b0;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .news-divider{height:1px;background:var(--border);margin:2px 0}
  .news-foot{display:flex;align-items:center;gap:10px}
  .news-count{font-size:11.5px;color:#c8c8ce;font-weight:500;white-space:nowrap}
  .source-bubbles{display:flex;align-items:center}
  .source-bubbles span{
    width:20px;height:20px;border-radius:50%;border:2px solid #08080b;
    margin-right:-6px;display:flex;align-items:center;justify-content:center;
    font-size:8.5px;font-weight:700;color:#fff;background:#1a1a20;
  }
  .source-bubbles span.bbc{background:#bb1919}
  .source-bubbles span.verge{background:linear-gradient(135deg,#ff0080,#7928ca)}
  .source-bubbles span.reuters{background:#ff7f00}
  .source-bubbles span.folha{background:#1c4a8a}
  .source-bubbles span.valor{background:#2d5a2d}
  .source-bubbles span.g1{background:#c4170c}
  .source-bubbles span.more{background:#1a1a20;color:#8b8b93;font-size:9px}
  .news-context{
    margin-left:auto;font-size:11.5px;color:var(--text-muted);
    display:flex;align-items:center;gap:5px;cursor:pointer;
    transition:color .25s;background:transparent;border:none;padding:4px;
  }
  .news-context:hover{color:#fff}
  .news-context svg{width:11px;height:11px;transition:transform .35s var(--ease-out)}
  .news-context.open svg{transform:rotate(180deg)}
  .news-context-body{
    max-height:0;overflow:hidden;
    transition:max-height .5s var(--ease-out), padding .5s var(--ease-out), opacity .4s;
    opacity:0;font-size:12px;color:#a8a8b0;line-height:1.6;padding-left:2px;
  }
  .news-context-body.open{max-height:200px;opacity:1;padding-top:6px}
  .news-context-body strong{color:#d0d0d6;font-weight:500}

  /* Phone */
  .phone-stage{position:relative;display:flex;justify-content:center;align-items:center;perspective:1400px}
  .phone{
    width:min(320px, 84%);aspect-ratio:9/19.3;border-radius:48px;padding:9px;
    background:linear-gradient(150deg, #3a3a42 0%, #1c1c20 30%, #0d0d10 70%, #050507 100%);
    box-shadow:0 80px 140px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06),
      inset 0 0 0 1px rgba(255,255,255,0.08);
    transform:rotateY(-16deg) rotateX(6deg) rotateZ(2deg);
    transition:transform 1.2s var(--ease-out);position:relative;
  }
  .phone-stage:hover .phone{transform:rotateY(-8deg) rotateX(3deg) rotateZ(0deg)}
  .phone-btn{position:absolute;background:linear-gradient(90deg,#1a1a1e,#2f2f36);border:1px solid rgba(255,255,255,0.05)}
  .phone-btn-vol-up{left:-2px;top:20%;width:3px;height:34px;border-radius:2px 0 0 2px}
  .phone-btn-vol-down{left:-2px;top:29%;width:3px;height:34px;border-radius:2px 0 0 2px}
  .phone-btn-power{right:-2px;top:24%;width:3px;height:52px;border-radius:0 2px 2px 0}
  .phone-screen{width:100%;height:100%;border-radius:40px;overflow:hidden;background:#08080b;position:relative;display:flex;flex-direction:column}
  .phone-island{position:absolute;top:9px;left:50%;transform:translateX(-50%);width:32%;height:26px;border-radius:14px;background:#000;z-index:5;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;border:1px solid rgba(255,255,255,0.04)}
  .phone-island::after{content:"";width:7px;height:7px;border-radius:50%;background:radial-gradient(circle, #1a2030, #060810);border:1px solid rgba(255,255,255,0.06)}
  .ps-status{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 26px;font-size:11px;color:#d0d0d6;font-weight:500;font-family:'JetBrains Mono',monospace;position:relative;z-index:4}
  .ps-status .battery{display:flex;align-items:center;gap:3px}
  .ps-status .battery::after{content:"";width:18px;height:9px;border-radius:2.5px;border:1px solid rgba(255,255,255,0.4);background:linear-gradient(90deg, #fff 0% 78%, transparent 78% 100%)}
  .ps-header{padding:4px 20px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
  .ps-brand{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:600;color:#fff}
  .ps-brand svg{width:28px;height:20px}
  .ps-bell{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;position:relative}
  .ps-bell svg{width:17px;height:17px;opacity:.85}
  .ps-bell::after{content:"";position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:#ef4444}
  .ps-tabs{display:flex;gap:8px;padding:14px 18px 0;overflow-x:auto;scrollbar-width:none}
  .ps-tabs::-webkit-scrollbar{display:none}
  .ps-tab{font-size:13px;padding:9px 17px;border-radius:999px;border:1px solid var(--border);color:#b0b0b6;white-space:nowrap;transition:all .25s;cursor:pointer;background:transparent;font-weight:500}
  .ps-tab.active{background:#fff;color:#000;border-color:#fff}
  .ps-feed{padding:14px 14px 0;overflow:hidden;flex:1;display:flex;flex-direction:column;gap:10px}
  .ps-feed .news{padding:13px}
  .ps-feed .news-title{font-size:13.5px}
  .ps-feed .news-sub{font-size:12px}
  .ps-nav{display:flex;justify-content:space-around;padding:12px 14px 22px;border-top:1px solid var(--border);background:rgba(6,6,8,0.85);backdrop-filter:blur(12px);position:relative}
  .ps-nav-item{display:flex;flex-direction:column;align-items:center;gap:4px;color:#6b6b73;font-size:9.5px;font-weight:500;transition:color .25s;padding:4px 8px;position:relative;cursor:pointer}
  .ps-nav-item.active{color:#fff}
  .ps-nav-item svg{width:19px;height:19px;stroke-width:1.8}
  .ps-nav-item .notif{position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#ef4444;border:1.5px solid #08080b}
  .phone-home{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);width:36%;height:4px;border-radius:2px;background:rgba(255,255,255,0.55);z-index:5}

  @media (max-width:900px){
    .demo{grid-template-columns:1fr;gap:32px;margin-top:24px}
    .dm-body{grid-template-columns:1fr}
    .dm-side{display:none}
    .dm-main{padding:14px 16px}
    .phone{width:min(300px, 82%)}
    .desktop-inner{aspect-ratio:16/12}
  }

  /* HOW IT WORKS */
  .steps{display:grid;grid-template-columns:repeat(3, 1fr);gap:28px;position:relative}
  .steps::before{content:"";position:absolute;top:22px;left:8%;right:8%;height:1px;background:linear-gradient(90deg, transparent, var(--border-strong) 20%, var(--border-strong) 80%, transparent);z-index:0}
  .step{position:relative;z-index:1;padding-top:48px}
  .step-num{position:absolute;top:0;left:0;width:46px;height:46px;border-radius:50%;background:var(--bg);border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:13px;color:#e0e0e6;box-shadow:0 0 0 8px var(--bg);transition:transform .6s var(--ease-out)}
  .step:hover .step-num{transform:scale(1.08) rotate(-5deg)}
  .step h3{margin-bottom:10px;color:#f0f0f2}
  .step p{font-size:14px}
  @media (max-width:800px){
    .steps{grid-template-columns:1fr;gap:24px}
    .steps::before{display:none}
    .step{padding-top:0;padding-left:64px}
    .step-num{top:0;width:42px;height:42px;font-size:12px}
  }

  /* AUDIENCE */
  .audience{display:grid;grid-template-columns:repeat(2, 1fr);border-top:1px solid var(--border)}
  .aud{padding:32px 0;border-bottom:1px solid var(--border);display:grid;grid-template-columns:42px 1fr;gap:22px;padding-right:44px;transition:background .4s var(--ease)}
  .aud:hover{background:rgba(255,255,255,0.008)}
  .aud:nth-child(odd){border-right:1px solid var(--border);padding-right:60px}
  .aud:nth-child(even){padding-left:60px}
  .aud-num{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-dim);padding-top:4px}
  .aud strong{display:block;font-size:16.5px;font-weight:500;color:#f0f0f2;letter-spacing:-.015em;line-height:1.35}
  @media (max-width:800px){
    .audience{grid-template-columns:1fr}
    .aud{border-right:none !important;padding:22px 0 !important;gap:18px}
    .aud strong{font-size:15.5px}
  }

  /* TRUST */
  .trust-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:60px;align-items:center}
  .trust-visual{border:1px solid var(--border);border-radius:var(--radius-lg);padding:28px;background:linear-gradient(180deg, #0a0a0d, #060608);box-shadow:0 40px 100px rgba(0,0,0,0.4)}
  .chain{display:flex;flex-direction:column;gap:10px}
  .chain-row{display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid var(--border);border-radius:11px;background:rgba(255,255,255,0.014);font-size:13px;color:#c8c8ce;transition:border-color .3s, background .3s, transform .4s var(--ease-out)}
  .chain-row:hover{border-color:var(--border-strong);background:rgba(255,255,255,0.028);transform:translateX(3px)}
  .chain-row .lbl{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim);min-width:92px}
  .chain-row .val{color:#e6e6ea;font-size:12.5px}
  .chain-row .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 8px rgba(74,222,128,0.7)}
  .chain-connector{height:12px;width:1px;background:var(--border-strong);margin:0 0 0 22px}
  .trust-list{display:flex;flex-direction:column;gap:14px;margin-top:26px;list-style:none}
  .trust-list li{display:flex;gap:12px;align-items:flex-start;font-size:14.5px;color:var(--text-soft)}
  .check{width:20px;height:20px;border-radius:50%;flex-shrink:0;margin-top:1px;background:rgba(74,222,128,0.10);border:1px solid rgba(74,222,128,0.28);display:flex;align-items:center;justify-content:center}
  .check svg{width:11px;height:11px;color:#4ade80}
  .trust-badges{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
  .trust-badge{display:flex;align-items:center;gap:8px;padding:10px 15px;border-radius:10px;background:rgba(74,222,128,0.05);border:1px solid rgba(74,222,128,0.20);font-size:12.5px;color:#b8dfc4;font-family:'JetBrains Mono',monospace}
  .trust-badge svg{width:14px;height:14px;color:#4ade80;flex-shrink:0}
  @media (max-width:900px){
    .trust-grid{grid-template-columns:1fr;gap:30px}
    .trust-visual{padding:22px}
    .chain-row .lbl{min-width:82px;font-size:9.5px}
    .chain-row .val{font-size:12px}
  }

  /* PLANS */
  .plans{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:60px;align-items:center}
  .plan-card{
    border:1px solid var(--border-strong);border-radius:var(--radius-lg);padding:36px;
    position:relative;overflow:hidden;
    background:radial-gradient(ellipse 80% 100% at 50% 0%, rgba(96,165,250,0.08), transparent 60%),linear-gradient(180deg, #0b0b0f, #060608);
    box-shadow:0 50px 110px rgba(0,0,0,0.5);
  }
  .plan-card::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)}
  .plan-card::after{content:"";position:absolute;top:-80px;right:-80px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle, rgba(96,165,250,0.10), transparent 70%);pointer-events:none}
  .plan-name{font-size:11.5px;letter-spacing:.18em;color:var(--text-muted);margin-bottom:16px;text-transform:uppercase;font-family:'JetBrains Mono',monospace}
  .plan-price{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
  .plan-price .val{font-size:44px;font-weight:500;letter-spacing:-.03em;color:#fff}
  .plan-price .per{font-size:14px;color:var(--text-dim)}
  .plan-sub{font-size:12.5px;color:var(--text-muted);margin-bottom:26px;font-family:'JetBrains Mono',monospace}
  .plan-benefits{list-style:none;display:flex;flex-direction:column;gap:12px;margin-bottom:26px}
  .plan-benefits li{display:flex;gap:11px;align-items:center;font-size:14.5px;color:#c8c8ce}
  .plan-benefits .check{background:rgba(96,165,250,0.10);border-color:rgba(96,165,250,0.28)}
  .plan-benefits .check svg{color:#93c5fd}
  .plan-cta{width:100%;justify-content:center}
  .plan-guarantee{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:var(--text-dim);margin-top:14px;padding-top:14px;border-top:1px solid var(--border);text-align:center}
  .plan-guarantee svg{width:13px;height:13px;opacity:.7;flex-shrink:0}
  .plans-copy h2{margin:18px 0 20px}
  .plans-copy ul{list-style:none;display:flex;flex-direction:column;gap:14px;margin-top:24px}
  .plans-copy ul li{display:flex;gap:11px;font-size:14.5px;color:var(--text-soft);align-items:flex-start}
  .plans-copy ul li::before{content:"";width:5px;height:5px;border-radius:50%;background:rgba(96,165,250,0.6);margin-top:9px;flex-shrink:0}
  @media (max-width:900px){
    .plans{grid-template-columns:1fr;gap:32px}
    .plan-card{padding:28px;order:-1}
    .plan-price .val{font-size:38px}
    .plans-copy ul{display:none}
  }

  /* FAQ */
  .faq{max-width:880px;margin:0 auto}
  .faq-item{border-bottom:1px solid var(--border)}
  .faq-q{width:100%;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 4px;text-align:left;font-size:15.5px;font-weight:500;color:#eaeaea;letter-spacing:-.01em;transition:color .2s}
  .faq-q:hover{color:#fff}
  .faq-icon{width:26px;height:26px;border-radius:50%;flex-shrink:0;border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;transition:transform .5s var(--ease-out), background .4s}
  .faq-icon svg{width:11px;height:11px}
  .faq-item.open .faq-icon{transform:rotate(45deg);background:rgba(255,255,255,0.06)}
  .faq-a{max-height:0;overflow:hidden;transition:max-height .55s var(--ease-out), padding .55s var(--ease-out)}
  .faq-item.open .faq-a{max-height:400px;padding-bottom:24px}
  .faq-a p{font-size:14.5px;line-height:1.7;color:var(--text-muted);max-width:740px;padding-right:44px}
  @media (max-width:900px){
    .faq-q{font-size:15px;padding:20px 4px}
    .faq-a p{padding-right:20px;font-size:14px}
  }

  /* FINAL */
  .final{position:relative;text-align:center;padding:clamp(90px,12vw,160px) 0;border-top:1px solid var(--border);overflow:hidden}
  .final::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:1100px;height:1100px;border-radius:50%;background:radial-gradient(circle, rgba(125,180,240,0.10), transparent 55%);pointer-events:none}
  .final::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:460px;height:460px;border-radius:50%;border:1px solid rgba(255,255,255,0.05);pointer-events:none;animation:slowRotate 90s linear infinite}
  @keyframes slowRotate{to{transform:translate(-50%,-50%) rotate(360deg)}}
  .final-inner{position:relative;z-index:1;max-width:720px;margin:0 auto}
  .final h2{margin:18px 0 22px}
  .final p{margin-bottom:32px;font-size:16.5px;color:#b8b8c0}
  .final .btn-primary{padding:16px 30px;font-size:15.5px}
  .final .microcopy{margin-top:20px;font-size:12.5px;color:var(--text-dim)}
  @media (max-width:900px){.final{padding:70px 0 110px}.final::after{width:300px;height:300px}.final p{font-size:15px}}

  /* FOOTER */
  footer.site{border-top:1px solid var(--border);padding:64px 0 130px;background:#040405}
  @media (min-width:901px){footer.site{padding-bottom:48px}}
  .foot-grid{display:grid;grid-template-columns:1.7fr 1fr 1fr 1fr;gap:44px;margin-bottom:48px}
  .foot-brand .brand{margin-bottom:18px}
  .foot-brand p{font-size:13.5px;color:var(--text-muted);max-width:300px;line-height:1.6}
  .foot-col h4{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-dim);font-weight:500;margin-bottom:18px;font-family:'JetBrains Mono',monospace}
  .foot-col ul{list-style:none;display:flex;flex-direction:column;gap:12px}
  .foot-col a{font-size:13.5px;color:#b0b0b6;transition:color .2s;padding:4px 0;display:inline-block}
  .foot-col a:hover{color:#fff}
  .foot-bottom{display:flex;justify-content:space-between;align-items:center;padding-top:28px;border-top:1px solid var(--border);font-size:12.5px;color:var(--text-dim);flex-wrap:wrap;gap:16px}
  .foot-social{display:flex;gap:10px}
  .foot-social a{width:38px;height:38px;border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:#b0b0b6;transition:border-color .25s, color .25s, transform .25s}
  .foot-social a:hover{border-color:var(--border-strong);color:#fff;transform:translateY(-2px)}
  .foot-social svg{width:15px;height:15px}
  @media (max-width:800px){.foot-grid{grid-template-columns:1fr 1fr;gap:32px}.foot-brand{grid-column:1/-1}.foot-bottom{flex-direction:column;align-items:flex-start}}

  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:0.001ms !important;animation-iteration-count:1 !important;transition-duration:0.001ms !important;scroll-behavior:auto !important}
    .reveal{opacity:1;transform:none}
    .word{opacity:1;transform:none}
    .orb,.cursor-dot,.cursor-ring,.grain,.vignette{display:none}
  }
`;

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartFreeTrial,
  onEnterApp,
  onOpenAuth,
  onOpenLegal
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTouch = window.matchMedia('(hover: none)').matches;
    const isSmall = window.innerWidth < 900;

    const preloader = root.querySelector('#preloader') as HTMLElement | null;

    /* ---------- Cursor ---------- */
    const cursorDot = root.querySelector('#cursor-dot') as HTMLElement | null;
    const cursorRing = root.querySelector('#cursor-ring') as HTMLElement | null;
    let cursorRaf: number | null = null;
    if (!isTouch && !isSmall && cursorDot && cursorRing) {
      let dotX = 0, dotY = 0, ringX = 0, ringY = 0, tX = 0, tY = 0;
      const onMouseMove = (e: MouseEvent) => {
        tX = e.clientX;
        tY = e.clientY;
      };
      window.addEventListener('mousemove', onMouseMove, { passive: true });

      const loopCursor = () => {
        dotX += (tX - dotX) * 0.35;
        dotY += (tY - dotY) * 0.35;
        ringX += (tX - ringX) * 0.18;
        ringY += (tY - ringY) * 0.18;
        cursorDot.style.transform = `translate(${dotX}px, ${dotY}px) translate(-50%,-50%)`;
        cursorRing.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%,-50%)`;
        cursorRaf = requestAnimationFrame(loopCursor);
      };
      cursorRaf = requestAnimationFrame(loopCursor);

      root.querySelectorAll('a, button, .news, .event-card').forEach((el) => {
        el.addEventListener('mouseenter', () => cursorRing?.classList.add('hover'));
        el.addEventListener('mouseleave', () => cursorRing?.classList.remove('hover'));
      });
    }

    /* ---------- Navbar ---------- */
    const navbarShell = root.querySelector('#navbar-shell') as HTMLElement | null;
    let ticking = false;
    const updateNav = () => {
      if (!navbarShell) return;
      if (window.scrollY > 30) navbarShell.classList.add('scrolled');
      else navbarShell.classList.remove('scrolled');
      ticking = false;
    };
    const onScrollNav = () => {
      if (!ticking) {
        requestAnimationFrame(updateNav);
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScrollNav, { passive: true });

    /* ---------- Progress ---------- */
    const progress = root.querySelector('#scroll-progress') as HTMLElement | null;
    let progressTick = false;
    const updateProgress = () => {
      if (!progress) return;
      const h = document.documentElement;
      progress.style.width = ((h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100) + '%';
      progressTick = false;
    };
    const onScrollProgress = () => {
      if (!progressTick) {
        requestAnimationFrame(updateProgress);
        progressTick = true;
      }
    };
    window.addEventListener('scroll', onScrollProgress, { passive: true });

    /* ---------- Sticky CTA ---------- */
    const stickyCta = root.querySelector('#sticky-cta') as HTMLElement | null;
    const finalEl = root.querySelector('#comecar') as HTMLElement | null;
    const updateSticky = () => {
      if (!stickyCta) return;
      const pastHero = window.scrollY > window.innerHeight * 0.75;
      const nearFinal = finalEl && (finalEl.getBoundingClientRect().top < window.innerHeight * 0.5);
      if (pastHero && !nearFinal) stickyCta.classList.add('show');
      else stickyCta.classList.remove('show');
    };
    window.addEventListener('scroll', updateSticky, { passive: true });

    /* ---------- Words ---------- */
    root.querySelectorAll<HTMLElement>('[data-words]').forEach((el) => {
      const text = el.textContent?.trim();
      if (!text) return;
      el.textContent = '';
      const frag = document.createDocumentFragment();
      const words = text.split(/\s+/);
      words.forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.style.transitionDelay = (0.12 + i * 0.06) + 's';
        span.textContent = word;
        frag.appendChild(span);
        if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
      });
      el.appendChild(frag);
    });
    const wordObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('words-in');
          wordObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    root.querySelectorAll('[data-words]').forEach((el) => wordObserver.observe(el));

    /* ---------- Reveal ---------- */
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.10, rootMargin: '0px 0px -40px 0px' });
    root.querySelectorAll('.reveal').forEach((el) => io.observe(el));

    /* ---------- Problem visual ---------- */
    const problemVisual = root.querySelector('#problem-visual') as HTMLElement | null;
    if (problemVisual) {
      const pio = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            problemVisual.classList.add('in');
            pio.unobserve(problemVisual);
          }
        });
      }, { threshold: 0.30 });
      pio.observe(problemVisual);
    }

    /* ---------- Magnetic ---------- */
    if (!isTouch && !isSmall) {
      root.querySelectorAll<HTMLElement>('.magnetic').forEach((btn) => {
        let raf: number | null = null;
        btn.addEventListener('mousemove', (e) => {
          const r = btn.getBoundingClientRect();
          const x = e.clientX - r.left - r.width / 2;
          const y = e.clientY - r.top - r.height / 2;
          if (raf) cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            btn.style.transform = `translate(${x * 0.15}px, ${y * 0.22}px)`;
            btn.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
            btn.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
          });
        });
        btn.addEventListener('mouseleave', () => {
          if (raf) cancelAnimationFrame(raf);
          btn.style.transform = '';
        });
      });
    }

    /* ---------- Tilt ---------- */
    if (!isTouch && !isSmall) {
      root.querySelectorAll<HTMLElement>('.tilt-desktop').forEach((el) => {
        let raf: number | null = null;
        el.addEventListener('mousemove', (e) => {
          const r = el.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          if (raf) cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            el.style.transform = `perspective(1300px) rotateY(${x * 3}deg) rotateX(${-y * 3}deg)`;
          });
        });
        el.addEventListener('mouseleave', () => {
          if (raf) cancelAnimationFrame(raf);
          el.style.transform = '';
        });
      });
    }

    /* ---------- Feature spotlight ---------- */
    root.querySelectorAll<HTMLElement>('.feature').forEach((f) => {
      f.addEventListener('mousemove', (e) => {
        const r = f.getBoundingClientRect();
        f.style.setProperty('--fx', ((e.clientX - r.left) / r.width * 100) + '%');
        f.style.setProperty('--fy', ((e.clientY - r.top) / r.height * 100) + '%');
      });
    });

    /* ---------- Counters ---------- */
    root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
      const target = parseInt(el.dataset.count || '0', 10);
      const suffix = el.dataset.suffix || '';
      let started = false;
      const cio = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !started) {
            started = true;
            const start = performance.now();
            const duration = 1500;
            const ease = (t: number) => 1 - Math.pow(1 - t, 3);
            (function tick(now) {
              const t = Math.min(1, (now - start) / duration);
              el.textContent = Math.round(ease(t) * target) + suffix;
              if (t < 1) requestAnimationFrame(tick);
            })(performance.now());
            cio.unobserve(el);
          }
        });
      }, { threshold: 0.4 });
      cio.observe(el);
    });

    /* ---------- FAQ ---------- */
    root.querySelectorAll('.faq-item').forEach((item) => {
      const btn = item.querySelector('.faq-q');
      btn?.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        root.querySelectorAll('.faq-item').forEach((it) => {
          it.classList.remove('open');
          it.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          item.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });

    /* ---------- News ---------- */
    root.querySelectorAll('.news-context').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const body = btn.closest('.news')?.querySelector('.news-context-body');
        if (!body) return;
        const isOpen = body.classList.contains('open');
        btn.classList.toggle('open', !isOpen);
        body.classList.toggle('open', !isOpen);
      });
    });

    root.querySelectorAll('.news-action').forEach((btn) => {
      if (btn.getAttribute('aria-label') === 'Salvar') {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isSaved = btn.classList.toggle('saved');
          btn.innerHTML = isSaved
            ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v18l-6-3-6 3z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-3-6 3z"/></svg>';
        });
      }
    });

    /* ---------- Tabs ---------- */
    function bindTabs(selector: string) {
      root?.querySelectorAll(selector).forEach((group) => {
        group.querySelectorAll('.dm-tab, .ps-tab').forEach((tab) => {
          tab.addEventListener('click', () => {
            group.querySelectorAll('.dm-tab, .ps-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
          });
        });
      });
    }
    bindTabs('.dm-tabs');
    bindTabs('.ps-tabs');

    root.querySelectorAll('.ps-nav-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        root.querySelectorAll('.ps-nav-item').forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
      });
    });

    /* ---------- Drawer ---------- */
    const drawer = root.querySelector('#drawer') as HTMLElement | null;
    const burger = root.querySelector('#burger') as HTMLElement | null;
    const drawerClose = root.querySelector('#drawer-close') as HTMLElement | null;
    const drawerCloseLink = root.querySelector('#drawer-close-link') as HTMLElement | null;
    let scrollLockY = 0;
    function openDrawer() {
      if (!drawer) return;
      scrollLockY = window.scrollY;
      drawer.classList.add('open');
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollLockY}px`;
      document.body.style.width = '100%';
    }
    function closeDrawer() {
      if (!drawer) return;
      drawer.classList.remove('open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollLockY);
    }
    burger?.addEventListener('click', openDrawer);
    drawerClose?.addEventListener('click', closeDrawer);
    drawerCloseLink?.addEventListener('click', closeDrawer);
    drawer?.querySelectorAll('.drawer-nav a, .drawer-cta a').forEach((a) => {
      a.addEventListener('click', () => setTimeout(closeDrawer, 100));
    });

    /* ---------- Anchors ---------- */
    root.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (!href || href === '#' || href === '#top') return;
        const target = root.querySelector(href);
        if (target) {
          e.preventDefault();
          const top = target.getBoundingClientRect().top + window.scrollY - 100;
          window.scrollTo({ top, behavior: 'smooth' });
        }
      });
    });

    /* =========================================================
       GLOBE 3D
       ========================================================= */
    const stage = root.querySelector('#stage') as HTMLElement | null;
    const canvas = root.querySelector('#globe-canvas') as HTMLCanvasElement | null;

    function hasWebGL() {
      try {
        const c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
      } catch (e) {
        return false;
      }
    }
    function hash3(x: number, y: number, z: number) {
      const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
      return n - Math.floor(n);
    }
    function smoothNoise3(x: number, y: number, z: number) {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
      const fx = x - ix, fy = y - iy, fz = z - iz;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
      const l = (a: number, b: number, t: number) => a + (b - a) * t;
      return l(
        l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux), uy),
        l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux), uy),
        uz
      );
    }
    function fbm(x: number, y: number, z: number, oct: number) {
      let v = 0, a = 1, f = 1, n = 0;
      for (let i = 0; i < oct; i++) {
        v += a * smoothNoise3(x * f, y * f, z * f);
        n += a;
        a *= 0.5;
        f *= 2;
      }
      return v / n;
    }
    function generateEarthTextures() {
      const W = 1024, H = 512;
      const land = document.createElement('canvas');
      land.width = W; land.height = H;
      const lctx = land.getContext('2d')!;
      const lImg = lctx.createImageData(W, H);
      const lights = document.createElement('canvas');
      lights.width = W; lights.height = H;
      const xctx = lights.getContext('2d')!;
      const xImg = xctx.createImageData(W, H);

      for (let y = 0; y < H; y++) {
        const v = y / H, phi = v * Math.PI;
        const sPhi = Math.sin(phi), cPhi = Math.cos(phi);
        for (let x = 0; x < W; x++) {
          const u = x / W, theta = u * Math.PI * 2;
          const nx = sPhi * Math.cos(theta), ny = cPhi, nz = sPhi * Math.sin(theta);
          const n1 = fbm(nx * 1.7 + 5.1, ny * 1.7 + 7.3, nz * 1.7 + 11.7, 4);
          const n2 = fbm(nx * 4.2 + 50, ny * 4.2 + 51, nz * 4.2 + 52, 3);
          const n3 = fbm(nx * 9.0 + 90, ny * 9.0 + 91, nz * 9.0 + 92, 2);
          let val = n1 * 0.68 + n2 * 0.24 + n3 * 0.08;
          val += 0.04 * Math.cos(phi * 2.0);

          let r, g, b, a = 255;
          let lr = 0, lg = 0, lb = 0, la = 0;

          if (val < 0.51) {
            const depth = Math.min(1, (0.51 - val) / 0.51);
            const shade = 1 - depth * 0.75;
            r = 6 + shade * 10;
            g = 10 + shade * 14;
            b = 18 + shade * 26;
          } else {
            const la2 = Math.min(1, (val - 0.51) / 0.32);
            const ca = la2 * la2;
            r = 30 + ca * 50;
            g = 34 + ca * 52;
            b = 38 + ca * 50;
            const coast = 1 - Math.min(1, Math.abs(val - 0.53) / 0.15);
            const pop = Math.max(0, (la2 * 0.6 + coast * 0.4) * (0.4 + n3 * 0.6));
            if (Math.random() < pop * 0.14) {
              const intensity = 180 + Math.random() * 75;
              lr = intensity; lg = intensity * 0.94; lb = intensity * 0.78; la = 255;
            }
          }
          const idx = (y * W + x) * 4;
          lImg.data[idx] = r; lImg.data[idx + 1] = g; lImg.data[idx + 2] = b; lImg.data[idx + 3] = a;
          xImg.data[idx] = lr; xImg.data[idx + 1] = lg; xImg.data[idx + 2] = lb; xImg.data[idx + 3] = la;
        }
      }
      lctx.putImageData(lImg, 0, 0);
      xctx.putImageData(xImg, 0, 0);
      return { land, lights };
    }

    let globeAnimId: number | null = null;
    let globeRenderer: THREE.WebGLRenderer | null = null;
    let ro: ResizeObserver | null = null;

    function initGlobe() {
      if (!stage || !canvas) return;
      if (!hasWebGL()) {
        stage.classList.add('no-webgl', 'ready');
        preloader?.classList.add('done');
        return;
      }

      const rect = () => stage.getBoundingClientRect();
      let w = rect().width || 600, h = rect().height || 600;

      const renderer = new THREE.WebGLRenderer({
        canvas, antialias: !isSmall, alpha: true,
        powerPreference: 'high-performance'
      });
      globeRenderer = renderer;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall ? 1.5 : 2));
      renderer.setSize(w, h, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 200);
      camera.position.set(0, 0.35, 5.0);

      const { land: landCanvas, lights: lightsCanvas } = generateEarthTextures();
      const landTex = new THREE.CanvasTexture(landCanvas);
      landTex.colorSpace = THREE.SRGBColorSpace;
      landTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      landTex.wrapS = THREE.RepeatWrapping;
      const lightsTex = new THREE.CanvasTexture(lightsCanvas);
      lightsTex.colorSpace = THREE.SRGBColorSpace;
      lightsTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      lightsTex.wrapS = THREE.RepeatWrapping;

      const globe = new THREE.Group();
      scene.add(globe);
      const SEG = isSmall ? 64 : 128;

      const earth = new THREE.Mesh(
        new THREE.SphereGeometry(1.55, SEG, SEG),
        new THREE.MeshStandardMaterial({
          map: landTex, roughness: 0.85, metalness: 0.05,
          emissive: 0x050810, emissiveIntensity: 0.6
        })
      );
      globe.add(earth);

      const lightsMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.556, SEG, SEG),
        new THREE.MeshBasicMaterial({
          map: lightsTex, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95
        })
      );
      globe.add(lightsMesh);

      const atmoMat = new THREE.ShaderMaterial({
        uniforms: {
          glowColor: { value: new THREE.Color(0x5c7ea8) },
          intensity: { value: 0.9 },
          falloff: { value: 3.2 }
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPos;
          void main(){
            vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vPos = mv.xyz;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 glowColor;
          uniform float intensity;
          uniform float falloff;
          varying vec3 vNormal;
          varying vec3 vPos;
          void main(){
            vec3 viewDir = normalize(-vPos);
            float rim = pow(1.0 - abs(dot(vNormal, viewDir)), falloff);
            gl_FragColor = vec4(glowColor * rim * intensity, rim);
          }`,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
      });
      globe.add(new THREE.Mesh(new THREE.SphereGeometry(1.95, 64, 64), atmoMat));

      globe.add(new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.SphereGeometry(1.565, 32, 32)),
        new THREE.LineBasicMaterial({ color: 0x2a3040, transparent: true, opacity: 0.10 })
      ));

      const hubs = [
        [-0.55, 0.35, 1.35], [0.95, 0.50, 0.95], [1.20, -0.20, 0.90],
        [-1.10, 0.60, 0.70], [0.25, 1.18, 0.80], [-0.45, -0.90, 1.08],
        [1.00, -0.80, 0.60], [-0.90, -0.40, 1.10], [0.45, 0.10, 1.40],
        [0.80, 0.85, 0.70], [-1.25, 0.10, 0.85]
      ];
      const hubObjs: THREE.Mesh[] = [];
      hubs.forEach(([x, y, z]) => {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.022, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        dot.position.set(x, y, z);
        globe.add(dot);
        hubObjs.push(dot);
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 12, 12),
          new THREE.MeshBasicMaterial({
            color: 0xaac2e0, transparent: true, opacity: 0.22,
            depthWrite: false, blending: THREE.AdditiveBlending
          })
        );
        halo.position.set(x, y, z);
        globe.add(halo);
      });

      const arcs: THREE.Line[] = [];
      for (let a = 0; a < hubs.length; a++) {
        for (let b = a + 1; b < hubs.length; b++) {
          if (Math.random() > 0.35) continue;
          const start = new THREE.Vector3(...hubs[a]);
          const end = new THREE.Vector3(...hubs[b]);
          const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(2.15);
          const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
          const pts = curve.getPoints(isSmall ? 32 : 60);
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: 0x8ea5c4, transparent: true, opacity: 0.42
          }));
          line.userData = {
            points: pts,
            progress: Math.random(),
            speed: 0.0025 + Math.random() * 0.003
          };
          globe.add(line);
          arcs.push(line);
        }
      }

      const ring1 = new THREE.Mesh(
        new THREE.TorusGeometry(2.15, 0.0018, 8, 200),
        new THREE.MeshBasicMaterial({ color: 0x4a5468, transparent: true, opacity: 0.55 })
      );
      ring1.rotation.x = Math.PI * 0.42; ring1.rotation.y = Math.PI * 0.15;
      globe.add(ring1);
      const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(2.40, 0.0012, 8, 200),
        new THREE.MeshBasicMaterial({ color: 0x3a4258, transparent: true, opacity: 0.38 })
      );
      ring2.rotation.x = Math.PI * 0.62; ring2.rotation.y = -Math.PI * 0.28;
      globe.add(ring2);

      const starCount = isSmall ? 600 : 1800;
      const starPos = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i++) {
        const r = 20 + Math.random() * 60;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starPos[i * 3 + 2] = r * Math.cos(phi);
      }
      const starsGeo = new THREE.BufferGeometry();
      starsGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
      const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({
        color: 0xa0a8b8, size: 0.4, sizeAttenuation: true,
        transparent: true, opacity: 0.65, depthWrite: false
      }));
      scene.add(stars);

      scene.add(new THREE.AmbientLight(0x1a2438, 1.2));
      const keyLight = new THREE.DirectionalLight(0xd0e0ff, 2.2);
      keyLight.position.set(-3, 2, 4);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x4060a0, 1.6);
      rimLight.position.set(4, -1, -3);
      scene.add(rimLight);

      let targetX = 0, targetY = 0, currentX = 0, currentY = 0;
      if (!isSmall && !isTouch) {
        window.addEventListener('mousemove', (e) => {
          const r = rect();
          if (r.width === 0) return;
          const mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
          const my = ((e.clientY - r.top) / r.height - 0.5) * 2;
          targetX = mx * 0.35; targetY = my * 0.22;
        }, { passive: true });
      }
      let scrollRot = 0, targetScroll = 0;
      window.addEventListener('scroll', () => {
        const p = Math.min(1, window.scrollY / window.innerHeight);
        targetScroll = p * 0.8;
      }, { passive: true });

      let t = 0;
      const clock = new THREE.Clock();
      function animate() {
        globeAnimId = requestAnimationFrame(animate);
        const dt = clock.getDelta();
        t += dt;

        if (!prefersReduced) globe.rotation.y += 0.0012;
        scrollRot += (targetScroll - scrollRot) * 0.06;

        currentX += (targetX - currentX) * 0.05;
        currentY += (targetY - currentY) * 0.05;
        camera.position.x = currentX;
        camera.position.y = 0.35 - currentY;
        camera.position.z = 5.0 + scrollRot * 0.6;
        camera.lookAt(0, -scrollRot * 0.3, 0);

        globe.rotation.x = Math.sin(t * 0.35) * 0.04 - scrollRot * 0.15;
        stars.rotation.y += 0.00005;

        if (!prefersReduced) {
          arcs.forEach((arc) => {
            arc.userData.progress += arc.userData.speed;
            if (arc.userData.progress > 1.4) arc.userData.progress = 0;
            const p = Math.min(1, arc.userData.progress);
            const total = arc.userData.points.length;
            arc.geometry.setDrawRange(0, Math.max(2, Math.floor(total * p)));
            (arc.material as THREE.LineBasicMaterial).opacity = 0.42 * (p < 0.85 ? 1 : (1 - (p - 0.85) / 0.55));
          });
        }
        hubObjs.forEach((h, i) => {
          h.scale.setScalar(1 + Math.sin(t * 1.6 + i * 1.3) * 0.15);
        });
        atmoMat.uniforms.intensity.value = 0.85 + Math.sin(t * 0.6) * 0.12;

        renderer.render(scene, camera);
      }
      animate();

      requestAnimationFrame(() => {
        stage.classList.add('ready');
        setTimeout(() => preloader?.classList.add('done'), 300);
      });

      ro = new ResizeObserver(() => {
        const r = rect();
        w = r.width; h = r.height;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      ro.observe(stage);
    }

    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => initGlobe(), { timeout: 800 });
    } else {
      setTimeout(initGlobe, 60);
    }
    // Interceptação de links com hash para rolagem suave sem alterar a URL no navegador (sem #FAQ, #planos, etc.)
    const handleAnchorClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a[href^="#"]');
      if (target) {
        const href = target.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          const id = href.slice(1);
          if (id === 'top' || id === '') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            const el = document.getElementById(id);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth' });
            }
          }
          if (typeof window !== 'undefined' && window.history) {
            window.history.replaceState(null, '', window.location.pathname);
          }
          const drawer = document.getElementById('drawer');
          if (drawer) drawer.classList.remove('open');
        }
      }
    };
    document.addEventListener('click', handleAnchorClick);

    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    return () => {
      if (cursorRaf) cancelAnimationFrame(cursorRaf);
      if (globeAnimId) cancelAnimationFrame(globeAnimId);
      if (ro) ro.disconnect();
      if (globeRenderer) globeRenderer.dispose();
      window.removeEventListener('scroll', onScrollNav);
      window.removeEventListener('scroll', onScrollProgress);
      window.removeEventListener('scroll', updateSticky);
      document.removeEventListener('click', handleAnchorClick);
    };
  }, []);

  return (
    <div ref={containerRef} className="fatosbr-landing-wrapper">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />

      <div className="preloader" id="preloader">
        <div className="preloader-inner">
          <div className="preloader-mark">
            <svg viewBox="0 0 40 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12 L8 12 L11 4 L15 20 L19 8 L22 16 L25 12 L38 12" />
            </svg>
          </div>
          <div className="preloader-text">Calibrando sinais</div>
          <div className="preloader-bar"></div>
        </div>
      </div>

      <div className="grain" aria-hidden="true"></div>
      <div className="vignette" aria-hidden="true"></div>
      <div className="cursor-dot" id="cursor-dot" aria-hidden="true"></div>
      <div className="cursor-ring" id="cursor-ring" aria-hidden="true"></div>
      <div className="scroll-progress" id="scroll-progress" aria-hidden="true"></div>

      {/* NAVBAR */}
      <div className="navbar-shell" id="navbar-shell">
        <div className="navbar">
          <a href="#top" className="brand" aria-label="FatosBR — início">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12 L8 12 L11 4 L15 20 L19 8 L22 16 L25 12 L38 12" />
              </svg>
            </span>FatosBR</a>
          <nav className="nav-links" aria-label="Principal">
            <a href="#produto">Produto</a>
            <a href="#funcionalidades">Recursos</a>
            <a href="#comparacao">Comparação</a>
            <a href="#planos">Planos</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-cta">
            <button onClick={onOpenAuth || onEnterApp} className="login">
              Entrar
            </button>
            <button onClick={onStartFreeTrial} className="btn btn-primary magnetic">
              Começar grátis
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
            <button className="burger" id="burger" aria-label="Abrir menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Drawer */}
      <div className="drawer" id="drawer" role="dialog" aria-label="Menu">
        <div className="drawer-top">
          <a href="#top" className="brand" id="drawer-close-link">
            <span className="brand-mark">
              <svg viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12 L8 12 L11 4 L15 20 L19 8 L22 16 L25 12 L38 12" />
              </svg>
            </span>FatosBR</a>
          <button className="drawer-close" id="drawer-close" aria-label="Fechar menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        <nav className="drawer-nav">
          <a href="#produto">
            Produto <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
          </a>
          <a href="#funcionalidades">
            Recursos <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
          </a>
          <a href="#comparacao">
            Comparação <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
          </a>
          <a href="#planos">
            Planos <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
          </a>
          <a href="#faq">
            FAQ <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
          </a>
        </nav>
        <div className="drawer-cta">
          <button onClick={onStartFreeTrial} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
            Começar 3 dias grátis
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <button onClick={onOpenAuth || onEnterApp} className="btn btn-ghost" style={{ width: '100%' }}>
            Fazer Login
          </button>
        </div>
      </div>

      <div className="sticky-cta" id="sticky-cta">
        <div className="sticky-cta-info">
          <div className="sticky-cta-title">3 dias grátis</div>
          <div className="sticky-cta-sub">Sem cartão · R$ 29,90/mês depois</div>
        </div>
        <button onClick={onStartFreeTrial} className="btn btn-primary">
          Começar
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>

      {/* HERO */}
      <section className="hero" id="top">
        <div className="orb o1" aria-hidden="true"></div>
        <div className="orb o2" aria-hidden="true"></div>
        <div className="wrap">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow reveal"><span className="eyebrow-dot"></span>Monitoramento inteligente</p>
              <h1 className="reveal words" data-words>Você escolhe. O FatosBR observa.</h1>
              <p className="lead reveal d2">Acompanhe temas, pessoas e empresas que importam. Menos ruído, mais contexto.</p>
              <div className="hero-actions reveal d3">
                <button onClick={onStartFreeTrial} className="btn btn-primary btn-lg magnetic">
                  Começar 3 dias grátis
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
                <button onClick={onOpenAuth || onEnterApp} className="btn btn-ghost btn-lg magnetic">
                  Fazer Login
                </button>
              </div>
              <div className="hero-proof reveal d3">
                <div className="hero-avatars"><span>MR</span><span>AC</span><span>JP</span><span>+</span></div>
                <div className="hero-proof-text"><strong>+10 mil</strong> pessoas já usam</div>
              </div>
              <p className="hero-microcopy reveal d3">
                <span className="dot"></span>
                3 dias grátis · Sem cartão de crédito
              </p>
            </div>

            <div className="stage" id="stage" aria-hidden="true">
              <canvas id="globe-canvas"></canvas>
              <div className="stage-fallback"></div>

              <div className="event-card card-a float-a">
                <span className="ec-pulse"></span>
                <div className="ec-head">
                  <span className="ec-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg></span>
                  <span className="ec-title">Acordo comercial entre blocos avança em negociação</span>
                </div>
                <div className="ec-meta"><span>2h</span><span>3 fontes</span></div>
              </div>

              <div className="event-card card-b float-b">
                <div className="ec-head">
                  <span className="ec-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19V5M4 19h16M8 15V9M12 15V7M16 15v-3" /></svg></span>
                  <span className="ec-title">Setor de tecnologia lidera rodada de investimentos</span>
                </div>
                <div className="ec-meta"><span>4h</span><span>5 fontes</span></div>
              </div>

              <div className="event-card card-c float-c">
                <div className="ec-head">
                  <span className="ec-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a7 7 0 00-4 12.7V17a3 3 0 006 0v-2.3A7 7 0 0012 2z" /><path d="M9 21h6" /></svg></span>
                  <span className="ec-title">Nova regulamentação é discutida por órgãos setoriais</span>
                </div>
                <div className="ec-meta"><span>6h</span><span>2 fontes</span></div>
              </div>

              <div className="event-card card-d float-d">
                <div className="ec-head">
                  <span className="ec-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg></span>
                  <span className="ec-title">Indicadores econômicos são atualizados por instituto</span>
                </div>
                <div className="ec-meta"><span>8h</span><span>4 fontes</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="block" id="problema">
        <div className="wrap">
          <div className="problem-grid">
            <div>
              <p className="eyebrow reveal">O problema</p>
              <h2 className="reveal d1" style={{ margin: '18px 0' }}>Informação não falta. Clareza, sim.</h2>
              <ul className="problem-points">
                <li className="reveal d1"><span className="pp-num">01</span><div className="pp-body"><strong>A mesma notícia em dez lugares diferentes</strong></div></li>
                <li className="reveal d2"><span className="pp-num">02</span><div className="pp-body"><strong>Contexto espalhado entre portais, blogs e redes</strong></div></li>
                <li className="reveal d3"><span className="pp-num">03</span><div className="pp-body"><strong>Sem organização, tudo parece ter o mesmo peso</strong></div></li>
              </ul>
            </div>

            <div className="problem-visual reveal d1" id="problem-visual" aria-hidden="true">
              <div className="converge-pulse"></div>
              <div className="scatter-item s1"><span className="si-tag">Portal A</span>Governo anuncia novo pacote</div>
              <div className="scatter-item s2"><span className="si-tag">Portal B</span>Pacote econômico é discutido</div>
              <div className="scatter-item s3"><span className="si-tag">Agência</span>Medidas entram em consulta</div>
              <div className="scatter-item s4"><span className="si-tag">Blog</span>O que muda com o anúncio</div>
              <div className="scatter-item s5"><span className="si-tag">Jornal</span>Especialistas analisam pacote</div>
              <div className="scatter-item s6"><span className="si-tag">Rádio</span>Entrevista sobre as medidas</div>
              <div className="scatter-item s7"><span className="si-tag">Site</span>Impacto do pacote no setor</div>
              <div className="scatter-item s8"><span className="si-tag">News</span>Reação do mercado</div>
              <div className="converge-caption">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
                Um só acontecimento
              </div>
            </div>

            <div className="problem-visual-mobile reveal d1" aria-hidden="true">
              <div className="pvm-sources">
                <div className="pvm-source"><span className="pvm-tag">Portal A</span>Governo anuncia novo pacote</div>
                <div className="pvm-source"><span className="pvm-tag">Portal B</span>Pacote econômico é discutido</div>
                <div className="pvm-source"><span className="pvm-tag">Agência</span>Medidas entram em consulta</div>
              </div>
              <div className="pvm-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
              </div>
              <div className="pvm-result">
                <span className="pvm-tag">Consolidado pelo FatosBR</span>
                <div className="pvm-result-title">Pacote econômico é discutido</div>
                <div className="pvm-result-meta">3 fontes relacionadas · contexto disponível</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BEFORE/AFTER */}
      <section className="block" id="comparacao-antes-depois">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow reveal">A diferença</p>
            <span className="section-label">02 / 11</span>
            <h2 className="reveal d1">De feeds ruidosos a acontecimentos consolidados.</h2>
            <p className="reveal d2">A diferença entre ler notícias e entender o que aconteceu.</p>
          </div>
          <div className="ba-grid">
            <div className="ba-card before reveal">
              <span className="ba-tag before">Antes · feeds tradicionais</span>
              <ul className="ba-list">
                <li className="bad">O mesmo fato repetido em 12 manchetes diferentes</li>
                <li className="bad">Títulos reescritos que confundem mais do que informam</li>
                <li className="bad">Sem contexto sobre o que já aconteceu antes</li>
                <li className="bad">Nenhuma indicação de por que aquilo importa</li>
                <li className="bad">Fontes espalhadas por abas, apps e newsletters</li>
              </ul>
              <div className="ba-verdict">Você lê <strong>mais</strong> e entende <strong>menos</strong>.</div>
            </div>
            <div className="ba-card after reveal d1">
              <span className="ba-tag after">Depois · FatosBR</span>
              <ul className="ba-list">
                <li className="good">Um único acontecimento consolidado</li>
                <li className="good">Todas as fontes reunidas e verificáveis</li>
                <li className="good">Contexto disponível quando você precisa</li>
                <li className="good">"Por que isso importa" em cada card</li>
                <li className="good">Tudo em um feed organizado por relevância</li>
              </ul>
              <div className="ba-verdict">Você entende o mundo em <strong>minutos</strong>, não em horas.</div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARAÇÃO */}
      <section className="block" id="comparacao">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow reveal">Comparação direta</p>
            <span className="section-label">03 / 11</span>
            <h2 className="reveal d1">Por que o FatosBR, e não outras ferramentas.</h2>
            <p className="reveal d2">Uma comparação honesta com as alternativas mais comuns.</p>
          </div>
          <div className="compare-table reveal">
            <div className="compare-head">
              <div className="col-label">Recurso</div>
              <div className="col-brand us">FatosBR<span className="brand-sub">R$ 29,90</span></div>
              <div className="col-brand">Feedly<span className="brand-sub">US$ pago</span></div>
              <div className="col-brand">Google Alerts<span className="brand-sub">grátis</span></div>
            </div>
            <div className="compare-row"><div className="col-label">Acontecimentos consolidados</div><div className="compare-cell highlight"><span className="yes">✓</span></div><div className="compare-cell"><span className="no">✕</span></div><div className="compare-cell"><span className="no">✕</span></div></div>
            <div className="compare-row"><div className="col-label">Contexto "por que importa"</div><div className="compare-cell highlight"><span className="yes">✓</span></div><div className="compare-cell"><span className="no">✕</span></div><div className="compare-cell"><span className="no">✕</span></div></div>
            <div className="compare-row"><div className="col-label">Fontes brasileiras curadas</div><div className="compare-cell highlight"><span className="yes">✓</span></div><div className="compare-cell"><span className="partial">parcial</span></div><div className="compare-cell"><span className="partial">parcial</span></div></div>
            <div className="compare-row"><div className="col-label">Personalização profunda</div><div className="compare-cell highlight"><span className="yes">✓</span></div><div className="compare-cell"><span className="yes">✓</span></div><div className="compare-cell"><span className="no">✕</span></div></div>
            <div className="compare-row"><div className="col-label">Alertas em tempo real</div><div className="compare-cell highlight"><span className="yes">✓</span></div><div className="compare-cell"><span className="partial">limitado</span></div><div className="compare-cell"><span className="no">✕</span></div></div>
            <div className="compare-row"><div className="col-label">Interface em português</div><div className="compare-cell highlight"><span className="yes">✓</span></div><div className="compare-cell"><span className="partial">parcial</span></div><div className="compare-cell"><span className="yes">✓</span></div></div>
            <div className="compare-row"><div className="col-label">Preço</div><div className="compare-cell highlight"><span className="price-br">R$ 29,90/mês</span></div><div className="compare-cell"><span className="price-us">US$ 8–18</span></div><div className="compare-cell"><span className="partial">grátis limitado</span></div></div>
          </div>
          <div className="compare-mobile">
            <div className="cm-plan us reveal">
              <div className="cm-plan-name">FatosBR<span className="cm-plan-badge">Recomendado</span></div>
              <div className="cm-plan-sub">R$ 29,90/mês</div>
              <ul className="cm-list">
                <li><span className="ic yes">✓</span>Acontecimentos consolidados</li>
                <li><span className="ic yes">✓</span>Contexto "por que importa"</li>
                <li><span className="ic yes">✓</span>Fontes brasileiras curadas</li>
                <li><span className="ic yes">✓</span>Alertas em tempo real</li>
              </ul>
            </div>
            <div className="cm-plan reveal d1">
              <div className="cm-plan-name">Feedly</div>
              <div className="cm-plan-sub">US$ 8 a US$ 18/mês</div>
              <ul className="cm-list">
                <li className="no"><span className="ic no">✕</span>Sem consolidação de acontecimentos</li>
                <li className="no"><span className="ic no">✕</span>Sem contexto "por que importa"</li>
                <li><span className="ic partial">~</span>Fontes brasileiras parciais</li>
                <li><span className="ic partial">~</span>Alertas limitados</li>
              </ul>
            </div>
            <div className="cm-plan reveal d2">
              <div className="cm-plan-name">Google Alerts</div>
              <div className="cm-plan-sub">Grátis, com limitações</div>
              <ul className="cm-list">
                <li className="no"><span className="ic no">✕</span>Sem consolidação de acontecimentos</li>
                <li className="no"><span className="ic no">✕</span>Sem contexto "por que importa"</li>
                <li><span className="ic partial">~</span>Fontes brasileiras parciais</li>
                <li className="no"><span className="ic no">✕</span>Sem alertas em tempo real</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* SOLUTION */}
      <section className="block" id="produto">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow reveal">A solução</p>
            <span className="section-label">04 / 11</span>
            <h2 className="reveal d1">Várias notícias. Uma visão clara.</h2>
            <p className="reveal d2">O FatosBR agrupa conteúdos relacionados em um só acontecimento — com fontes, contexto e relevância.</p>
          </div>
          <div className="event-view reveal d1">
            <div className="event-main">
              <span className="event-status"><span className="pulse"></span>Em atualização</span>
              <h3>Apple apresenta nova linha de iPhone 17</h3>
              <p className="summary">Empresa anunciou novos modelos e melhorias em câmera, desempenho e bateria para a linha iPhone 17. Cobertura consolidada de múltiplas fontes internacionais.</p>
              <div className="event-tags">
                <span className="tag">Tecnologia</span><span className="tag">Apple</span>
                <span className="tag">Hardware</span><span className="tag">Mercado</span>
              </div>
              <div className="why">
                <span className="why-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z" /><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z" /></svg></span>
                <div className="why-body"><strong>Por que importa</strong><p>Impacta diretamente o mercado de smartphones, cadeia de fornecedores e estratégia de concorrentes.</p></div>
              </div>
            </div>
            <aside className="event-side">
              <div className="side-head"><span>Fontes</span><span className="count">5 de 12</span></div>
              <div className="sources">
                <a className="source" href="#"><span className="source-logo bbc">BBC</span><div className="source-info"><div className="source-name">BBC News</div><div className="source-meta">há 2h · internacional</div></div><span className="source-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M9 7h8v8" /></svg></span></a>
                <a className="source" href="#"><span className="source-logo" style={{ background: 'linear-gradient(135deg,#ff0080,#7928ca)', color: '#fff' }}>TV</span><div className="source-info"><div className="source-name">The Verge</div><div className="source-meta">há 2h · tecnologia</div></div><span className="source-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M9 7h8v8" /></svg></span></a>
                <a className="source" href="#"><span className="source-logo" style={{ background: '#ff7f00', color: '#fff' }}>R</span><div className="source-info"><div className="source-name">Reuters</div><div className="source-meta">há 3h · agência</div></div><span className="source-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M9 7h8v8" /></svg></span></a>
                <a className="source" href="#"><span className="source-logo folha">F</span><div className="source-info"><div className="source-name">Folha de S.Paulo</div><div className="source-meta">há 4h · nacional</div></div><span className="source-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M9 7h8v8" /></svg></span></a>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* DEMO */}
      <section className="block" id="demonstracao">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow reveal">Produto</p>
            <span className="section-label">05 / 11</span>
            <h2 className="reveal d1">Uma experiência feita para acompanhar.</h2>
            <p className="reveal d2">No desktop e no celular. Simples, focada e sem ruído.</p>
          </div>
          <div className="demo">
            <div className="desktop-mockup reveal tilt-desktop">
              <div className="desktop-inner">
                <div className="dm-bar">
                  <div className="dm-dots"><span></span><span></span><span></span></div>
                  <div className="dm-url"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>fatosbr.app / feed</div>
                  <div className="dm-live"><span className="dm-live-dot"></span>AO VIVO</div>
                </div>
                <div className="dm-body">
                  <aside className="dm-side">
                    <div className="brand-sm"><svg viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12 L8 12 L11 4 L15 20 L19 8 L22 16 L25 12 L38 12" /></svg>FatosBR</div>
                    <nav className="dm-nav">
                      <a className="active" onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l9-8 9 8v10a2 2 0 01-2 2h-4v-6h-6v6H5a2 2 0 01-2-2z" /></svg>Início</a>
                      <a onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>Explorar</a>
                      <a onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18M3 12h18" /></svg>Seguindo</a>
                      <a onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h12v18l-6-3-6 3z" /></svg>Salvos</a>
                      <a onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" /></svg>Notificações<span className="badge">3</span></a>
                    </nav>
                    <div className="dm-user">
                      <div className="dm-user-av">MR</div>
                      <div><div className="dm-user-name">Marina R.</div><div className="dm-user-role">Plano Pro</div></div>
                    </div>
                  </aside>
                  <div className="dm-main">
                    <div className="dm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>Buscar acontecimentos...<span className="kbd">⌘K</span></div>
                    <div className="dm-tabs"><span className="dm-tab active">Para você</span><span className="dm-tab">Seguindo</span><span className="dm-tab">Em alta</span></div>
                    <div className="dm-feed">
                      <div className="news">
                        <div className="news-top">
                          <span className="news-cat tech">Tecnologia</span>
                          <span className="news-time">há 2 horas</span>
                          <div className="news-actions"><button className="news-action saved" aria-label="Salvo"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v18l-6-3-6 3z" /></svg></button><button className="news-action" aria-label="Mais"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></button></div>
                        </div>
                        <div className="news-title">Apple apresenta nova linha de iPhone 17</div>
                        <div className="news-sub">Empresa anunciou novos modelos e melhorias em câmera, desempenho e bateria.</div>
                        <div className="news-divider"></div>
                        <div className="news-foot">
                          <span className="news-count">5 fontes</span>
                          <div className="source-bubbles"><span className="bbc">B</span><span className="verge">V</span><span className="reuters">R</span><span className="more">+2</span></div>
                          <button className="news-context">Contexto <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg></button>
                        </div>
                        <div className="news-context-body"><strong>Por que importa:</strong> afeta o mercado de smartphones, cadeia de fornecedores e estratégia de concorrentes.</div>
                      </div>
                      <div className="news">
                        <div className="news-top">
                          <span className="news-cat pol">Política</span>
                          <span className="news-time">há 5 horas</span>
                          <div className="news-actions"><button className="news-action" aria-label="Salvar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h12v18l-6-3-6 3z" /></svg></button><button className="news-action" aria-label="Mais"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></button></div>
                        </div>
                        <div className="news-title">Governo anuncia novo pacote fiscal</div>
                        <div className="news-sub">Medidas incluem mudanças em impostos e revisão de despesas para os próximos anos.</div>
                        <div className="news-divider"></div>
                        <div className="news-foot">
                          <span className="news-count">3 fontes</span>
                          <div className="source-bubbles"><span className="folha">F</span><span className="valor">V</span><span className="g1">g1</span></div>
                          <button className="news-context">Contexto <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg></button>
                        </div>
                        <div className="news-context-body"><strong>Por que importa:</strong> afeta arrecadação, orçamento público e planejamento de empresas.</div>
                      </div>
                      <div className="news">
                        <div className="news-top">
                          <span className="news-cat eco">Economia</span>
                          <span className="news-time">há 6 horas</span>
                          <div className="news-actions"><button className="news-action" aria-label="Salvar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h12v18l-6-3-6 3z" /></svg></button><button className="news-action" aria-label="Mais"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></button></div>
                        </div>
                        <div className="news-title">Copom mantém taxa Selic em decisão unânime</div>
                        <div className="news-sub">Comitê sinaliza cautela diante do cenário externo e da inflação corrente.</div>
                        <div className="news-divider"></div>
                        <div className="news-foot">
                          <span className="news-count">4 fontes</span>
                          <div className="source-bubbles"><span className="valor">V</span><span className="folha">F</span><span className="g1">g1</span><span className="more">+1</span></div>
                          <button className="news-context">Contexto <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg></button>
                        </div>
                        <div className="news-context-body"><strong>Por que importa:</strong> a taxa básica de juros impacta crédito, investimentos e toda a economia.</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="phone-stage reveal d1">
              <div className="phone">
                <div className="phone-btn phone-btn-vol-up"></div>
                <div className="phone-btn phone-btn-vol-down"></div>
                <div className="phone-btn phone-btn-power"></div>
                <div className="phone-screen">
                  <div className="phone-island"></div>
                  <div className="ps-status"><span>9:41</span><span className="battery">100%</span></div>
                  <div className="ps-header">
                    <div className="ps-brand"><svg viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12 L8 12 L11 4 L15 20 L19 8 L22 16 L25 12 L38 12" /></svg>FatosBR</div>
                    <div className="ps-bell"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" /><path d="M10 20a2 2 0 004 0" /></svg></div>
                  </div>
                  <div className="ps-tabs"><button className="ps-tab active">Para você</button><button className="ps-tab">Seguindo</button><button className="ps-tab">Em alta</button></div>
                  <div className="ps-feed">
                    <div className="news">
                      <div className="news-top">
                        <span className="news-cat tech">Tecnologia</span>
                        <span className="news-time">há 2h</span>
                        <div className="news-actions"><button className="news-action saved" aria-label="Salvo"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v18l-6-3-6 3z" /></svg></button></div>
                      </div>
                      <div className="news-title">Apple apresenta nova linha de iPhone 17</div>
                      <div className="news-sub">Empresa anunciou novos modelos e melhorias em câmera, desempenho e bateria.</div>
                      <div className="news-divider"></div>
                      <div className="news-foot">
                        <span className="news-count">5 fontes</span>
                        <div className="source-bubbles"><span className="bbc">B</span><span className="verge">V</span><span className="reuters">R</span><span className="more">+2</span></div>
                        <button className="news-context">Contexto <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg></button>
                      </div>
                      <div className="news-context-body"><strong>Por que importa:</strong> afeta o mercado de smartphones e a estratégia de concorrentes.</div>
                    </div>
                    <div className="news">
                      <div className="news-top">
                        <span className="news-cat pol">Política</span>
                        <span className="news-time">há 5h</span>
                        <div className="news-actions"><button className="news-action" aria-label="Salvar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h12v18l-6-3-6 3z" /></svg></button></div>
                      </div>
                      <div className="news-title">Governo anuncia novo pacote fiscal</div>
                      <div className="news-sub">Medidas incluem mudanças em impostos e revisão de despesas.</div>
                      <div className="news-divider"></div>
                      <div className="news-foot">
                        <span className="news-count">3 fontes</span>
                        <div className="source-bubbles"><span className="folha">F</span><span className="valor">V</span><span className="g1">g1</span></div>
                        <button className="news-context">Contexto <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg></button>
                      </div>
                      <div className="news-context-body"><strong>Por que importa:</strong> afeta arrecadação, orçamento público e planejamento empresarial.</div>
                    </div>
                  </div>
                  <nav className="ps-nav">
                    <a className="ps-nav-item active" onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11l9-8 9 8v10a2 2 0 01-2 2h-4v-6h-6v6H5a2 2 0 01-2-2z" /></svg>Início</a>
                    <a className="ps-nav-item" onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg>Explorar</a>
                    <a className="ps-nav-item" onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h12v18l-6-3-6 3z" /></svg>Seguindo</a>
                    <a className="ps-nav-item" onClick={onEnterApp}><span className="notif"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" /><path d="M10 20a2 2 0 004 0" /></svg>Notificações</a>
                    <a className="ps-nav-item" onClick={onEnterApp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>Perfil</a>
                  </nav>
                  <div className="phone-home"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="block" id="funcionalidades">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow reveal">Recursos</p>
            <span className="section-label">06 / 11</span>
            <h2 className="reveal d1">Tudo organizado para você.</h2>
          </div>
          <div className="features">
            <div className="feature f-1 reveal">
              <span className="feature-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 0118 0M3 12a9 9 0 0018 0M12 3v18" /></svg></span>
              <h3>Múltiplas fontes, um só lugar</h3>
              <p>Portais, agências e veículos especializados em uma única visão.</p>
            </div>
            <div className="feature f-2 reveal d1">
              <span className="feature-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg></span>
              <h3>Personalização</h3>
              <p>Escolha os temas, pessoas e empresas que deseja acompanhar.</p>
            </div>
            <div className="feature f-3 reveal">
              <span className="feature-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h10M4 18h16" /></svg></span>
              <h3>Acontecimentos consolidados</h3>
              <p>Conteúdos relacionados agrupados em torno do mesmo fato.</p>
            </div>
            <div className="feature f-4 reveal d1">
              <span className="feature-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg></span>
              <h3>Contexto e relevância</h3>
              <p>Entenda o que aconteceu e por que pode importar.</p>
            </div>
            <div className="feature f-5 reveal d2">
              <span className="feature-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg></span>
              <h3>Exploração inteligente</h3>
              <p>Descubra acontecimentos ligados aos seus interesses.</p>
            </div>
            <div className="feature f-6 reveal">
              <span className="feature-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" /><path d="M10 20a2 2 0 004 0" /></svg></span>
              <h3>Alertas e briefings</h3>
              <p>Destaques e resumos conforme as atualizações acontecem.</p>
            </div>
            <div className="feature f-7 reveal d1">
              <span className="feature-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h12v18l-6-3-6 3z" /></svg></span>
              <h3>Histórico e salvos</h3>
              <p>Retorne a acontecimentos importantes quando precisar.</p>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="block" id="numeros" style={{ padding: 'clamp(50px,7vw,90px) 0' }}>
        <div className="wrap">
          <div className="section-head" style={{ marginBottom: '36px' }}>
            <p className="eyebrow reveal">Em números</p>
            <h2 className="reveal d1" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.1rem)' }}>Informação de qualidade, medida na prática.</h2>
          </div>
          <div className="stats reveal d1">
            <div className="stat"><div className="stat-val" data-count="10" data-suffix="K+">0</div><div className="stat-label">pessoas usando o FatosBR</div></div>
            <div className="stat"><div className="stat-val" data-count="200" data-suffix="+">0</div><div className="stat-label">fontes monitoradas</div></div>
            <div className="stat"><div className="stat-val" data-count="98" data-suffix="%">0</div><div className="stat-label">precisão na consolidação</div></div>
            <div className="stat"><div className="stat-val" data-count="7" data-suffix="s">0</div><div className="stat-label">tempo médio de atualização</div></div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="block" id="como-funciona">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow reveal">Como funciona</p>
            <span className="section-label">07 / 11</span>
            <h2 className="reveal d1">Em três passos.</h2>
          </div>
          <div className="steps">
            <div className="step reveal"><span className="step-num">01</span><h3>Escolha o que importa</h3><p>Temas, pessoas, empresas ou organizações que você quer acompanhar.</p></div>
            <div className="step reveal d1"><span className="step-num">02</span><h3>O FatosBR reúne</h3><p>Fontes monitoradas e conteúdos relacionados agrupados em acontecimentos.</p></div>
            <div className="step reveal d2"><span className="step-num">03</span><h3>Você entende</h3><p>Contexto, fontes e relevância em uma visão clara do que aconteceu.</p></div>
          </div>
        </div>
      </section>

      {/* AUDIENCE */}
      <section className="block" id="para-quem">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow reveal">Para quem é</p>
            <span className="section-label">08 / 11</span>
            <h2 className="reveal d1">Para quem precisa entender o que acontece.</h2>
          </div>
          <div className="audience">
            <div className="aud reveal"><span className="aud-num">01</span><div><strong>Profissionais acompanhando o próprio setor</strong></div></div>
            <div className="aud reveal d1"><span className="aud-num">02</span><div><strong>Empreendedores monitorando empresas e mercados</strong></div></div>
            <div className="aud reveal"><span className="aud-num">03</span><div><strong>Analistas e pesquisadores de temas específicos</strong></div></div>
            <div className="aud reveal d1"><span className="aud-num">04</span><div><strong>Pessoas que querem entender melhor o mundo</strong></div></div>
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="block" id="confianca">
        <div className="wrap">
          <div className="trust-grid">
            <div>
              <p className="eyebrow reveal">Transparência</p>
              <h2 className="reveal d1" style={{ margin: '18px 0' }}>Sempre claro de onde vem.</h2>
              <p className="reveal d2">Origem visível, links diretos para as fontes e separação entre conteúdo original e resumo.</p>
              <ul className="trust-list">
                <li className="reveal d1"><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Origem das informações sempre visível</li>
                <li className="reveal d1"><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Links diretos para as fontes originais</li>
                <li className="reveal d2"><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Separação entre origem e resumo contextual</li>
                <li className="reveal d2"><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Limitações sinalizadas quando aplicável</li>
              </ul>
              <div className="trust-badges reveal d2">
                <span className="trust-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg>LGPD compliant</span>
                <span className="trust-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>Dados no Brasil</span>
                <span className="trust-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V7z" /></svg>Criptografia em trânsito</span>
              </div>
            </div>
            <div className="trust-visual reveal d1" aria-hidden="true">
              <div className="chain">
                <div className="chain-row"><span className="lbl">Fonte</span><span className="val">BBC News · há 2h</span><span className="dot" style={{ marginLeft: 'auto' }}></span></div>
                <div className="chain-connector"></div>
                <div className="chain-row"><span className="lbl">Fonte</span><span className="val">The Verge · há 2h</span><span className="dot" style={{ marginLeft: 'auto' }}></span></div>
                <div className="chain-connector"></div>
                <div className="chain-row"><span className="lbl">Consolidado</span><span className="val">Atualizado há 2h</span><span className="dot" style={{ marginLeft: 'auto' }}></span></div>
                <div className="chain-connector"></div>
                <div className="chain-row"><span className="lbl">Contexto</span><span className="val">Resumo com base nas fontes</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PLANS */}
      <section className="block" id="planos">
        <div className="wrap">
          <div className="plans">
            <div className="plans-copy">
              <p className="eyebrow reveal">Planos</p>
              <span className="section-label">09 / 11</span>
              <h2 className="reveal d1">Comece grátis. Evolua quando quiser.</h2>
              <p className="reveal d2">3 dias sem compromisso. Cancele em 1 clique, dentro da própria plataforma.</p>
              <ul className="reveal d2">
                <li>3 dias de teste gratuito</li>
                <li>Sem cartão de crédito</li>
                <li>Assinatura via PIX, gerenciada pelo FatosBR</li>
              </ul>
            </div>
            <div className="plan-card reveal d1">
              <div className="plan-name">FatosBR Pro</div>
              <div className="plan-price"><span className="val">R$ 29,90</span><span className="per">/mês</span></div>
              <div className="plan-sub">Cobrança mensal via PIX</div>
              <ul className="plan-benefits">
                <li><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Acesso completo à plataforma</li>
                <li><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Monitoramento contínuo</li>
                <li><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Personalização completa</li>
                <li><span className="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg></span>Histórico ilimitado</li>
              </ul>
              <button onClick={onStartFreeTrial} className="btn btn-primary btn-lg plan-cta magnetic">
                Começar 3 dias grátis
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
              <div className="plan-guarantee">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V7z" /><path d="M9 12l2 2 4-4" /></svg>
                Cancele quando quiser, em 1 clique. Sem letras miúdas.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="block" id="faq">
        <div className="wrap">
          <div className="section-head" style={{ maxWidth: '760px', margin: '0 auto clamp(32px,4vw,54px)', textAlign: 'center' }}>
            <p className="eyebrow reveal" style={{ justifyContent: 'center' }}>Perguntas frequentes</p>
            <span className="section-label">10 / 11</span>
            <h2 className="reveal d1" style={{ marginTop: '16px' }}>Dúvidas sobre o FatosBR</h2>
          </div>
          <div className="faq">
            <div className="faq-item reveal"><button className="faq-q" aria-expanded="false">O que é o FatosBR?<span className="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span></button><div className="faq-a"><p>Plataforma de monitoramento inteligente de acontecimentos. Você escolhe o que acompanhar, e o FatosBR reúne informações de diferentes fontes em acontecimentos consolidados.</p></div></div>
            <div className="faq-item reveal"><button className="faq-q" aria-expanded="false">Como os acontecimentos são agrupados?<span className="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span></button><div className="faq-a"><p>Identificamos conteúdos relacionados entre diferentes fontes e os organizamos em torno de um mesmo fato. Você acompanha um acontecimento em vez de dez artigos repetidos.</p></div></div>
            <div className="faq-item reveal"><button className="faq-q" aria-expanded="false">Como funciona o teste gratuito?<span className="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span></button><div className="faq-a"><p>3 dias sem exigir cartão de crédito. Você tem acesso completo durante o período para avaliar se o FatosBR faz sentido para você.</p></div></div>
            <div className="faq-item reveal"><button className="faq-q" aria-expanded="false">Como funciona a assinatura?<span className="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span></button><div className="faq-a"><p>Cobrança mensal via PIX, com ciclos gerenciados pela própria plataforma. Não há renovação automática por cartão.</p></div></div>
            <div className="faq-item reveal"><button className="faq-q" aria-expanded="false">Como posso cancelar?<span className="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span></button><div className="faq-a"><p>A qualquer momento, dentro da própria plataforma, na área de gerenciamento da conta. Sem contato com suporte, sem burocracia.</p></div></div>
            <div className="faq-item reveal"><button className="faq-q" aria-expanded="false">Como o FatosBR usa inteligência artificial?<span className="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span></button><div className="faq-a"><p>Como infraestrutura para identificar conteúdos relacionados, agrupar acontecimentos e gerar resumos contextuais. Nunca substitui a fonte original.</p></div></div>
            <div className="faq-item reveal"><button className="faq-q" aria-expanded="false">Como meus dados são protegidos?<span className="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span></button><div className="faq-a"><p>Tratados conforme a LGPD e a política de privacidade do FatosBR. Detalhes sobre coleta, uso e armazenamento estão disponíveis na própria política.</p></div></div>
          </div>
        </div>
      </section>

      {/* FINAL */}
      <section className="final" id="comecar">
        <div className="wrap">
          <div className="final-inner">
            <p className="eyebrow reveal" style={{ justifyContent: 'center' }}>Comece agora</p>
            <h2 className="reveal d1 words" data-words>Menos ruído. Mais contexto.</h2>
            <p className="reveal d2">Comece a acompanhar o que realmente importa.</p>
            <button onClick={onStartFreeTrial} className="btn btn-primary btn-lg magnetic reveal d3">
              Começar grátis
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
            <p className="microcopy reveal d3">3 dias grátis · Sem cartão de crédito · Cancele em 1 clique</p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="site">
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-brand">
              <a href="#top" className="brand">
                <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12 L8 12 L11 4 L15 20 L19 8 L22 16 L25 12 L38 12" /></svg></span>FatosBR</a>
              <p>Você escolhe. O FatosBR observa.</p>
            </div>
            <div className="foot-col"><h4>Produto</h4><ul>
              <li><a href="#funcionalidades">Recursos</a></li>
              <li><a href="#comparacao">Comparação</a></li>
              <li><a href="#planos">Planos</a></li>
              <li><a onClick={onOpenAuth || onEnterApp} style={{ cursor: 'pointer' }}>Entrar</a></li>
            </ul></div>
            <div className="foot-col"><h4>Suporte</h4><ul>
              <li><a href="#faq">Perguntas frequentes</a></li>
              <li><a href="#faq">Contato</a></li>
            </ul></div>
            <div className="foot-col"><h4>Legal & Leis</h4><ul>
              <li><a onClick={() => onOpenLegal ? onOpenLegal('terms') : null} style={{ cursor: 'pointer' }}>Termos de uso</a></li>
              <li><a onClick={() => onOpenLegal ? onOpenLegal('lgpd') : null} style={{ cursor: 'pointer' }}>Privacidade & LGPD</a></li>
              <li><a onClick={() => onOpenLegal ? onOpenLegal('cdc') : null} style={{ cursor: 'pointer' }}>Consumidor (CDC) & Pix</a></li>
              <li><a onClick={() => onOpenLegal ? onOpenLegal('dpo') : null} style={{ cursor: 'pointer' }}>Canal do DPO</a></li>
            </ul></div>
          </div>
          <div className="foot-bottom">
            <span>© 2025 FatosBR. Todos os direitos reservados.</span>
            <div className="foot-social" aria-label="Redes sociais">
              <a href="#" aria-label="X"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2H21.5l-7.5 8.57L22.5 22h-6.75l-5.29-6.9L4.4 22H1.14l8.02-9.17L1.5 2h6.92l4.78 6.31L18.244 2zm-1.18 18h1.79L7.03 3.9H5.12l11.94 16.1z" /></svg></a>
              <a href="#" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-.96 1.83-1.97 3.77-1.97 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.5c0-1.31-.02-3-1.83-3-1.83 0-2.11 1.43-2.11 2.9V21h-4z" /></svg></a>
              <a href="#" aria-label="YouTube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31 31 0 000 12a31 31 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31 31 0 0024 12a31 31 0 00-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" /></svg></a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
};
