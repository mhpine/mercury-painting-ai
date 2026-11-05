"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Checking your password reset link...");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        setReady(true);
        setMessage("");
      }
    });

    async function verifyLink() {
      try {
        const url = new URL(window.location.href);
        const error = url.searchParams.get("error_description");
        if (error) throw new Error(error);
        const code = url.searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (active) { setReady(true); setMessage(""); }
          return;
        }
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const hashError = hash.get("error_description");
        if (hashError) throw new Error(hashError);
        const access_token = hash.get("access_token");
        const refresh_token = hash.get("refresh_token");
        if (access_token && refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
          if (sessionError) throw sessionError;
          window.history.replaceState({}, "", url.pathname);
          if (active) { setReady(true); setMessage(""); }
          return;
        }
        // A Supabase auth listener may already have consumed the recovery tokens.
        const { data: { session } } = await supabase.auth.getSession();
        if (active && session) { setReady(true); setMessage(""); }
        else if (active) setMessage("This reset link is invalid or expired. Request a new link from Sign In.");
      } catch (err) {
        if (active) setMessage(err instanceof Error ? err.message : "Invalid or expired reset link.");
      }
    }
    void verifyLink();
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) { setMessage("Use at least 8 characters."); return; }
    if (password !== confirm) { setMessage("Passwords do not match."); return; }
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setMessage(error.message);
    else {
      setSuccess(true);
      setReady(false);
      await supabase.auth.signOut();
      setMessage("Password updated. Sign in with your new password.");
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F7F7] px-5 py-12">
      <section className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="h-2 bg-[#ED1C24]" />
        <div className="p-8">
          <img src="/images/mercury-logo.png" alt="Mercury Painting" className="mx-auto mb-6 h-auto w-40" />
          <p className="text-center text-xs font-black tracking-widest text-[#ED1C24]">MERCURY PAINTING COMPANY</p>
          <h1 className="my-4 text-center text-2xl font-black text-[#171717]">RESET PASSWORD</h1>
          {ready && !success && (
            <form onSubmit={savePassword} className="space-y-4">
              <label className="block text-sm font-bold text-gray-800">New password
                <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 p-3" />
              </label>
              <label className="block text-sm font-bold text-gray-800">Confirm password
                <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 p-3" />
              </label>
              <button type="submit" disabled={loading} className="w-full rounded-lg bg-[#ED1C24] p-4 font-black text-white disabled:opacity-50">{loading ? "UPDATING..." : "SAVE NEW PASSWORD"}</button>
            </form>
          )}
          {message && <p role="status" className="mt-5 rounded-lg bg-yellow-50 p-3 text-sm text-gray-800">{message}</p>}
          <Link href="/login" className="mt-6 block text-center font-bold text-[#ED1C24] underline">Back to Sign In</Link>
          <p className="mt-8 text-center text-xs text-gray-500">Developed by ECI — Emerald Coast Innovations</p>
        </div>
      </section>
    </main>
  );
}
