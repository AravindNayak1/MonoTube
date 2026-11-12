import { BRAND } from '../../shared/brand';
import { LogoMark } from './Icon';

export function Header({ active }: { active: boolean }) {
  return (
    <header className="header">
      <LogoMark className="header-logo" size={28} />
      <div className="header-brand">
        <h1 className="header-name">{BRAND.name}</h1>
        <p className="header-tagline">{BRAND.tagline}</p>
      </div>
      <span className="status" data-active={active || undefined} data-testid="status">
        <span className="status-dot" aria-hidden="true" />
        {active ? 'Active' : 'Paused'}
      </span>
    </header>
  );
}
