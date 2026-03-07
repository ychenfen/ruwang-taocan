"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { clearToken } from "../lib/token";

type NavItem = Readonly<{ href: string; label: string; group: string }>;

const items: NavItem[] = [
  { group: "核心", href: "/dashboard", label: "总览" },
  { group: "业务", href: "/cards", label: "我的网卡" },
  { group: "业务", href: "/team", label: "我的团队" },
  { group: "业务", href: "/downlines", label: "我的同事" },
  { group: "通知", href: "/announcements", label: "公告" },
];

export function Sidebar() {
  const pathname = usePathname();
  const groups = Array.from(new Set(items.map((x) => x.group)));

  return (
    <aside className="sidebar">
      <div className="sidebarHeader">
        <div className="brand">
          <div className="brandMark" />
          <div>
            <div className="brandTitle">职工端</div>
            <div className="brandSub">Cards + Colleagues + Team</div>
          </div>
        </div>
      </div>

      <nav className="nav">
        {groups.map((g) => (
          <div key={g}>
            <div className="navGroupTitle">{g}</div>
            {items
              .filter((x) => x.group === g)
              .map((x) => {
                const active = pathname === x.href || pathname.startsWith(`${x.href}/`);
                return (
                  <Link
                    key={x.href}
                    href={x.href}
                    className={`navItem ${active ? "navItemActive" : ""}`}
                    prefetch={false}
                  >
                    <span>{x.label}</span>
                  </Link>
                );
              })}
          </div>
        ))}

        <div style={{ padding: 10, borderTop: "1px solid var(--border)", marginTop: 10 }}>
          <button
            className="btn btnDanger"
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
          >
            退出登录
          </button>
        </div>
      </nav>
    </aside>
  );
}
