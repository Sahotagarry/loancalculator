import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  useListAdminUsers, 
  useCreateAdminUser, 
  useUpdateAdminUser, 
  useListLegacyClients, 
  useAdoptLegacyClient, 
  useGetClientMembers, 
  useReplaceClientMembers,
  useListClients,
  getListAdminUsersQueryKey,
  getListLegacyClientsQueryKey,
  getListClientsQueryKey,
  getGetClientMembersQueryKey,
  AppUser,
  Client
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { ShieldAlert, Users, Plus, CheckCircle2, UserCog, Building2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  accountant: "Accountant",
  read_only: "Read Only",
};

export default function AccessSettingsPage() {
  const { canManageSettings, isLoading: authLoading } = useAuth();
  const [location] = useLocation();

  const { data: users, isLoading: usersLoading } = useListAdminUsers({
    query: {
      queryKey: getListAdminUsersQueryKey(),
      enabled: canManageSettings,
    }
  });

  const { data: legacyClients, isLoading: clientsLoading } = useListLegacyClients({
    query: {
      queryKey: getListLegacyClientsQueryKey(),
      enabled: canManageSettings,
    }
  });

  const { data: activeClients, isLoading: activeClientsLoading } = useListClients({
    query: {
      queryKey: getListClientsQueryKey(),
      enabled: canManageSettings,
    }
  });

  if (authLoading) return null;

  if (!canManageSettings) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader
          backHref="/"
          title="Access Denied"
        />
        <div className="max-w-md mx-auto p-4 md:p-8 mt-10">
          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader className="pb-3 text-center">
              <ShieldAlert className="h-10 w-10 text-destructive mx-auto mb-2" />
              <CardTitle>Administrator Access Required</CardTitle>
              <CardDescription>
                You do not have permission to view or manage settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button asChild variant="outline">
                <Link href="/">Return to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        backHref="/"
        breadcrumb={
          <>
            <Link href="/" className="hover:text-foreground transition-colors font-semibold cursor-pointer">Clients</Link>
            <span className="text-border">/</span>
            <span className="text-foreground font-semibold">Settings</span>
          </>
        }
        title="Settings"
      />

      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex border-b mb-6">
          <Link href="/settings">
            <div className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition-colors ${location === "/settings" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              Azure Integration
            </div>
          </Link>
          <Link href="/settings/access">
            <div className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition-colors ${location === "/settings/access" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              Access & Users
            </div>
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6 md:col-span-2">
            <UsersSection users={users} isLoading={usersLoading} />
          </div>
          
          <div className="space-y-6 md:col-span-2">
            <LegacyClientsSection clients={legacyClients} isLoading={clientsLoading} allUsers={users || []} />
          </div>
          
          <div className="space-y-6 md:col-span-2">
            <ActiveClientsSection clients={activeClients} isLoading={activeClientsLoading} allUsers={users || []} />
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersSection({ users, isLoading }: { users?: AppUser[], isLoading: boolean }) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newObjectId, setNewObjectId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<AppUser['role']>("read_only");
  
  const createMutation = useCreateAdminUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        setIsAddOpen(false);
        setNewObjectId("");
        setNewDisplayName("");
        setNewEmail("");
        setNewRole("read_only");
        toast({ title: "User added successfully" });
      },
      onError: (err) => {
        toast({ title: "Failed to add user", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newObjectId) return;
    createMutation.mutate({
      data: {
        objectId: newObjectId,
        displayName: newDisplayName || null,
        email: newEmail || null,
        role: newRole as AppUser["role"],
        isActive: true
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Staff Access
          </CardTitle>
          <CardDescription>
            Manage users and role assignments for the firm.
          </CardDescription>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Staff Member</DialogTitle>
              <DialogDescription>
                Users are identified by their Entra Object ID.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="objectId">Entra Object ID <span className="text-destructive">*</span></Label>
                <Input 
                  id="objectId" 
                  value={newObjectId} 
                  onChange={e => setNewObjectId(e.target.value)} 
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input 
                  id="displayName" 
                  value={newDisplayName} 
                  onChange={e => setNewDisplayName(e.target.value)} 
                  placeholder="Jane Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  type="email"
                  value={newEmail} 
                  onChange={e => setNewEmail(e.target.value)} 
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={newRole} onValueChange={(val: string) => setNewRole(val as AppUser["role"])}>
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read_only">Read Only</SelectItem>
                    <SelectItem value="accountant">Accountant</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={!newObjectId || createMutation.isPending}>
                  {createMutation.isPending ? "Adding..." : "Add User"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading users...</div>
        ) : !users?.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground border rounded-md border-dashed">
            No users configured. Add a user to grant them access.
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Object ID</th>
                  <th className="px-4 py-3 font-medium w-32">Role</th>
                  <th className="px-4 py-3 font-medium w-24">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map(user => (
                  <UserRow key={user.objectId} user={user} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UserRow({ user }: { user: AppUser }) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.isActive);

  const updateMutation = useUpdateAdminUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        setIsEditOpen(false);
        toast({ title: "User updated successfully" });
      },
      onError: (err) => {
        toast({ title: "Failed to update user", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const handleSave = () => {
    updateMutation.mutate({
      id: user.objectId,
      data: {
        role: role as AppUser["role"],
        isActive
      }
    });
  };

  return (
    <>
      <tr className={`hover:bg-muted/30 transition-colors ${!user.isActive ? 'opacity-50 grayscale hover:grayscale-0 focus-within:grayscale-0' : ''}`}>
        <td className="px-4 py-3">
          <div className="font-medium text-foreground">{user.displayName || 'Unknown'}</div>
          <div className="text-xs text-muted-foreground">{user.email || 'No email'}</div>
        </td>
        <td className="px-4 py-3">
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
            {user.objectId.substring(0, 8)}...
          </code>
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
            {ROLE_LABELS[user.role]}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-between">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${user.isActive ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
              {user.isActive ? 'Active' : 'Inactive'}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-2" onClick={() => {
              setRole(user.role);
              setIsActive(user.isActive);
              setIsEditOpen(true);
            }}>
              <UserCog className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Access</DialogTitle>
            <DialogDescription>
              {user.displayName || user.email || user.objectId}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor={`role-${user.objectId}`}>Role</Label>
              <Select value={role} onValueChange={(val: string) => setRole(val as AppUser["role"])}>
                <SelectTrigger id={`role-${user.objectId}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read_only">Read Only</SelectItem>
                  <SelectItem value="accountant">Accountant</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <Checkbox 
                id={`active-${user.objectId}`} 
                checked={isActive} 
                onCheckedChange={(c) => setIsActive(!!c)} 
              />
              <label 
                htmlFor={`active-${user.objectId}`}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                User is active and can sign in
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LegacyClientsSection({ clients, isLoading, allUsers }: { clients?: Client[], isLoading: boolean, allUsers: AppUser[] }) {
  const activeUsers = allUsers.filter(u => u.isActive);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-600" /> Quarantined Legacy Clients
        </CardTitle>
        <CardDescription>
          Legacy clients must be adopted and assigned members before they can be accessed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading clients...</div>
        ) : !clients?.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground border rounded-md border-dashed">
            No legacy clients found.
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium w-32">Status</th>
                  <th className="px-4 py-3 font-medium w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {clients.map(client => (
                  <LegacyClientRow key={client.id} client={client} activeUsers={activeUsers} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LegacyClientRow({ client, activeUsers }: { client: Client, activeUsers: AppUser[] }) {
  const [isAdoptOpen, setIsAdoptOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  
  const adoptMutation = useAdoptLegacyClient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLegacyClientsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        setIsAdoptOpen(false);
        toast({ title: "Client adopted successfully" });
      },
      onError: (err) => {
        toast({ title: "Failed to adopt client", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const handleAdopt = () => {
    adoptMutation.mutate({
      id: client.id,
      data: {
        memberObjectIds: selectedMembers
      }
    });
  };

  const openAdopt = () => {
    setSelectedMembers([]);
    setIsAdoptOpen(true);
  };

  const toggleMember = (objectId: string) => {
    setSelectedMembers(prev => 
      prev.includes(objectId) 
        ? prev.filter(id => id !== objectId)
        : [...prev, objectId]
    );
  };

  return (
    <>
      <tr className="hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3">
          <div className="font-medium text-foreground">{client.name}</div>
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {client.code}
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
            <ShieldAlert className="h-3.5 w-3.5" /> Quarantined
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <Button variant="default" size="sm" onClick={openAdopt}>
            Adopt Client
          </Button>
        </td>
      </tr>

      <Dialog open={isAdoptOpen} onOpenChange={setIsAdoptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adopt Legacy Client</DialogTitle>
            <DialogDescription>
              Adopting "{client.name}" makes it visible to the assigned members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <h4 className="text-sm font-medium">Assign Access</h4>
            <div className="space-y-2 border rounded-md p-3 max-h-48 overflow-y-auto">
              {activeUsers.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-2">No active users to assign.</div>
              ) : activeUsers.map(user => (
                <div key={user.objectId} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`adopt-${user.objectId}`} 
                    checked={selectedMembers.includes(user.objectId)}
                    onCheckedChange={() => toggleMember(user.objectId)}
                  />
                  <label htmlFor={`adopt-${user.objectId}`} className="text-sm font-medium leading-none cursor-pointer">
                    {user.displayName || user.email || user.objectId} <span className="text-muted-foreground text-xs font-normal">({ROLE_LABELS[user.role]})</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAdoptOpen(false)}>Cancel</Button>
            <Button onClick={handleAdopt} disabled={adoptMutation.isPending}>
              {adoptMutation.isPending ? "Adopting..." : "Adopt Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </>
  );
}

function ActiveClientsSection({ clients, isLoading, allUsers }: { clients?: Client[], isLoading: boolean, allUsers: AppUser[] }) {
  const activeUsers = allUsers.filter(u => u.isActive);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Adopted Clients
        </CardTitle>
        <CardDescription>
          Manage access assignments for adopted clients.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading clients...</div>
        ) : !clients?.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground border rounded-md border-dashed">
            No adopted clients found.
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium w-32">Status</th>
                  <th className="px-4 py-3 font-medium w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {clients.map(client => (
                  <ActiveClientRow key={client.id} client={client} activeUsers={activeUsers} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveClientRow({ client, activeUsers }: { client: Client, activeUsers: AppUser[] }) {
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  
  const { data: members, isLoading: membersLoading } = useGetClientMembers(client.id, {
    query: {
      queryKey: getGetClientMembersQueryKey(client.id),
      retry: false,
    }
  });

  const replaceMutation = useReplaceClientMembers({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientMembersQueryKey(client.id) });
        setIsManageOpen(false);
        toast({ title: "Client members updated" });
      },
      onError: (err) => {
        toast({ title: "Failed to update members", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const handleReplace = () => {
    replaceMutation.mutate({
      id: client.id,
      data: {
        memberObjectIds: selectedMembers
      }
    });
  };

  const openManage = () => {
    if (members) {
      setSelectedMembers(members.map(m => m.objectId));
    } else {
      setSelectedMembers([]);
    }
    setIsManageOpen(true);
  };

  const toggleMember = (objectId: string) => {
    setSelectedMembers(prev => 
      prev.includes(objectId) 
        ? prev.filter(id => id !== objectId)
        : [...prev, objectId]
    );
  };

  return (
    <>
      <tr className="hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3">
          <div className="font-medium text-foreground">{client.name}</div>
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {client.code}
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Adopted
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <Button variant="ghost" size="sm" onClick={openManage}>
            Manage Access
          </Button>
        </td>
      </tr>

      <Dialog open={isManageOpen} onOpenChange={setIsManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Client Access</DialogTitle>
            <DialogDescription>
              Select which staff members can access "{client.name}".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2 border rounded-md p-3 max-h-48 overflow-y-auto">
              {activeUsers.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-2">No active users to assign.</div>
              ) : activeUsers.map(user => (
                <div key={user.objectId} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`manage-${user.objectId}`} 
                    checked={selectedMembers.includes(user.objectId)}
                    onCheckedChange={() => toggleMember(user.objectId)}
                  />
                  <label htmlFor={`manage-${user.objectId}`} className="text-sm font-medium leading-none cursor-pointer">
                    {user.displayName || user.email || user.objectId} <span className="text-muted-foreground text-xs font-normal">({ROLE_LABELS[user.role]})</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsManageOpen(false)}>Cancel</Button>
            <Button onClick={handleReplace} disabled={replaceMutation.isPending}>
              {replaceMutation.isPending ? "Saving..." : "Save Members"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
