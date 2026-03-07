import type { ReactNode } from "react";

import "./globals.css";

export default function RootLayout(props: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, sans-serif" }}>
        {props.children}
      </body>
    </html>
  );
}
