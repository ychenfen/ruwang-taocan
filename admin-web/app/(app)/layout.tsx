import type { ReactNode } from "react";

import { AuthGate } from "../../components/AuthGate";
import { Sidebar } from "../../components/Sidebar";

export default function AppLayout(props: Readonly<{ children: ReactNode }>) {
  return (
    <div className="container">
      <div className="appShell">
        <AuthGate>
          <Sidebar />
          <main className="main">{props.children}</main>
        </AuthGate>
      </div>
    </div>
  );
}

