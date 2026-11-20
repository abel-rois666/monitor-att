import { useState } from 'react';
import {
  Bell,
  Cloud,
  Database,
  LayoutGrid,
  LineChart as LineChartIcon,
  LogIn,
  LogOut,
  Menu,
  Star,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useMonitorStore } from './hooks/useMonitorStore';
import { CatalogView } from './components/CatalogView';
import { PriceHistoryView } from './components/PriceHistoryView';
import { FavoritesView } from './components/FavoritesView';
import { AlertsView } from './components/AlertsView';
import { ArchitectureView } from './components/ArchitectureView';
import { VariantDetailDrawer } from './components/VariantDetailDrawer';
import type { SmartphoneVariant } from './shared/types';

type ActiveSection = 'catalog' | 'history' | 'favorites' | 'alerts' | 'architecture';

const NAV_ITEMS: Array<{
  id: ActiveSection;
  label: string;
  icon: typeof LayoutGrid;
}> = [
  { id: 'catalog', label: 'Catálogo', icon: LayoutGrid },
  { id: 'history', label: 'Historial de precios', icon: LineChartIcon },
  { id: 'favorites', label: 'Favoritos', icon: Star },
  { id: 'alerts', label: 'Alertas Telegram', icon: Bell },
  { id: 'architecture', label: 'Arquitectura y scraper', icon: Cloud },
];

const SECTION_TITLES: Record<ActiveSection, string> = {
  catalog: 'Catálogo de celulares',
  history: 'Historial de precios',
  favorites: 'Favoritos',
  alerts: 'Alertas Telegram',
  architecture: 'Arquitectura y scraper',
};

function MonitorWorkspace() {
  const { user, signingIn, authError, signInWithGoogle, logout } = useAuth();
  const store = useMonitorStore();

  const [activeSection, setActiveSection] = useState<ActiveSection>('catalog');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<SmartphoneVariant | null>(null);
  const [preselectedAlertVariantId, setPreselectedAlertVariantId] = useState<string | null>(
    null
  );

  const selectedFavorite = selectedVariant
    ? store.favorites.find((f) => f.variantId === selectedVariant.id)
    : undefined;

  const handleNavigate = (section: ActiveSection) => {
    setActiveSection(section);
    setMobileMenuOpen(false);
  };

  const handleCreateAlertFromDrawer = (variant: SmartphoneVariant) => {
    setSelectedVariant(null);
    setPreselectedAlertVariantId(variant.id);
    setActiveSection('alerts');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Sidebar escritorio */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-20">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            AT&amp;T Price Monitor
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-50 text-sky-800'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'favorites' && store.favorites.length > 0 && (
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {store.favorites.length}
                  </span>
                )}
                {item.id === 'alerts' && store.alertRules.length > 0 && (
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {store.alertRules.filter((r) => r.enabled).length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Pie informativo honesto del espacio de trabajo */}
        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium text-slate-700">
            <Database className="w-3.5 h-3.5 text-sky-700 shrink-0" aria-hidden="true" />
            <span>
              {store.firestoreSynced ? 'Firestore sincronizado' : 'Persistencia local'}
            </span>
          </div>
          <p className="leading-relaxed">
            Catálogo en modo simulación (Etapa 1). Scraper Crawlee + Playwright desactivado.
          </p>
        </div>
      </aside>

      {/* Drawer móvil */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/35"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <span className="text-sm font-bold text-slate-900 whitespace-nowrap">
                AT&amp;T Price Monitor
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Cerrar menú"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-sky-50 text-sky-800'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Contenido principal */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top bar limpio con breadcrumb + 1 acción de cuenta */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/95 backdrop-blur border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegación"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 whitespace-nowrap">
                AT&amp;T Price Monitor
              </span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-900 truncate">
                {SECTION_TITLES[activeSection]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="hidden md:inline text-xs text-slate-600 truncate max-w-[180px]">
                  {user.displayName || user.email}
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Cerrar sesión
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                disabled={signingIn}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                {signingIn ? 'Conectando...' : 'Conectar Firestore'}
              </button>
            )}
          </div>
        </header>

        {(authError || store.syncError) && (
          <div className="mx-4 lg:mx-8 mt-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {authError || store.syncError}
          </div>
        )}

        <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeSection === 'catalog' && (
            <CatalogView
              variants={store.catalog.variants}
              loading={store.catalogLoading}
              disclaimer={store.catalog.disclaimer}
              targetUrl={store.catalog.targetUrl}
              favorites={store.favorites}
              onToggleFavorite={(v) => void store.toggleFavorite(v)}
              onSelectVariant={setSelectedVariant}
            />
          )}

          {activeSection === 'history' && (
            <PriceHistoryView
              variants={store.catalog.variants}
              onSelectVariant={setSelectedVariant}
            />
          )}

          {activeSection === 'favorites' && (
            <FavoritesView
              favorites={store.favorites}
              variants={store.catalog.variants}
              firestoreSynced={store.firestoreSynced}
              onUpdateFavorite={(id, price, notes) =>
                void store.updateFavoriteDetails(id, price, notes)
              }
              onRemoveFavorite={(v) => void store.toggleFavorite(v)}
              onSelectVariant={setSelectedVariant}
              onGoToCatalog={() => setActiveSection('catalog')}
            />
          )}

          {activeSection === 'alerts' && (
            <AlertsView
              variants={store.catalog.variants}
              alertRules={store.alertRules}
              telegramSettings={store.telegramSettings}
              scraperStatus={store.scraperStatus}
              firestoreSynced={store.firestoreSynced}
              preselectedVariantId={preselectedAlertVariantId}
              onClearPreselectedVariant={() => setPreselectedAlertVariantId(null)}
              onCreateRule={store.createAlertRule}
              onToggleRule={(id, enabled) => void store.toggleAlertRule(id, enabled)}
              onDeleteRule={(id) => void store.deleteAlertRule(id)}
              onSaveTelegramSettings={store.saveTelegramSettings}
            />
          )}

          {activeSection === 'architecture' && (
            <ArchitectureView scraperStatus={store.scraperStatus} />
          )}
        </main>
      </div>

      <VariantDetailDrawer
        variant={selectedVariant}
        favorite={selectedFavorite}
        onClose={() => setSelectedVariant(null)}
        onToggleFavorite={(v) => void store.toggleFavorite(v)}
        onSaveTargetPrice={(id, price, notes) =>
          void store.updateFavoriteDetails(id, price, notes)
        }
        onCreateAlertForVariant={handleCreateAlertFromDrawer}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <MonitorWorkspace />
      </AuthProvider>
    </ErrorBoundary>
  );
}
