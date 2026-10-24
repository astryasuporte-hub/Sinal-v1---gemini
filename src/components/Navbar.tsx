/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Compass,
  BookmarkCheck,
  FileText,
  Bell,
  User,
  Shield,
  Layers,
  Sparkles
} from 'lucide-react';
import { FatosBrLogo } from './FatosBrLogo';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  unreadCount: number;
  followedCount: number;
  onOpenBilling: () => void;
  onOpenOnboarding: () => void;
  subscriptionStatus: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  unreadCount,
  followedCount,
  onOpenBilling,
  onOpenOnboarding,
  subscriptionStatus
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo FatosBR Oficial com linha de pulso */}
        <div className="flex items-center space-x-6">
          <button
            onClick={() => onSelectTab('feed')}
            className="flex items-center gap-3 text-left group cursor-pointer focus:outline-none"
          >
            <FatosBrLogo size="md" />
          </button>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => onSelectTab('feed')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                currentTab === 'feed'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              Início
            </button>
            <button
              onClick={() => onSelectTab('explore')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                currentTab === 'explore'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              Explorar
            </button>
            <button
              onClick={() => onSelectTab('following')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                currentTab === 'following'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <span>Seguindo</span>
              <span className="text-[10px] bg-zinc-900 px-1.5 py-0.2 rounded border border-zinc-700/60 text-zinc-400">
                {followedCount}
              </span>
            </button>
            <button
              onClick={() => onSelectTab('briefings')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                currentTab === 'briefings'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              Briefings
            </button>
          </nav>
        </div>

        {/* Right Action Tools */}
        <div className="flex items-center space-x-2">
          {/* Status da Assinatura / Trial */}
          <button
            onClick={onOpenBilling}
            className="hidden sm:flex items-center gap-2 px-2.5 py-1 text-xs rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-colors cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Trial Ativo (6d)</span>
            <span className="text-[10px] text-zinc-400 underline">PIX</span>
          </button>

          {/* Calibrar / Onboarding */}
          <button
            onClick={onOpenOnboarding}
            title="Calibrar Interesses"
            className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-md transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {/* Notificações */}
          <button
            onClick={() => onSelectTab('notifications')}
            className={`p-2 relative rounded-md transition-colors cursor-pointer ${
              currentTab === 'notifications'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
            }`}
            title="Notificações"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-zinc-100 rounded-full" />
            )}
          </button>

          {/* Perfil */}
          <button
            onClick={() => onSelectTab('profile')}
            className={`p-2 rounded-md transition-colors cursor-pointer ${
              currentTab === 'profile'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
            }`}
            title="Perfil & Configurações"
          >
            <User className="w-4 h-4" />
          </button>

          {/* Painel Operacional / Admin */}
          <button
            onClick={() => onSelectTab('admin')}
            className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer flex items-center gap-1 ${
              currentTab === 'admin'
                ? 'bg-zinc-100 text-zinc-950 border-zinc-100 font-semibold'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
            }`}
            title="Painel Administrativo do FatosBR"
          >
            <Shield className="w-3 h-3" />
            <span className="hidden lg:inline">Admin</span>
          </button>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (Responsividade 390px, 430px) */}
      <div className="md:hidden flex items-center justify-around border-t border-zinc-800/80 bg-zinc-950 py-2 px-1">
        <button
          onClick={() => onSelectTab('feed')}
          className={`flex flex-col items-center py-1 px-3 text-[10px] ${
            currentTab === 'feed' ? 'text-zinc-100 font-medium' : 'text-zinc-400'
          }`}
        >
          <Layers className="w-4 h-4 mb-0.5" />
          <span>Início</span>
        </button>
        <button
          onClick={() => onSelectTab('explore')}
          className={`flex flex-col items-center py-1 px-3 text-[10px] ${
            currentTab === 'explore' ? 'text-zinc-100 font-medium' : 'text-zinc-400'
          }`}
        >
          <Compass className="w-4 h-4 mb-0.5" />
          <span>Explorar</span>
        </button>
        <button
          onClick={() => onSelectTab('following')}
          className={`flex flex-col items-center py-1 px-3 text-[10px] ${
            currentTab === 'following' ? 'text-zinc-100 font-medium' : 'text-zinc-400'
          }`}
        >
          <BookmarkCheck className="w-4 h-4 mb-0.5" />
          <span>Seguindo</span>
        </button>
        <button
          onClick={() => onSelectTab('briefings')}
          className={`flex flex-col items-center py-1 px-3 text-[10px] ${
            currentTab === 'briefings' ? 'text-zinc-100 font-medium' : 'text-zinc-400'
          }`}
        >
          <FileText className="w-4 h-4 mb-0.5" />
          <span>Briefings</span>
        </button>
      </div>
    </header>
  );
};
