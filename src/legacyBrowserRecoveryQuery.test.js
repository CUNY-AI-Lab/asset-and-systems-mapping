import { describe, expect, it, vi } from 'vitest';
import { cleanLegacyBrowserRecoveryQuery } from './legacyBrowserRecoveryQuery.js';

describe('legacy browser recovery URLs', () => {
  it('loads the ordinary app while removing only the retired query parameter', () => {
    const history = { state: { retained: true }, replaceState: vi.fn() };
    const location = { pathname: '/systems-mapping/', search: '?course=msh-245&browserRecovery=destination&view=account', hash: '#projects' };
    expect(cleanLegacyBrowserRecoveryQuery(location, history)).toBe(true);
    expect(history.replaceState).toHaveBeenCalledWith({ retained: true }, '', '/systems-mapping/?course=msh-245&view=account#projects');
  });

  it('strips repeated and unknown legacy values, preserving unrelated local state', () => {
    const history = { state: null, replaceState: vi.fn() };
    const location = { pathname: '/', search: '?browserRecovery=source&browserRecovery=unknown&x=1', hash: '' };
    const localState = { unsavedDraft: 'keep this' };
    expect(cleanLegacyBrowserRecoveryQuery(location, history)).toBe(true);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?x=1');
    expect(localState.unsavedDraft).toBe('keep this');
  });

  it('does nothing for ordinary URLs', () => {
    const history = { state: null, replaceState: vi.fn() };
    expect(cleanLegacyBrowserRecoveryQuery({ pathname: '/', search: '?course=one', hash: '' }, history)).toBe(false);
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
