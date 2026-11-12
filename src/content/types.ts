import type { PageType } from '../shared/navigation';
import type { ActiveFeatures, EffectiveTheme, Settings } from '../shared/settings';
import type { UiRoot } from './ui/root';
import type { Router } from './router';

/** Services handed to every module factory: `createXModule(deps: ModuleDeps): FeatureModule`. */
export interface ModuleDeps {
  /** Current route + bounded in-tab route history, and a navigate-start hook. */
  router: Router;
  /**
   * Video id of a Short that the Shorts DNR rule redirected to the homepage (/?mt_shorts=<id>),
   * for as long as the user stays on that landing page. YouTube strips unknown query parameters
   * from the URL right after load, so the id is captured at document_start, not read from the
   * current URL.
   */
  blockedShortsId(route: Route): string | null;
  /** Mark the redirected Short's notice as dismissed (shared by the homepage and Shorts modules). */
  dismissBlockedShorts(id: string): void;
}

/** A resolved location inside YouTube's single-page app. */
export interface Route {
  url: URL;
  href: string;
  page: PageType;
}

export type UpdateReason = 'init' | 'route' | 'settings' | 'theme';

/** Everything a feature module needs to (re)render itself. Passed on every update. */
export interface ModuleContext {
  settings: Settings;
  features: ActiveFeatures;
  theme: EffectiveTheme;
  route: Route;
  /** Route before the most recent navigation (null on first load). */
  prevRoute: Route | null;
  reason: UpdateReason;
  ui: UiRoot;
}

/**
 * Contract for content-script feature modules.
 *
 * - update() is called on init, on every SPA navigation, on settings changes and on OS theme
 *   changes. It MUST be idempotent: compare desired vs. current state and only touch the DOM
 *   when something differs (this is what keeps MutationObserver loops impossible).
 * - When the module's feature is inactive (ctx.features.* false, or wrong page), update() must
 *   remove everything the module added and restore anything it changed.
 * - destroy() tears everything down (extension disabled/invalidated).
 */
export interface FeatureModule {
  readonly name: string;
  update(ctx: ModuleContext): void;
  destroy(): void;
}
