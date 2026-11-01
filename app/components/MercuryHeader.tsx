"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Estimates", href: "/estimates" },
  { label: "Settings", href: "/settings" },
];

export default function MercuryHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="relative z-50 border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">

        {/* LOGO + AI ESTIMATOR */}
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 sm:gap-5"
        >
          <div className="relative h-20 w-36 shrink-0 sm:h-24 sm:w-52">
            <Image
              src="/images/mercury-logo.png"
              alt="Mercury Painting Company"
              fill
              priority
              sizes="(max-width: 640px) 144px, 208px"
              className="object-contain object-left"
            />
          </div>

          <div className="border-l-4 border-[#FFD400] pl-3 sm:pl-5">
            <span className="text-base font-black uppercase tracking-wide text-[#ED1C24] sm:text-2xl">
              AI ESTIMATOR
            </span>
          </div>
        </Link>

        {/* DESKTOP NAVIGATION */}
        <nav className="hidden items-center gap-8 lg:flex">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-4 py-2 text-sm font-bold transition ${
                  active
                    ? "border-[#FFD400] text-[#ED1C24]"
                    : "border-transparent text-gray-600 hover:text-[#ED1C24]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* NEW PROJECT BUTTON */}
        <Link
          href="/projects/new"
          className="hidden rounded-xl bg-[#ED1C24] px-6 py-4 text-sm font-black text-white shadow-lg transition hover:bg-red-700 sm:inline-flex"
        >
          + New Project
        </Link>

        {/* MOBILE MENU BUTTON */}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          className="rounded-xl border border-gray-200 px-4 py-3 text-xl lg:hidden"
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* MOBILE NAVIGATION */}
      {menuOpen && (
        <nav className="absolute left-0 right-0 top-full border-t border-gray-200 bg-white p-5 shadow-xl lg:hidden">
          {[
            ...navigation,
            { label: "AI Walkthrough", href: "/walkthrough" },
            { label: "New Project", href: "/projects/new" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="block rounded-xl px-4 py-4 font-bold hover:bg-red-50 hover:text-[#ED1C24]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}