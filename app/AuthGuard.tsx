"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "./lib/supabase";

type AccessStatus =
  | "checking" | "approved" | "pending" | "disabled"
  | "unregistered" | "signed-out" | "error";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [accessStatus, setAccessStatus] = useState<AccessStatus>("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const isLoginPage = pathname === "/login";
  const isRecoveryPage = pathname === "/reset-password";

  useEffect(() => {
    let active = true;
    // Recovery must be accessible without employee approval, including while
    // Supabase processes the recovery session from the email link.
    if (isRecoveryPage) return () => { active = false; };

    async function checkEmployeeAccess() {
      setAccessStatus("checking");
      setErrorMessage("");
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error || !data.user) {
        setAccessStatus("signed-out");
        if (!isLoginPage) router.replace("/login");
        return;
      }
      const { data: employee, error: employeeError } = await supabase
        .from("mercury_employees")
        .select("status")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (!active) return;
      if (employeeError) {
        setErrorMessage(employeeError.message);
        setAccessStatus("error");
        return;
      }
      if (!employee) { setAccessStatus("unregistered"); return; }
      if (employee.status === "approved") {
        setAccessStatus("approved");
        if (isLoginPage) router.replace("/");
        return;
      }
      if (employee.status === "pending") { setAccessStatus("pending"); return; }
      if (employee.status === "disabled") { setAccessStatus("disabled"); return; }
      setAccessStatus("error");
      setErrorMessage("Unknown employee account status.");
    }

    void checkEmployeeAccess();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => { if (active) void checkEmployeeAccess(); }, 0);
    });
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void checkEmployeeAccess();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isLoginPage, isRecoveryPage, router, pathname]);

  if (isRecoveryPage) return <>{children}</>;
  if (isLoginPage && (accessStatus === "signed-out" || accessStatus === "checking")) return <>{children}</>;
  if (accessStatus === "checking") return <AccessScreen title="Checking Employee Access" message="Verifying your Mercury Painting account..." />;
  if (accessStatus === "approved") {
    if (isLoginPage) return <AccessScreen title="Redirecting" message="Opening your Mercury Painting dashboard..." />;
    return <>{children}</>;
  }
  if (accessStatus === "signed-out") return <AccessScreen title="Sign In Required" message="Redirecting to the employee login..." />;
  if (accessStatus === "pending" || accessStatus === "disabled" || accessStatus === "unregistered") {
    const title = accessStatus === "pending" ? "Administrator Approval Required" : accessStatus === "disabled" ? "Employee Account Disabled" : "Employee Account Not Registered";
    const message = accessStatus === "pending" ? "Your Mercury Painting account is awaiting administrator approval." : accessStatus === "disabled" ? "Your Mercury Painting account has been disabled. Contact your administrator." : "Your account is not registered as a Mercury Painting employee. Contact your administrator.";
    return <AccessScreen title={title} message={message} showSignOut />;
  }
  return <AccessScreen title="Unable to Verify Access" message={errorMessage || "Employee access could not be verified. Please try again."} showSignOut />;
}

function AccessScreen({ title, message, showSignOut = false }: { title: string; message: string; showSignOut?: boolean }) {
  const [signingOut, setSigningOut] = useState(false);
  async function handleSignOut() {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) { alert(`Unable to sign out: ${error.message}`); setSigningOut(false); return; }
    window.location.replace("/login");
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#F5F5F5] px-5"><div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg"><div className="mx-auto mb-6 h-2 w-24 bg-[#FFD400]" /><p className="text-sm font-black uppercase tracking-widest text-[#ED1C24]">Mercury Painting</p><h1 className="mt-3 text-2xl font-black uppercase text-[#252525]">{title}</h1><p className="mt-4 leading-7 text-gray-600">{message}</p>{showSignOut && <button type="button" onClick={handleSignOut} disabled={signingOut} className="mt-8 rounded-xl bg-[#ED1C24] px-8 py-4 font-black text-white transition hover:bg-red-700 disabled:opacity-50">{signingOut ? "Signing Out..." : "Sign Out"}</button>}<p className="mt-8 text-xs text-gray-400">Developed by ECI — Emerald Coast Innovations</p></div></main>;
}
