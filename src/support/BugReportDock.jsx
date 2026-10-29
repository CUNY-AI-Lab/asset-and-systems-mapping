import { createContext, useContext, useState } from 'react';

const RegisterDock = createContext(null);
const DockTarget = createContext(null);

export function BugReportDockProvider({ children }) {
  const [dock, setDock] = useState(null);
  return <RegisterDock.Provider value={setDock}><DockTarget.Provider value={dock}>{children}</DockTarget.Provider></RegisterDock.Provider>;
}

// Use this stable callback as the ref of the workspace's report slot. The
// report itself stays mounted beside AccountWorkspace through navigation.
export function useBugReportDock() {
  return useContext(RegisterDock);
}

export function useBugReportDockTarget() {
  return useContext(DockTarget);
}
