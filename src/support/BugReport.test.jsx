// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BugReport from './BugReport.jsx';
import { BugReportDockProvider, useBugReportDock } from './BugReportDock.jsx';

function Navigation() {
  const [mapOpen, setMapOpen] = useState(false);
  const dock = useBugReportDock();
  return <><button onClick={() => setMapOpen(value => !value)}>{mapOpen ? 'Projects' : 'Open map'}</button>
    {mapOpen && <footer className="notebook-footer"><nav aria-label="Workspace">Map Notebook</nav><span ref={dock} className="workspace-bug-report" /></footer>}
  </>;
}

function openWorkspace() {
  return render(<BugReportDockProvider><Navigation /><BugReport /></BugReportDockProvider>);
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });

test('moves the same report form between Projects and the map footer while retaining its draft', async () => {
  const fetch = vi.fn(async () => Response.json({ enabled: true, mode: 'email', delivery: 'email' }));
  vi.stubGlobal('fetch', fetch);
  openWorkspace();
  const trigger = await screen.findByRole('button', { name: 'Report a problem', exact: true });
  const host = trigger.closest('.bug-report-host');
  fireEvent.click(trigger);
  const description = screen.getByLabelText('What went wrong? What could be better?');
  fireEvent.input(description, { target: { value: 'My map keeps this report draft while I visit Projects.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open map', exact: true }));
  expect(document.querySelector('.workspace-bug-report').firstChild).toBe(host);
  expect(document.querySelector('.bug-report-footer')).toHaveAttribute('hidden');
  expect(document.documentElement).toHaveClass('bug-report-docked');
  expect(document.documentElement.style.getPropertyValue('--bug-report-height')).toBe('0px');
  expect(screen.getByLabelText('What went wrong? What could be better?')).toBe(description);
  expect(description).toHaveValue('My map keeps this report draft while I visit Projects.');
  fireEvent.click(screen.getByRole('button', { name: 'Projects', exact: true }));
  expect(document.querySelector('.bug-report-footer').firstChild).toBe(host);
  expect(document.querySelector('.bug-report-footer')).not.toHaveAttribute('hidden');
  expect(document.documentElement).not.toHaveClass('bug-report-docked');
  fireEvent.click(screen.getByRole('button', { name: 'Open map', exact: true }));
  expect(document.querySelector('.workspace-bug-report').firstChild).toBe(host);
  expect(screen.getByLabelText('What went wrong? What could be better?')).toBe(description);
  expect(description).toHaveValue('My map keeps this report draft while I visit Projects.');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('keeps an in-flight report and its uncertain reference through dock changes', async () => {
  let resolveReport;
  const posts = [];
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    if (url.endsWith('/availability')) return Promise.resolve(Response.json({ enabled: true, mode: 'email', delivery: 'email' }));
    const body = JSON.parse(options.body); posts.push(body);
    if (posts.length === 1) return new Promise(resolve => { resolveReport = resolve; });
    return Promise.resolve(Response.json({ ok: true, status: 'accepted', reportId: body.reportId }));
  }));
  openWorkspace();
  fireEvent.click(await screen.findByRole('button', { name: 'Report a problem', exact: true }));
  const description = screen.getByLabelText('What went wrong? What could be better?');
  fireEvent.input(description, { target: { value: 'This report stays pending while I open and close my map.' } });
  fireEvent.submit(description.closest('form'));
  await waitFor(() => expect(posts).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Open map', exact: true }));
  expect(screen.getByLabelText('What went wrong? What could be better?')).toBe(description);
  expect(description).toHaveAttribute('readonly');
  expect(description.closest('form')).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Projects', exact: true }));
  await act(async () => { resolveReport(Response.json({ error: 'Acknowledgement unavailable' }, { status: 503 })); });
  // Browser coverage checks the native popover visibility; here the retained
  // form and request identity remain observable even while its panel is closed.
  const retry = await screen.findByRole('button', { name: 'Check report status', hidden: true });
  expect(screen.getByRole('status', { hidden: true })).toHaveTextContent(posts[0].reportId);
  fireEvent.click(screen.getByRole('button', { name: 'Open map', exact: true }));
  expect(screen.getByRole('button', { name: 'Check report status', hidden: true })).toBe(retry);
  fireEvent.click(retry);
  await screen.findByRole('button', { name: 'Report sent', hidden: true });
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(posts[0]);
  expect(screen.getByRole('status', { hidden: true })).toHaveTextContent(posts[0].reportId);
});

test('keeps reporting unavailable without reserving a footer or map dock', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })));
  openWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Open map', exact: true }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(document.querySelector('.bug-report-footer')).toBeNull();
  expect(document.querySelector('.workspace-bug-report')).toBeEmptyDOMElement();
  expect(document.documentElement).not.toHaveClass('has-bug-report');
});
