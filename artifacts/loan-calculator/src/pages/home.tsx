import { useState, useRef, useEffect } from "react";
import { useListClients, useCreateClient, useDeleteClient, useUpdateClient } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import ConfirmDialog from "@/components/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, Plus, Trash2, FolderOpen, Pencil, Users, CalendarDays, Landmark, ArrowRight, Settings, Search, LayoutGrid, Table as TableIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { format, parseISO } from "date-fns";

export default function Home() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editClientId, setEditClientId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientSort, setClientSort] = useState("name-asc");
  const [clientView, setClientView] = useState<"cards" | "table">("cards");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const { data: clients, isLoading } = useListClients();

  const searchQuery = clientSearch.trim().toLowerCase();
  const suggestions = searchQuery
    ? (clients ?? [])
        .filter(
          (c) =>
            c.name.toLowerCase().includes(searchQuery) ||
            (c.code ?? "").toLowerCase().includes(searchQuery),
        )
        .slice(0, 8)
    : [];

  const visibleClients = (() => {
    let items = clients ?? [];
    const q = clientSearch.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.code ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...items];
    switch (clientSort) {
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "code-asc":
        sorted.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
        break;
      case "files-desc":
        sorted.sort((a, b) => (b.fileCount ?? 0) - (a.fileCount ?? 0));
        break;
      case "loans-desc":
        sorted.sort((a, b) => (b.loanCount ?? 0) - (a.loanCount ?? 0));
        break;
      case "fye-desc":
        sorted.sort((a, b) => (b.latestFiscalYearEnd ?? "").localeCompare(a.latestFiscalYearEnd ?? ""));
        break;
    }
    return sorted;
  })();
  const createClient = useCreateClient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        setCreateOpen(false);
        setNewName("");
        setNewCode("");
      },
      onError: (err) => {
        toast({ title: "Couldn't create client", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });
  const deleteClient = useDeleteClient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        setDeleteOpen(false);
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast({ title: "Couldn't delete client", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const updateClient = useUpdateClient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        setEditOpen(false);
      },
      onError: (err) => {
        toast({ title: "Couldn't update client", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Loan & Lease Amortization Tables"
        meta={
          <span className="inline-flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden md:inline">
              Create and manage loan and lease amortization tables.
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/trash" className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Trash</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Trash</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/settings" className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Settings className="h-4 w-4" />
                  <span className="sr-only">Settings</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </span>
        }
      />
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <main className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Clients</h2>
                {clients && (
                  <p className="text-sm text-muted-foreground">{clients.length} client{clients.length !== 1 ? "s" : ""}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <div className="relative" ref={searchRef}>
                <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={clientSearch}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearchOpen(false);
                    if (e.key === "Enter" && suggestions.length === 1) {
                      navigate(`/client/${suggestions[0].id}`);
                    }
                  }}
                  placeholder="Search clients..."
                  className="h-9 w-[240px] md:w-[320px] pl-8 text-sm"
                />
                {searchOpen && searchQuery.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md overflow-hidden">
                    {suggestions.length > 0 ? (
                      <ul className="max-h-72 overflow-y-auto py-1">
                        {suggestions.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors cursor-pointer"
                              onClick={() => {
                                setSearchOpen(false);
                                navigate(`/client/${c.id}`);
                              }}
                            >
                              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="truncate font-medium">{c.name}</span>
                              {c.code && (
                                <span className="ml-auto font-mono text-xs text-muted-foreground shrink-0">{c.code}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-3 py-2.5 text-sm text-muted-foreground">No matching clients</p>
                    )}
                  </div>
                )}
              </div>
              <Select value={clientSort} onValueChange={setClientSort}>
                <SelectTrigger className="h-9 w-[190px] text-xs">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Name (A to Z)</SelectItem>
                  <SelectItem value="name-desc">Name (Z to A)</SelectItem>
                  <SelectItem value="code-asc">Code (A to Z)</SelectItem>
                  <SelectItem value="files-desc">Most year-end files</SelectItem>
                  <SelectItem value="loans-desc">Most loans & leases</SelectItem>
                  <SelectItem value="fye-desc">Latest fiscal year end</SelectItem>
                </SelectContent>
              </Select>
              <div className="inline-flex items-center rounded-lg bg-muted p-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Card view"
                      aria-pressed={clientView === "cards"}
                      onClick={() => setClientView("cards")}
                      className={`inline-flex items-center justify-center rounded-md px-2.5 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${clientView === "cards" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Card view</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Table view"
                      aria-pressed={clientView === "table"}
                      onClick={() => setClientView("table")}
                      className={`inline-flex items-center justify-center rounded-md px-2.5 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${clientView === "table" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <TableIcon className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Table view</TooltipContent>
                </Tooltip>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => setCreateOpen(true)} className="gap-2 shadow-sm hover:shadow-md transition-shadow">
                    <Plus className="h-4 w-4" />
                    Add Client
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Create a new client</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="border-l-4 border-l-muted shadow-sm">
                  <CardHeader className="pb-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-3 w-16 mt-2" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoading && clients && clients.length === 0 && (
            <Card className="border-dashed border-2 border-muted bg-muted/30">
              <CardContent className="py-10 text-center space-y-6">
                <div className="space-y-3">
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                    <Building2 className="h-7 w-7 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-display font-semibold">Welcome to the Clearline Loan Calculator</p>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Build ASPE-compliant amortization tables, lease schedules, and year-end
                      note disclosures in three steps.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
                  <div className="rounded-lg border bg-background p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">1</span>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Add a client</p>
                    <p className="text-xs text-muted-foreground">Each client holds their year-end files.</p>
                  </div>
                  <div className="rounded-lg border bg-background p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">2</span>
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Create a year-end file</p>
                    <p className="text-xs text-muted-foreground">Set the fiscal year end and materiality thresholds.</p>
                  </div>
                  <div className="rounded-lg border bg-background p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">3</span>
                      <Landmark className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Add loans & leases</p>
                    <p className="text-xs text-muted-foreground">Schedules, classifications, and disclosures are generated for you.</p>
                  </div>
                </div>
                <Button size="lg" onClick={() => setCreateOpen(true)} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Your First Client
                </Button>
              </CardContent>
            </Card>
          )}

          {!isLoading && clients && clients.length > 0 && visibleClients.length === 0 && (
            <Card className="border-dashed border-2 border-muted bg-muted/30">
              <CardContent className="py-10 text-center space-y-2">
                <Search className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  No clients match "{clientSearch}".
                </p>
              </CardContent>
            </Card>
          )}

          {clientView === "table" && visibleClients.length > 0 ? (
            <Card className="shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Year-End Files</TableHead>
                    <TableHead className="text-right">Loans & Leases</TableHead>
                    <TableHead>Latest FYE</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleClients.map((client) => (
                    <TableRow key={client.id} className="group">
                      <TableCell className="font-medium">
                        <Link href={`/client/${client.id}`} className="hover:underline cursor-pointer">
                          {client.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{client.code}</TableCell>
                      <TableCell className="text-right">{client.fileCount ?? 0}</TableCell>
                      <TableCell className="text-right">{client.loanCount ?? 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {client.latestFiscalYearEnd
                          ? format(parseISO(client.latestFiscalYearEnd), "MMM d, yyyy")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setEditClientId(client.id);
                                  setEditName(client.name);
                                  setEditCode(client.code ?? "");
                                  setEditOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit client details</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  setDeleteTarget(client.id);
                                  setDeleteOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete client and all year-end files</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link href={`/client/${client.id}`} className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                                <FolderOpen className="h-4 w-4" />
                                <span className="sr-only">Open client</span>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>Open client</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleClients.map((client) => (
              <Card key={client.id} className="group rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-gray-200/50 hover:border-primary/30 transition-all duration-300 shadow-sm flex flex-col p-0 gap-0">
                <CardHeader className="p-6 pb-0">
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3 items-center">
                      <div className="w-10 h-10 rounded-xl bg-muted border flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-colors shrink-0">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-display leading-tight">{client.name}</CardTitle>
                        {client.code && (
                          <span className="inline-flex px-1.5 py-0.5 mt-1 rounded text-[10px] font-bold bg-muted text-muted-foreground uppercase tracking-wider">
                            {client.code}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditClientId(client.id);
                              setEditName(client.name);
                              setEditCode(client.code ?? "");
                              setEditOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit client details</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteTarget(client.id);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete client and all year-end files</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 pt-5 pb-5 flex-1">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-muted/50 rounded-xl p-3 border border-border/50">
                      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                        <CalendarDays className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Year-End Files</span>
                      </div>
                      <div className="text-xl font-bold">{client.fileCount ?? 0}</div>
                    </div>
                    <div className="bg-muted/50 rounded-xl p-3 border border-border/50">
                      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                        <Landmark className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Loans &amp; Leases</span>
                      </div>
                      <div className="text-xl font-bold">{client.loanCount ?? 0}</div>
                    </div>
                  </div>
                </CardContent>
                <Link href={`/client/${client.id}`} className="cursor-pointer block px-6 py-4 bg-muted/30 border-t flex items-center justify-between group-hover:bg-primary/5 transition-colors">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {(client.fileCount ?? 0) > 0 ? "Latest FYE" : "No files yet"}
                      </span>
                      <span className="text-sm font-semibold">
                        {client.latestFiscalYearEnd
                          ? format(parseISO(client.latestFiscalYearEnd), "MMM d, yyyy")
                          : "Set up first year-end file"}
                      </span>
                    </div>
                  </div>
                  <span className="w-8 h-8 rounded-full bg-background border flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:border-primary group-hover:text-primary-foreground transition-all shadow-sm">
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </Link>
              </Card>
            ))}
          </div>
          )}
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Add New Client</DialogTitle>
            <DialogDescription>
              Enter the client name and a unique code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="clientName">Name</Label>
              <Input
                id="clientName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme Corporation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientCode">Code</Label>
              <Input
                id="clientCode"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="e.g. ACME"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newName && newCode) {
                  createClient.mutate({ data: { name: newName, code: newCode } });
                }
              }}
              disabled={!newName || !newCode || createClient.isPending}
            >
              {createClient.isPending ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Edit Client</DialogTitle>
            <DialogDescription>
              Update the client name and code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editClientName">Client Name</Label>
              <Input
                id="editClientName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editClientCode">Client Code</Label>
              <Input
                id="editClientCode"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editName) {
                  updateClient.mutate({
                    id: editClientId,
                    data: { name: editName, code: editCode || undefined },
                  });
                }
              }}
              disabled={!editName || updateClient.isPending}
            >
              {updateClient.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          if (deleteTarget) deleteClient.mutate({ id: deleteTarget });
        }}
        title="Delete Client?"
        description="This will permanently delete the client and all associated year-end files and loans. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
