import "./_group.css";
import {
  Users, Search, Plus, Trash2, Settings, LayoutGrid, Table as TableIcon,
  CalendarDays, Landmark, FolderOpen, ChevronDown,
} from "lucide-react";

const clients = [
  { name: "Acme Corp", code: "ACME", files: 1, loans: 5, fye: "FYE Dec 31, 2024" },
  { name: "AI Sample Client", code: "AI TEST", files: 1, loans: 4, fye: "FYE Dec 31, 2026" },
  { name: "C I Group", code: "CIGRP", files: 1, loans: 23, fye: "FYE Feb 28, 2026" },
];

export function Current() {
  return (
    <div
      className="clients-home-current min-h-screen"
      style={{ background: "hsl(220 33% 98%)", color: "hsl(222 47% 11%)" }}
    >
      <header className="border-b bg-white" style={{ borderColor: "hsl(30 15% 90%)" }}>
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-lg font-bold">Loan &amp; Lease Amortization Tables</h1>
            <span className="text-sm" style={{ color: "hsl(24 10% 45%)" }}>
              Create and manage loan and lease amortization tables.
            </span>
            <Trash2 className="h-4 w-4" style={{ color: "hsl(24 10% 45%)" }} />
            <Settings className="h-4 w-4" style={{ color: "hsl(24 10% 45%)" }} />
          </div>
          <div className="text-right font-display font-bold tracking-tight">
            C<span className="font-normal">|</span>clearline
            <span className="block text-[8px] font-normal tracking-widest text-right" style={{ color: "hsl(24 10% 45%)" }}>CPA</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(24 95% 45% / 0.1)" }}>
              <Users className="h-5 w-5" style={{ color: "hsl(24 95% 45%)" }} />
            </div>
            <div>
              <h2 className="text-2xl font-display font-semibold">Clients</h2>
              <p className="text-sm" style={{ color: "hsl(24 10% 45%)" }}>3 clients</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(24 10% 45%)" }} />
              <input
                placeholder="Search clients..."
                className="h-9 w-[320px] pl-8 text-sm rounded-md border bg-white outline-none"
                style={{ borderColor: "hsl(30 15% 90%)" }}
                readOnly
              />
            </div>
            <button
              className="h-9 px-3 rounded-md border bg-white text-xs inline-flex items-center gap-2"
              style={{ borderColor: "hsl(30 15% 90%)" }}
            >
              Name (A to Z) <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <div className="inline-flex items-center rounded-lg p-1" style={{ background: "hsl(30 10% 96%)" }}>
              <span className="inline-flex items-center justify-center rounded-md px-2.5 py-1.5 bg-white shadow">
                <LayoutGrid className="h-4 w-4" />
              </span>
              <span className="inline-flex items-center justify-center rounded-md px-2.5 py-1.5" style={{ color: "hsl(24 10% 45%)" }}>
                <TableIcon className="h-4 w-4" />
              </span>
            </div>
            <button
              className="h-9 px-4 rounded-md text-sm font-medium inline-flex items-center gap-2 shadow-sm text-white"
              style={{ background: "hsl(24 95% 45%)" }}
            >
              <Plus className="h-4 w-4" /> Add Client
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {clients.map((c) => (
            <div
              key={c.code}
              className="rounded-xl bg-white shadow-sm border"
              style={{ borderColor: "hsl(30 15% 90%)", borderLeft: "4px solid hsl(24 95% 45%)" }}
            >
              <div className="p-6 pb-3">
                <p className="text-lg font-display font-semibold">{c.name}</p>
                <p className="font-mono text-xs mt-1" style={{ color: "hsl(24 10% 45%)" }}>{c.code}</p>
              </div>
              <div className="px-6 pb-6 space-y-3">
                <div className="flex items-center gap-3 text-sm" style={{ color: "hsl(24 10% 45%)" }}>
                  <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {c.files} file</span>
                  <span className="inline-flex items-center gap-1"><Landmark className="h-3.5 w-3.5" /> {c.loans} loans</span>
                  <span className="ml-auto rounded px-2 py-0.5 text-xs" style={{ background: "hsl(30 10% 96%)" }}>{c.fye}</span>
                </div>
                <button
                  className="w-full h-10 rounded-md border text-sm font-medium inline-flex items-center justify-center gap-2"
                  style={{ borderColor: "hsl(222 47% 11%)" }}
                >
                  <FolderOpen className="h-4 w-4" /> View Year-End Files
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
