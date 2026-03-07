"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { clearToken } from "../lib/token";

type NavItem = Readonly<{ href: string; label: string; group: string }>;

const items: NavItem[] = [
  { group: "核心", href: "/dashboard", label: "总览" },
  { group: "核心", href: "/account", label: "管理员密码" },
  { group: "配置", href: "/agent-levels", label: "星级" },
  { group: "配置", href: "/plans", label: "套餐" },
  { group: "配置", href: "/policies", label: "政策" },
  { group: "组织", href: "/teams", label: "团队" },
  { group: "组织", href: "/agents", label: "职工" },
  { group: "运营", href: "/cards", label: "网卡" },
  { group: "结算", href: "/settlements", label: "结算" },
  { group: "结算", href: "/ledger", label: "入账分录" },
  { group: "报表", href: "/reports", label: "导出/汇总" },
  { group: "追责", href: "/announcements", label: "公告" },
  { group: "追责", href: "/audit-logs", label: "审计" },
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
            <div className="brandTitle">入网套餐后台</div>
            <div className="brandSub">Admin Console</div>
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
