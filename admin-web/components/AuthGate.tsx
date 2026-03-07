"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { getToken } from "../lib/token";

export function AuthGate(props: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      if (pathname !== "/login") router.replace("/login");
      setOk(false);
      return;
    }
    setOk(true);
  }, [pathname, router]);

  if (!ok) return null;
  return <>{props.children}</>;
}

