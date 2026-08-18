import React, { useState } from "react";
import { 
  Search, 
  SlidersHorizontal, 
  Plus, 
  FileText, 
  Landmark, 
  Calendar, 
  ChevronRight, 
  LayoutGrid, 
  List,
  Building2,
  MoreVertical,
  TrendingUp,
  ArrowRight
} from "lucide-react";

export function Fintech() {
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");

  const clients = [
    {
      id: 1,
      name: "Acme Corp",
      code: "ACME",
      files: 1,
      loans: 5,
      fye: "Dec 31, 2024",
      trend: "+12%",
    },
    {
      id: 2,
      name: "AI Sample Client",
      code: "AI TEST",
      files: 1,
      loans: 4,
      fye: "Dec 31, 2026",
      trend: "+4%",
    },
    {
      id: 3,
      name: "C I Group",
      code: "CIGRP",
      files: 1,
      loans: 23,
      fye: "Feb 28, 2026",
      trend: "+28%",
    }
  ];

  return (
    <div className="min-h-screen bg-[#F4F5F7] font-sans text-[#111827]">
      {/* Custom Font Import */}
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&family=Raleway:wght@500;600;700;800&display=swap');
        .font-lato { font-family: 'Lato', sans-serif; }
        .font-raleway { font-family: 'Raleway', sans-serif; }
      `}} />

      <div className="font-lato">
        {/* Dark Header Band (Clearline charcoal) */}
        <header className="bg-[#262626] text-white border-b border-[#3a3a3a]">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src="/__mockup/images/clearline-logo-white.png" alt="Clearline CPA" className="h-9 w-auto" />
              <div className="flex flex-col">
                <h1 className="font-raleway text-lg font-bold tracking-tight text-white leading-tight">Loan &amp; Lease Amortization Tables</h1>
                <span className="text-xs text-gray-400 font-medium tracking-widest uppercase">Clarity &middot; Strategy &middot; Confidence</span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-gray-300 font-raleway uppercase tracking-wide text-xs">
                <a href="#" className="text-[#FB7708]">Clients</a>
                <a href="#" className="hover:text-white transition-colors">Reports</a>
                <a href="#" className="hover:text-white transition-colors">Settings</a>
              </nav>
              <div className="w-px h-6 bg-[#3a3a3a] hidden md:block"></div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#3a3a3a] border border-[#4a4a4a] flex items-center justify-center text-sm font-semibold text-[#FB7708]">
                  JD
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          {/* Page Controls */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <div>
              <h2 className="font-raleway text-2xl font-extrabold tracking-tight text-gray-900">Clients</h2>
              <p className="text-sm text-gray-500 mt-1">Manage year-end files and loan data across your portfolio.</p>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Search clients..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FB7708]/20 focus:border-[#FB7708] transition-all shadow-sm"
                />
              </div>

              <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                <button 
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-lg transition-colors ${viewMode === 'table' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              <button className="flex items-center justify-center p-2.5 bg-white border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors shadow-sm">
                <SlidersHorizontal className="w-4 h-4" />
              </button>

              <button className="flex items-center gap-2 bg-[#FB7708] hover:bg-[#e56c00] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm shadow-[#FB7708]/20">
                <Plus className="w-4 h-4" />
                <span>New Client</span>
              </button>
            </div>
          </div>

          {/* Grid View */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clients.map((client) => (
              <div key={client.id} className="group bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-xl hover:shadow-gray-200/50 hover:border-orange-500/30 transition-all duration-300 flex flex-col">
                <div className="p-6 pb-5 flex-1">
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex gap-3 items-center">
                      <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-orange-50 group-hover:text-[#FB7708] group-hover:border-orange-100 transition-colors">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-lg leading-tight">{client.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 uppercase tracking-wider">{client.code}</span>
                        </div>
                      </div>
                    </div>
                    <button className="text-gray-400 hover:text-gray-900 p-1 -mr-2">
                      <MoreVertical className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-2">
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100/50">
                      <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                        <FileText className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Files</span>
                      </div>
                      <div className="text-xl font-bold text-gray-900">{client.files}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100/50">
                      <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                        <Landmark className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Loans</span>
                      </div>
                      <div className="flex items-end justify-between">
                        <div className="text-xl font-bold text-gray-900">{client.loans}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between group-hover:bg-orange-50/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400 group-hover:text-[#FB7708] transition-colors" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Latest FYE</span>
                      <span className="text-sm font-semibold text-gray-900">{client.fye}</span>
                    </div>
                  </div>
                  
                  <button className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 group-hover:bg-[#FB7708] group-hover:border-[#FB7708] group-hover:text-white transition-all shadow-sm">
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
