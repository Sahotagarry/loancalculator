import React, { useState } from "react";
import { Search, Plus, ArrowUpDown, LayoutGrid, List, FileText, Calculator, ChevronRight, Building2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

const CLIENTS = [
  {
    id: "1",
    name: "Acme Corp",
    code: "ACME",
    files: 1,
    loans: 5,
    fye: "Dec 31, 2024",
    initials: "AC",
  },
  {
    id: "2",
    name: "AI Sample Client",
    code: "AI TEST",
    files: 1,
    loans: 4,
    fye: "Dec 31, 2026",
    initials: "AI",
  },
  {
    id: "3",
    name: "C I Group",
    code: "CIGRP",
    files: 1,
    loans: 23,
    fye: "Feb 28, 2026",
    initials: "CI",
  },
];

export function Refined() {
  const [view, setView] = useState("grid");
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
      `}} />
      
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center border border-orange-100">
              <Calculator className="w-4 h-4 text-orange-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">Loan &amp; Lease Amortization Tables</h1>
              <span className="text-sm font-medium text-slate-500">Clearline CPA</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-500 hidden sm:block">
              Welcome back
            </div>
            <Avatar className="w-9 h-9 border border-slate-200 bg-slate-50">
              <AvatarFallback className="text-slate-600 font-medium text-sm">CPA</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight mb-2">Clients</h2>
            <p className="text-slate-500 text-sm">Manage client files, loans, and leases across fiscal years.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button className="bg-orange-600 hover:bg-orange-700 text-white shadow-sm transition-all h-10 px-5 rounded-md">
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search clients or codes..." 
              className="pl-9 h-10 bg-slate-50/50 border-slate-200 focus-visible:ring-orange-500/20 focus-visible:border-orange-500 transition-all rounded-md shadow-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
              <span className="whitespace-nowrap hidden sm:inline-block">Sort by:</span>
              <Select defaultValue="name">
                <SelectTrigger className="w-[140px] h-10 border-slate-200 bg-slate-50/50 shadow-none focus:ring-orange-500/20">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name (A-Z)</SelectItem>
                  <SelectItem value="fye">Fiscal Year End</SelectItem>
                  <SelectItem value="loans">Most Loans</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="h-6 w-px bg-slate-200 hidden sm:block mx-1" />
            
            <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v)} className="bg-slate-50/50 border border-slate-200 p-1 rounded-lg">
              <ToggleGroupItem value="grid" aria-label="Grid view" className="h-8 w-8 px-0 data-[state=on]:bg-white data-[state=on]:shadow-sm data-[state=on]:text-orange-600">
                <LayoutGrid className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view" className="h-8 w-8 px-0 data-[state=on]:bg-white data-[state=on]:shadow-sm data-[state=on]:text-orange-600">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {/* Client Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CLIENTS.map((client) => (
            <div 
              key={client.id} 
              className="group bg-white rounded-xl border border-slate-200 hover:border-orange-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col"
            >
              <div className="p-6 flex-1">
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12 rounded-lg border border-slate-100 shadow-sm">
                      <AvatarFallback className="bg-gradient-to-br from-slate-50 to-slate-100 text-slate-700 font-semibold text-lg">
                        {client.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold text-slate-900 leading-tight group-hover:text-orange-600 transition-colors">{client.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wider">{client.code}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                      <FileText className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">Year-End Files</span>
                    </div>
                    <div className="font-semibold text-slate-900">{client.files}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                      <Calculator className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">Loans/Leases</span>
                    </div>
                    <div className="font-semibold text-slate-900">{client.loans}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5 font-medium">Latest FYE</div>
                    <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-none hover:bg-orange-100 px-2 py-0.5 rounded font-semibold text-xs">
                      {client.fye}
                    </Badge>
                  </div>
                </div>
              </div>
              
              <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex justify-end">
                <Button variant="ghost" className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 font-medium text-sm h-8 px-3 -mr-3">
                  View Year-End Files
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}