
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "./lib/supabase";

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  const isPublicPage = pathname === "/login";

  useEffect(() => {
    let active = true;

    async function checkSession() {
      setChecking(true);

      const { data, error } = await supabase.auth.getSession();

      if (!active) return;

      const signedIn = !error && Boolean(data.session);
      setAuthenticated(signedIn);
      setChecking(false);

      if (!signedIn && pathname !== "/login") {
        router.replace("/login");
      }
    }

    void checkSession();

    const { data: listener } =
      supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;

        const signedIn = Boolean(session);
        setAuthenticated(signedIn);
        setChecking(false);

        if (!signedIn && pathname !== "/login") {
          router.replace("/login");
        }
      });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (checking || !authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-lg font-bold text-gray-600">
          Checking employee access...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
